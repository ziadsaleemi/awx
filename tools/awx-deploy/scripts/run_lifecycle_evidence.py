#!/usr/bin/env python3
"""Run AWX Deploy smoke checks and lifecycle evidence verification.

This wrapper keeps live drill proof repeatable: it runs the content-service and
EDA smoke scripts, writes a portable evidence manifest, then invokes the
lifecycle evidence verifier against the generated reports and backup artifacts.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class EvidenceRunnerFailure(RuntimeError):
    pass


SCRIPT_DIR = Path(__file__).resolve().parent


def env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {'1', 'true', 'yes', 'on'}


def split_env_words(name: str) -> list[str]:
    value = os.environ.get(name, '')
    return [part for part in re.split(r'[\s,]+', value.strip()) if part]


def timestamp() -> str:
    return datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description='Run AWX Deploy smoke checks and lifecycle evidence verification.')
    parser.add_argument(
        '--url',
        action='append',
        dest='urls',
        help='AWX base URL. Can be passed more than once. Defaults to AWX_URLS/AWX_URL.',
    )
    parser.add_argument(
        '--username',
        default=os.environ.get('AWX_USERNAME', 'admin'),
        help='AWX admin username. Defaults to AWX_USERNAME or admin.',
    )
    parser.add_argument(
        '--password',
        default=os.environ.get('AWX_PASSWORD'),
        help='AWX admin password. Defaults to AWX_PASSWORD.',
    )
    parser.add_argument(
        '--verify-tls',
        action='store_true',
        default=env_bool('AWX_VERIFY_TLS', False),
        help='Verify HTTPS certificates. Default: disabled for lab/self-signed endpoints.',
    )
    parser.add_argument(
        '--timeout',
        type=float,
        default=float(os.environ.get('AWX_SMOKE_TIMEOUT', '20')),
        help='Per-request timeout in seconds.',
    )
    parser.add_argument(
        '--output-dir',
        default=os.environ.get('AWX_LIFECYCLE_OUTPUT_DIR'),
        help='Directory for smoke reports, evidence manifest, and verifier result. Defaults to output/awx-lifecycle-<timestamp>.',
    )
    parser.add_argument(
        '--scenario-name',
        default=os.environ.get('AWX_LIFECYCLE_SCENARIO_NAME'),
        help='Scenario name written into the generated evidence manifest.',
    )
    parser.add_argument(
        '--artifact',
        action='append',
        default=[],
        metavar='PROFILE:PATH',
        help='Backup artifact directory to include in the generated manifest.',
    )
    parser.add_argument(
        '--require-storage',
        action='store_true',
        default=env_bool('AWX_LIFECYCLE_REQUIRE_STORAGE', False),
        help='Require storage/data archives for artifact profiles that support storage validation.',
    )
    parser.add_argument(
        '--skip-content-smoke',
        action='store_true',
        help='Do not run the AWX/Galaxy NG/Project Quay smoke check.',
    )
    parser.add_argument(
        '--skip-eda-smoke',
        action='store_true',
        help='Do not run the EDA smoke check.',
    )
    parser.add_argument(
        '--allow-galaxy-unconfigured',
        action='store_true',
        default=env_bool('GALAXY_NG_ALLOW_UNCONFIGURED', False),
        help='Do not fail when Galaxy NG is disabled or unconfigured in AWX.',
    )
    parser.add_argument(
        '--allow-quay-unconfigured',
        action='store_true',
        default=env_bool('QUAY_ALLOW_UNCONFIGURED', False),
        help='Do not fail when Project Quay is disabled or unconfigured in AWX.',
    )
    parser.add_argument(
        '--allow-eda-unconfigured',
        action='store_true',
        default=env_bool('EDA_ALLOW_UNCONFIGURED', False),
        help='Do not fail when /api/v2/eda/status/ reports unconfigured.',
    )
    parser.add_argument('--galaxy-url', default=os.environ.get('GALAXY_NG_URL'), help='Optional direct Galaxy NG base URL to check outside AWX.')
    parser.add_argument('--quay-url', default=os.environ.get('QUAY_URL'), help='Optional direct Project Quay base URL to check outside AWX.')
    return parser


def normalize_urls(args: argparse.Namespace) -> list[str]:
    urls = args.urls or split_env_words('AWX_URLS')
    if not urls and os.environ.get('AWX_URL'):
        urls = [os.environ['AWX_URL']]
    normalized = [url.rstrip('/') for url in urls if url.strip()]
    if not normalized:
        raise EvidenceRunnerFailure('Provide at least one AWX URL with --url, AWX_URLS, or AWX_URL.')
    return normalized


def parse_artifact(spec: str) -> dict[str, str]:
    if ':' not in spec:
        raise EvidenceRunnerFailure(f'Artifact spec {spec!r} must be PROFILE:PATH.')
    profile, path = spec.split(':', 1)
    profile = profile.strip()
    path = path.strip()
    if not profile or not path:
        raise EvidenceRunnerFailure(f'Artifact spec {spec!r} must include both profile and path.')
    return {'profile': profile, 'path': str(Path(path).expanduser().resolve())}


def output_dir(args: argparse.Namespace) -> Path:
    path = Path(args.output_dir or Path('output') / f'awx-lifecycle-{timestamp()}')
    path = path.expanduser().resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def masked_command(cmd: list[str]) -> str:
    rendered: list[str] = []
    hide_next = False
    for part in cmd:
        if hide_next:
            rendered.append('********')
            hide_next = False
            continue
        rendered.append(part)
        if part == '--password':
            hide_next = True
    return ' '.join(shlex.quote(part) for part in rendered)


def run_command(cmd: list[str]) -> None:
    print(f'$ {masked_command(cmd)}', flush=True)
    subprocess.run(cmd, check=True)


def append_common_smoke_args(cmd: list[str], args: argparse.Namespace, urls: list[str], json_output: Path) -> list[str]:
    for url in urls:
        cmd.extend(['--url', url])
    cmd.extend(['--username', args.username, '--password', args.password or '', '--timeout', str(args.timeout), '--json-output', str(json_output)])
    if args.verify_tls:
        cmd.append('--verify-tls')
    return cmd


def run_content_smoke(args: argparse.Namespace, urls: list[str], directory: Path) -> str:
    report_path = directory / 'content-smoke.json'
    cmd = append_common_smoke_args([sys.executable, str(SCRIPT_DIR / 'smoke_content_services.py')], args, urls, report_path)
    if args.allow_galaxy_unconfigured:
        cmd.append('--allow-galaxy-unconfigured')
    if args.allow_quay_unconfigured:
        cmd.append('--allow-quay-unconfigured')
    if args.galaxy_url:
        cmd.extend(['--galaxy-url', args.galaxy_url])
    if args.quay_url:
        cmd.extend(['--quay-url', args.quay_url])
    run_command(cmd)
    return report_path.name


def run_eda_smoke(args: argparse.Namespace, urls: list[str], directory: Path) -> str:
    report_path = directory / 'eda-smoke.json'
    cmd = append_common_smoke_args([sys.executable, str(SCRIPT_DIR / 'smoke_eda.py')], args, urls, report_path)
    if args.allow_eda_unconfigured:
        cmd.append('--allow-eda-unconfigured')
    run_command(cmd)
    return report_path.name


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', encoding='utf-8') as stream:
        json.dump(payload, stream, indent=2, sort_keys=True)
        stream.write('\n')


def write_manifest(args: argparse.Namespace, directory: Path, artifacts: list[dict[str, str]], smoke_reports: list[str]) -> Path:
    manifest = {
        'name': args.scenario_name or f'awx-lifecycle-{timestamp()}',
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'require_storage': bool(args.require_storage),
        'artifacts': artifacts,
        'smoke_reports': smoke_reports,
    }
    path = directory / 'evidence-manifest.json'
    write_json(path, manifest)
    return path


def verify_manifest(args: argparse.Namespace, manifest_path: Path, directory: Path) -> Path:
    result_path = directory / 'evidence-result.json'
    cmd = [
        sys.executable,
        str(SCRIPT_DIR / 'verify_lifecycle_evidence.py'),
        '--evidence-file',
        str(manifest_path),
        '--json-output',
        str(result_path),
    ]
    if args.require_storage:
        cmd.append('--require-storage')
    run_command(cmd)
    return result_path


def validate_args(parser: argparse.ArgumentParser, args: argparse.Namespace) -> None:
    runs_smoke = not args.skip_content_smoke or not args.skip_eda_smoke
    if runs_smoke and not args.password:
        parser.error('AWX admin password is required via --password or AWX_PASSWORD when smoke checks run.')
    if args.skip_content_smoke and args.skip_eda_smoke and not args.artifact:
        parser.error('Provide --artifact when both smoke checks are skipped.')


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        validate_args(parser, args)
        urls = normalize_urls(args) if not args.skip_content_smoke or not args.skip_eda_smoke else []
        directory = output_dir(args)
        artifacts = [parse_artifact(spec) for spec in args.artifact]
        smoke_reports: list[str] = []

        if not args.skip_content_smoke:
            smoke_reports.append(run_content_smoke(args, urls, directory))
        if not args.skip_eda_smoke:
            smoke_reports.append(run_eda_smoke(args, urls, directory))

        manifest_path = write_manifest(args, directory, artifacts, smoke_reports)
        result_path = verify_manifest(args, manifest_path, directory)
        print(f'[OK] output directory: {directory}')
        print(f'[OK] evidence manifest: {manifest_path}')
        print(f'[OK] evidence result: {result_path}')
        return 0
    except subprocess.CalledProcessError as exc:
        print(f'[FAIL] command exited with {exc.returncode}: {masked_command(exc.cmd)}', file=sys.stderr)
        return exc.returncode
    except EvidenceRunnerFailure as exc:
        print(f'[FAIL] {exc}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
