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
        '--evidence-file',
        action='append',
        default=[],
        help='JSON evidence manifest with artifacts and smoke reports. Can be passed more than once.',
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


def resolve_path(path: str, base_dir: str | None = None) -> str:
    path = os.path.expanduser(path)
    if os.path.isabs(path) or not base_dir:
        return os.path.abspath(path)
    return os.path.abspath(os.path.join(base_dir, path))


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


def normalize_artifact_spec(entry: Any, base_dir: str | None = None) -> str:
    if isinstance(entry, str):
        if ':' not in entry:
            raise EvidenceFailure(f'Artifact spec {entry!r} must be PROFILE:PATH.')
        profile_name, path = entry.split(':', 1)
        return f'{profile_name}:{resolve_path(path, base_dir)}'
    if isinstance(entry, dict):
        profile_name = str(entry.get('profile') or '').strip()
        path = str(entry.get('path') or '').strip()
        if not profile_name or not path:
            raise EvidenceFailure('Artifact objects must include profile and path.')
        return f'{profile_name}:{resolve_path(path, base_dir)}'
    raise EvidenceFailure('Artifact entries must be strings or objects.')


def normalize_smoke_report(entry: Any, base_dir: str | None = None) -> str:
    if isinstance(entry, str):
        return resolve_path(entry, base_dir)
    if isinstance(entry, dict):
        path = str(entry.get('path') or '').strip()
        if not path:
            raise EvidenceFailure('Smoke report objects must include path.')
        return resolve_path(path, base_dir)
    raise EvidenceFailure('Smoke report entries must be strings or objects.')


def validate_artifact(spec: str, require_storage: bool) -> list[Check]:
    spec = normalize_artifact_spec(spec)
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


def prefix_checks(prefix: str, checks: list[Check]) -> list[Check]:
    if not prefix:
        return checks
    return [Check(f'{prefix}/{check.label}', check.ok, check.detail, check.data) for check in checks]


def load_json(path: str) -> dict[str, Any]:
    try:
        with open(path, encoding='utf-8') as handle:
            payload = json.load(handle)
    except OSError as exc:
        raise EvidenceFailure(f'Cannot read JSON file {path}: {exc}') from exc
    except json.JSONDecodeError as exc:
        raise EvidenceFailure(f'JSON file {path} is not valid JSON: {exc}') from exc
    if not isinstance(payload, dict):
        raise EvidenceFailure(f'JSON file {path} must contain a JSON object.')
    return payload


def evidence_sections(payload: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    scenarios = payload.get('scenarios')
    if scenarios is None:
        name = str(payload.get('name') or payload.get('scenario') or 'default').strip()
        return [(name or 'default', payload)]
    if not isinstance(scenarios, list) or not scenarios:
        raise EvidenceFailure('Evidence file scenarios must be a non-empty list.')
    sections: list[tuple[str, dict[str, Any]]] = []
    for index, scenario in enumerate(scenarios, start=1):
        if not isinstance(scenario, dict):
            raise EvidenceFailure('Each evidence file scenario must be an object.')
        name = str(scenario.get('name') or scenario.get('scenario') or f'scenario-{index}').strip()
        sections.append((name or f'scenario-{index}', scenario))
    return sections


def validate_evidence_file(path: str, global_require_storage: bool) -> list[Check]:
    path = resolve_path(path)
    payload = load_json(path)
    base_dir = os.path.dirname(path)
    sections = evidence_sections(payload)
    payload_require_storage = bool(payload.get('require_storage') or payload.get('requireStorage'))
    checks = [Check('evidence-file/schema', True, f'scenarios={len(sections)}', {'path': path})]

    for name, section in sections:
        artifacts = section.get('artifacts', [])
        smoke_reports = section.get('smoke_reports', section.get('smokeReports', []))
        if not isinstance(artifacts, list):
            raise EvidenceFailure(f'Evidence scenario {name!r} artifacts must be a list.')
        if not isinstance(smoke_reports, list):
            raise EvidenceFailure(f'Evidence scenario {name!r} smoke_reports must be a list.')
        if not artifacts and not smoke_reports:
            raise EvidenceFailure(f'Evidence scenario {name!r} must include artifacts or smoke_reports.')
        require_storage = bool(global_require_storage or payload_require_storage or section.get('require_storage') or section.get('requireStorage'))
        scenario_checks: list[Check] = []
        for artifact in artifacts:
            scenario_checks.extend(validate_artifact(normalize_artifact_spec(artifact, base_dir), require_storage))
        for smoke_report in smoke_reports:
            scenario_checks.extend(validate_smoke_report(normalize_smoke_report(smoke_report, base_dir)))
        checks.extend(prefix_checks(f'evidence/{name}', scenario_checks))
    return checks


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
        for evidence_file in args.evidence_file:
            checks.extend(validate_evidence_file(evidence_file, args.require_storage))
        for artifact in args.artifact:
            checks.extend(validate_artifact(artifact, args.require_storage))
        for report_path in args.smoke_report:
            checks.extend(validate_smoke_report(report_path))
        if not checks:
            raise EvidenceFailure('Provide at least one --evidence-file, --artifact, or --smoke-report.')

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
