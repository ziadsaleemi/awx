#!/usr/bin/env python3
"""Repeatable AWX + Galaxy NG + Project Quay smoke checks.

The script intentionally uses only the Python standard library so it can run
from a fresh control node after the Ansible deployment roles finish.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


class SmokeFailure(RuntimeError):
    pass


@dataclass
class HttpResult:
    status: int
    headers: dict[str, str]
    body: bytes
    url: str

    @property
    def text(self) -> str:
        return self.body.decode('utf-8', errors='replace')

    def header(self, name: str) -> str:
        return self.headers.get(name.lower(), '')

    def json(self) -> dict[str, Any]:
        try:
            payload = json.loads(self.text)
        except json.JSONDecodeError as exc:
            raise SmokeFailure(f'{self.url} did not return JSON: {exc}') from exc
        if not isinstance(payload, dict):
            raise SmokeFailure(f'{self.url} returned non-object JSON.')
        return payload


@dataclass
class Check:
    label: str
    ok: bool
    detail: str = ''
    data: dict[str, Any] = field(default_factory=dict)


def env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {'1', 'true', 'yes', 'on'}


def split_env_words(name: str) -> list[str]:
    value = os.environ.get(name, '')
    return [part for part in re.split(r'[\s,]+', value.strip()) if part]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description='Smoke test AWX-managed Galaxy NG and Project Quay integrations.')
    parser.add_argument(
        '--url',
        action='append',
        dest='urls',
        help='AWX base URL. Can be passed more than once. Defaults to AWX_URLS/AWX_URL.',
    )
    parser.add_argument(
        '--username',
        default=os.environ.get('AWX_USERNAME', 'admin'),
        help='AWX username. Defaults to AWX_USERNAME or admin.',
    )
    parser.add_argument(
        '--password',
        default=os.environ.get('AWX_PASSWORD'),
        help='AWX password. Defaults to AWX_PASSWORD.',
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
        '--user-agent',
        default=os.environ.get(
            'AWX_SMOKE_USER_AGENT',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AWX-Content-Smoke/1.0',
        ),
        help='HTTP User-Agent for smoke requests.',
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
        '--galaxy-url',
        default=os.environ.get('GALAXY_NG_URL'),
        help='Optional direct Galaxy NG base URL to check outside AWX.',
    )
    parser.add_argument(
        '--quay-url',
        default=os.environ.get('QUAY_URL'),
        help='Optional direct Project Quay base URL to check outside AWX.',
    )
    parser.add_argument(
        '--json-output',
        default=os.environ.get('AWX_CONTENT_SMOKE_JSON_OUTPUT'),
        help='Write a JSON evidence report to this path.',
    )
    return parser


def normalize_urls(args: argparse.Namespace) -> list[str]:
    urls = args.urls or split_env_words('AWX_URLS')
    if not urls and os.environ.get('AWX_URL'):
        urls = [os.environ['AWX_URL']]
    normalized = [url.rstrip('/') for url in urls if url.strip()]
    if not normalized:
        raise SmokeFailure('Provide at least one AWX URL with --url, AWX_URLS, or AWX_URL.')
    return normalized


def auth_header(username: str | None, password: str | None) -> dict[str, str]:
    if not username:
        return {}
    token = base64.b64encode(f'{username}:{password or ""}'.encode()).decode()
    return {'Authorization': f'Basic {token}'}


def request(
    base_url: str,
    path: str,
    *,
    username: str | None,
    password: str | None,
    method: str = 'GET',
    verify_tls: bool,
    timeout: float,
    user_agent: str,
) -> HttpResult:
    url = urllib.parse.urljoin(f'{base_url.rstrip("/")}/', path.lstrip('/'))
    headers = {
        'Accept': 'application/json, text/html;q=0.9, */*;q=0.8',
        'User-Agent': user_agent,
    }
    headers.update(auth_header(username, password))
    req = urllib.request.Request(url, headers=headers, method=method)
    context = None if verify_tls else ssl._create_unverified_context()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=context) as response:
            headers = {key.lower(): value for key, value in response.headers.items()}
            return HttpResult(response.status, headers, response.read(), response.geturl())
    except urllib.error.HTTPError as exc:
        headers = {key.lower(): value for key, value in exc.headers.items()}
        return HttpResult(exc.code, headers, exc.read(), exc.geturl())
    except urllib.error.URLError as exc:
        raise SmokeFailure(f'{url} failed: {exc}') from exc


def expect_status(label: str, result: HttpResult, expected: int | set[int]) -> None:
    expected_set = {expected} if isinstance(expected, int) else expected
    if result.status not in expected_set:
        body = result.text[:300].replace('\n', ' ')
        raise SmokeFailure(f'{label} expected HTTP {sorted(expected_set)}, got {result.status}: {body}')


def check_root_assets(base_url: str, args: argparse.Namespace) -> Check:
    root = request(
        base_url,
        '/',
        username=None,
        password=None,
        verify_tls=args.verify_tls,
        timeout=args.timeout,
        user_agent=args.user_agent,
    )
    expect_status('root page', root, 200)
    scripts = re.findall(r'src="([^"]+\.js)"', root.text)
    if not scripts:
        raise SmokeFailure('root page did not include a JavaScript bundle.')
    script = scripts[-1]
    chunk = request(
        base_url,
        script,
        username=None,
        password=None,
        verify_tls=args.verify_tls,
        timeout=args.timeout,
        user_agent=args.user_agent,
    )
    expect_status('root JavaScript bundle', chunk, 200)
    content_type = chunk.header('content-type')
    if 'javascript' not in content_type.lower():
        raise SmokeFailure(f'{script} returned unexpected content type {content_type!r}.')
    return Check('root/static', True, f'{len(root.body)} byte root, {script} {len(chunk.body)} bytes')


def get_json(base_url: str, path: str, label: str, args: argparse.Namespace) -> dict[str, Any]:
    result = request(
        base_url,
        path,
        username=args.username,
        password=args.password,
        verify_tls=args.verify_tls,
        timeout=args.timeout,
        user_agent=args.user_agent,
    )
    expect_status(label, result, 200)
    return result.json()


def check_awx(base_url: str, args: argparse.Namespace) -> list[Check]:
    ping = get_json(base_url, '/api/v2/ping/', 'AWX ping', args)
    me = get_json(base_url, '/api/v2/me/', 'AWX me', args)
    me_result = me
    if isinstance(me.get('results'), list) and me['results']:
        me_result = me['results'][0]
    user_label = me_result.get('username') or me_result.get('email') or me_result.get('url') or '-'
    return [
        check_root_assets(base_url, args),
        Check('awx/ping', True, f"version={ping.get('version', '-')}", {'version': ping.get('version')}),
        Check('awx/me', True, f'user={user_label}', {'username': me_result.get('username'), 'id': me_result.get('id')}),
    ]


def check_collection(base_url: str, path: str, label: str, args: argparse.Namespace) -> Check:
    payload = get_json(base_url, path, label, args)
    count = payload.get('count')
    results = payload.get('results')
    detail = f'count={count}' if count is not None else f'results={len(results or [])}'
    return Check(label, True, detail, {'count': count, 'results_seen': len(results or [])})


def check_galaxy(base_url: str, args: argparse.Namespace) -> list[Check]:
    checks: list[Check] = []
    status = get_json(base_url, '/api/v2/galaxy_ng/status/', 'Galaxy NG status', args)
    configured = bool(status.get('enabled') and status.get('configured') and not status.get('controller_error'))
    if not configured and not args.allow_galaxy_unconfigured:
        raise SmokeFailure(f"Galaxy NG is not configured: {status.get('message') or status.get('controller_error')}")
    allowed_unconfigured = bool(not configured and args.allow_galaxy_unconfigured)
    checks.append(
        Check(
            'galaxy/status',
            configured or allowed_unconfigured,
            f"configured={configured} repositories={status.get('counts', {}).get('repositories', '-')}",
            {'status': status.get('status'), 'counts': status.get('counts', {})},
        )
    )
    if configured:
        for path, label in [
            ('/api/v2/galaxy_ng/namespaces/?page_size=1', 'galaxy/namespaces'),
            ('/api/v2/galaxy_ng/repositories/?page_size=1', 'galaxy/repositories'),
            ('/api/v2/galaxy_ng/tasks/?page_size=1', 'galaxy/tasks'),
        ]:
            checks.append(check_collection(base_url, path, label, args))
    return checks


def check_quay(base_url: str, args: argparse.Namespace) -> list[Check]:
    checks: list[Check] = []
    status = get_json(base_url, '/api/v2/quay/status/', 'Project Quay status', args)
    configured = bool(status.get('enabled') and status.get('configured') and not status.get('controller_error'))
    if not configured and not args.allow_quay_unconfigured:
        raise SmokeFailure(f"Project Quay is not configured: {status.get('message') or status.get('controller_error')}")
    allowed_unconfigured = bool(not configured and args.allow_quay_unconfigured)
    checks.append(
        Check(
            'quay/status',
            configured or allowed_unconfigured,
            f"configured={configured} repositories={status.get('counts', {}).get('repositories', '-')}",
            {'status': status.get('status'), 'counts': status.get('counts', {})},
        )
    )
    if configured:
        repositories = get_json(base_url, '/api/v2/quay/repositories/?page_size=1', 'quay/repositories', args)
        results = repositories.get('results') or []
        checks.append(
            Check(
                'quay/repositories',
                True,
                f"count={repositories.get('count')}",
                {'count': repositories.get('count'), 'results_seen': len(results)},
            )
        )
        if results:
            repository = results[0]
            namespace = repository.get('namespace') or status.get('namespace')
            name = repository.get('name')
            if namespace and name:
                query = urllib.parse.urlencode({'namespace': namespace, 'repository': name, 'page_size': 1})
                tags = get_json(base_url, f'/api/v2/quay/tags/?{query}', 'quay/tags', args)
                checks.append(
                    Check(
                        'quay/tags',
                        True,
                        f"{namespace}/{name} count={tags.get('count')}",
                        {'namespace': namespace, 'repository': name, 'count': tags.get('count')},
                    )
                )
    return checks


def check_direct(base_url: str, paths: list[tuple[str, str, set[int]]], args: argparse.Namespace) -> list[Check]:
    checks = []
    for label, path, expected in paths:
        result = request(
            base_url,
            path,
            username=None,
            password=None,
            verify_tls=args.verify_tls,
            timeout=args.timeout,
            user_agent=args.user_agent,
        )
        expect_status(label, result, expected)
        checks.append(Check(label, True, f'http={result.status}', {'url': result.url}))
    return checks


def run_for_url(base_url: str, args: argparse.Namespace) -> dict[str, Any]:
    checks: list[Check] = []
    checks.extend(check_awx(base_url, args))
    checks.extend(check_galaxy(base_url, args))
    checks.extend(check_quay(base_url, args))
    if args.galaxy_url:
        checks.extend(
            check_direct(
                args.galaxy_url,
                [
                    ('galaxy-direct/api-root', '/api/galaxy/', {200}),
                    ('galaxy-direct/ui', '/ui/', {200, 302}),
                ],
                args,
            )
        )
    if args.quay_url:
        checks.extend(
            check_direct(
                args.quay_url,
                [
                    ('quay-direct/health', '/health/instance', {200}),
                    ('quay-direct/discovery', '/api/v1/discovery', {200}),
                ],
                args,
            )
        )
    return {
        'url': base_url,
        'ok': all(check.ok for check in checks),
        'checks': [check.__dict__ for check in checks],
    }


def write_report(path: str, report: dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as handle:
        json.dump(report, handle, indent=2, sort_keys=True)
        handle.write('\n')


def main() -> int:
    args = build_parser().parse_args()
    try:
        urls = normalize_urls(args)
        report = {
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'elapsed_seconds': None,
            'targets': [],
        }
        started = time.monotonic()
        for url in urls:
            target = run_for_url(url, args)
            report['targets'].append(target)
        report['elapsed_seconds'] = round(time.monotonic() - started, 3)
        if args.json_output:
            write_report(args.json_output, report)
        for target in report['targets']:
            print(f"[OK] {target['url']}")
            for check in target['checks']:
                print(f"  - {check['label']}: {check['detail']}")
        if args.json_output:
            print(f"[OK] wrote {args.json_output}")
        return 0
    except SmokeFailure as exc:
        print(f'[FAIL] {exc}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
