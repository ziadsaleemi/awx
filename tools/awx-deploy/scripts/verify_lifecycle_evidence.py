#!/usr/bin/env python3
"""Validate AWX Deploy lifecycle evidence artifacts.

This script is intentionally standard-library-only so it can run on a fresh
control node after live deploy, backup, restore, upgrade, and failback drills.
It validates the files produced by the AWX/Quay lifecycle playbooks and the
JSON reports produced by the AWX Deploy smoke scripts.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


class EvidenceFailure(RuntimeError):
    pass


@dataclass
class Check:
    label: str
    ok: bool
    detail: str = ''
    data: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ArtifactProfile:
    label: str
    required_files: tuple[str, ...]
    optional_files: tuple[str, ...] = ()
    storage_files: tuple[str, ...] = ()


ARTIFACT_PROFILES: dict[str, ArtifactProfile] = {
    'awx-server': ArtifactProfile(
        label='AWX server backup',
        required_files=('awx.sql', 'manifest-*.yml'),
        optional_files=('config-*.tar.gz', 'data-*.tar.gz'),
        storage_files=('data-*.tar.gz',),
    ),
    'awx-k8s': ArtifactProfile(
        label='AWX Kubernetes backup',
        required_files=('awx.sql', 'k8s-secrets.yml', 'k8s-configmaps.yml', 'k8s-resources.yml', 'manifest-*.yml'),
        optional_files=('data.tar.gz',),
        storage_files=('data.tar.gz',),
    ),
    'quay-server': ArtifactProfile(
        label='Project Quay server backup',
        required_files=('quay.sql', 'config-*.tar.gz', 'manifest-*.yml'),
        storage_files=('storage-*.tar.gz',),
    ),
    'quay-k8s': ArtifactProfile(
        label='Project Quay Kubernetes backup',
        required_files=('quay.sql', 'k8s-secrets.yml', 'k8s-resources.yml', 'manifest-*.yml'),
        storage_files=('storage.tar.gz',),
    ),
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description='Verify AWX Deploy lifecycle proof artifacts.')
    parser.add_argument(
        '--artifact',
        action='append',
        default=[],
        metavar='PROFILE:PATH',
        help='Backup artifact directory to verify. Profile: awx-server, awx-k8s, quay-server, quay-k8s.',
    )
    parser.add_argument(
        '--smoke-report',
        action='append',
        default=[],
        help='JSON report from smoke_content_services.py or smoke_eda.py. Can be passed more than once.',
    )
    parser.add_argument(
        '--require-storage',
        action='store_true',
        help='Require storage/data archives for profiles that support storage validation.',
    )
    parser.add_argument(
        '--json-output',
        help='Write a JSON evidence verification report to this path.',
    )
    return parser


def expand_matches(base_path: str, pattern: str) -> list[str]:
    return sorted(glob.glob(os.path.join(base_path, pattern)))


def file_size(path: str) -> int:
    try:
        return os.path.getsize(path)
    except OSError:
        return 0


def validate_file_set(base_path: str, patterns: tuple[str, ...], *, required: bool, label: str) -> Check:
    missing: list[str] = []
    matches: dict[str, list[dict[str, Any]]] = {}
    for pattern in patterns:
        pattern_matches = [{'path': path, 'size': file_size(path)} for path in expand_matches(base_path, pattern) if os.path.isfile(path)]
        if not pattern_matches and required:
            missing.append(pattern)
        matches[pattern] = pattern_matches
    ok = not missing
    detail = 'ok' if ok else f"missing: {', '.join(missing)}"
    return Check(label, ok, detail, {'path': base_path, 'matches': matches, 'missing': missing})


def validate_artifact(spec: str, require_storage: bool) -> list[Check]:
    if ':' not in spec:
        raise EvidenceFailure(f'Artifact spec {spec!r} must be PROFILE:PATH.')
    profile_name, path = spec.split(':', 1)
    profile = ARTIFACT_PROFILES.get(profile_name)
    if profile is None:
        valid = ', '.join(sorted(ARTIFACT_PROFILES))
        raise EvidenceFailure(f'Unknown artifact profile {profile_name!r}. Valid profiles: {valid}.')

    path = os.path.abspath(os.path.expanduser(path))
    checks = [
        Check(f'{profile_name}/directory', os.path.isdir(path), path),
    ]
    if not os.path.isdir(path):
        return checks

    checks.append(validate_file_set(path, profile.required_files, required=True, label=f'{profile_name}/required-files'))
    if profile.optional_files:
        checks.append(validate_file_set(path, profile.optional_files, required=False, label=f'{profile_name}/optional-files'))
    if require_storage and profile.storage_files:
        checks.append(validate_file_set(path, profile.storage_files, required=True, label=f'{profile_name}/storage-files'))
    return checks


def load_json(path: str) -> dict[str, Any]:
    try:
        with open(path, encoding='utf-8') as handle:
            payload = json.load(handle)
    except OSError as exc:
        raise EvidenceFailure(f'Cannot read smoke report {path}: {exc}') from exc
    except json.JSONDecodeError as exc:
        raise EvidenceFailure(f'Smoke report {path} is not valid JSON: {exc}') from exc
    if not isinstance(payload, dict):
        raise EvidenceFailure(f'Smoke report {path} must contain a JSON object.')
    return payload


def validate_content_smoke(path: str, payload: dict[str, Any]) -> list[Check]:
    targets = payload.get('targets')
    if not isinstance(targets, list) or not targets:
        return []
    checks: list[Check] = []
    failed_targets = [target.get('url', '<unknown>') for target in targets if not target.get('ok')]
    checks.append(
        Check(
            'content-smoke/targets',
            not failed_targets,
            f"targets={len(targets)}" if not failed_targets else f"failed={', '.join(failed_targets)}",
            {'path': path, 'target_count': len(targets), 'failed_targets': failed_targets},
        )
    )
    for target in targets:
        target_checks = target.get('checks') or []
        bad = [check.get('label', '<unknown>') for check in target_checks if not check.get('ok', True)]
        checks.append(
            Check(
                f"content-smoke/{target.get('url', '<unknown>')}",
                not bad,
                f"checks={len(target_checks)}" if not bad else f"failed={', '.join(bad)}",
                {'path': path, 'failed_checks': bad},
            )
        )
    return checks


def validate_eda_smoke(path: str, payload: dict[str, Any]) -> list[Check]:
    urls = payload.get('urls')
    if not isinstance(urls, dict) or not urls:
        return []
    checks: list[Check] = []
    failed_urls: list[str] = []
    for url, url_checks in urls.items():
        if not isinstance(url_checks, list):
            failed_urls.append(str(url))
            continue
        bad = [check.get('label', '<unknown>') for check in url_checks if not check.get('ok', True)]
        if bad:
            failed_urls.append(str(url))
        checks.append(
            Check(
                f'eda-smoke/{url}',
                not bad,
                f'checks={len(url_checks)}' if not bad else f"failed={', '.join(bad)}",
                {'path': path, 'failed_checks': bad},
            )
        )
    checks.insert(
        0,
        Check(
            'eda-smoke/urls',
            not failed_urls,
            f"urls={len(urls)}" if not failed_urls else f"failed={', '.join(failed_urls)}",
            {'path': path, 'url_count': len(urls), 'failed_urls': failed_urls},
        ),
    )
    return checks


def validate_smoke_report(path: str) -> list[Check]:
    path = os.path.abspath(os.path.expanduser(path))
    payload = load_json(path)
    checks = validate_content_smoke(path, payload) or validate_eda_smoke(path, payload)
    if not checks:
        checks = [Check('smoke-report/schema', False, 'unsupported smoke report format', {'path': path})]
    return checks


def write_report(path: str, report: dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as handle:
        json.dump(report, handle, indent=2, sort_keys=True)
        handle.write('\n')


def main() -> int:
    args = build_parser().parse_args()
    try:
        checks: list[Check] = []
        for artifact in args.artifact:
            checks.extend(validate_artifact(artifact, args.require_storage))
        for report_path in args.smoke_report:
            checks.extend(validate_smoke_report(report_path))
        if not checks:
            raise EvidenceFailure('Provide at least one --artifact or --smoke-report.')

        ok = all(check.ok for check in checks)
        report = {
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'ok': ok,
            'checks': [check.__dict__ for check in checks],
        }
        if args.json_output:
            write_report(args.json_output, report)
        for check in checks:
            marker = 'OK' if check.ok else 'FAIL'
            print(f'[{marker}] {check.label}: {check.detail}')
        if args.json_output:
            print(f"[OK] wrote {args.json_output}")
        return 0 if ok else 2
    except EvidenceFailure as exc:
        print(f'[FAIL] {exc}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
