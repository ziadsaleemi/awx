#!/usr/bin/env python3
"""Repeatable AWX + EDA live smoke checks.

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


DEFAULT_RESOURCES = [
    'rule-audit',
    'activations',
    'projects',
    'decision-environments',
    'event-streams',
    'rulebooks',
    'credentials',
    'credential-types',
    'organizations',
    'teams',
    'users',
    'role-definitions',
    'user-role-assignments',
    'team-role-assignments',
]

TERMINAL_PROJECT_STATES = {'completed', 'successful', 'ok'}
FAILED_PROJECT_STATES = {'failed', 'error', 'canceled', 'cancelled'}


class SmokeFailure(RuntimeError):
    pass


@dataclass
class Check:
    label: str
    ok: bool
    detail: str = ''
    data: dict[str, Any] = field(default_factory=dict)


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


def env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {'1', 'true', 'yes', 'on'}


def split_env_words(name: str) -> list[str]:
    value = os.environ.get(name, '')
    return [part for part in re.split(r'[\s,]+', value.strip()) if part]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description='Smoke test AWX EDA management through AWX API endpoints.')
    parser.add_argument('--url', action='append', dest='urls', help='AWX base URL. Can be passed more than once. Defaults to AWX_URLS/AWX_URL.')
    parser.add_argument('--username', default=os.environ.get('AWX_USERNAME', 'admin'), help='AWX admin username. Defaults to AWX_USERNAME or admin.')
    parser.add_argument('--password', default=os.environ.get('AWX_PASSWORD'), help='AWX admin password. Defaults to AWX_PASSWORD.')
    parser.add_argument(
        '--verify-tls',
        action='store_true',
        default=env_bool('AWX_VERIFY_TLS', False),
        help='Verify HTTPS certificates. Default: disabled for lab/self-signed endpoints.',
    )
    parser.add_argument('--timeout', type=float, default=float(os.environ.get('AWX_SMOKE_TIMEOUT', '20')), help='Per-request timeout in seconds.')
    parser.add_argument(
        '--user-agent',
        default=os.environ.get(
            'AWX_SMOKE_USER_AGENT',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AWX-EDA-Smoke/1.0',
        ),
        help='HTTP User-Agent for smoke requests. Defaults to a browser-style value so Cloudflare/browser-integrity checks do not block the script.',
    )
    parser.add_argument('--resource', action='append', dest='resources', help='EDA resource to list. Can be passed more than once.')
    parser.add_argument(
        '--inspect-existing-activation',
        action='store_true',
        default=env_bool('EDA_SMOKE_INSPECT_EXISTING_ACTIVATION', False),
        help='After listing activations, inspect the first existing activation detail/logs. Disabled by default because existing activations can disappear during cleanup.',
    )
    parser.add_argument(
        '--allow-eda-unconfigured',
        action='store_true',
        default=env_bool('EDA_ALLOW_UNCONFIGURED', False),
        help='Do not fail when /api/v2/eda/status/ reports unconfigured.',
    )
    parser.add_argument('--json-output', default=os.environ.get('AWX_SMOKE_JSON_OUTPUT'), help='Write a JSON evidence report to this path.')
    parser.add_argument(
        '--project-url', default=os.environ.get('EDA_SMOKE_PROJECT_URL'), help='Optional SCM URL for a create -> sync -> delete EDA project smoke.'
    )
    parser.add_argument('--project-branch', default=os.environ.get('EDA_SMOKE_PROJECT_BRANCH', 'main'), help='Branch for the optional project smoke.')
    parser.add_argument('--project-poll-attempts', type=int, default=int(os.environ.get('EDA_SMOKE_PROJECT_POLL_ATTEMPTS', '20')))
    parser.add_argument('--project-poll-interval', type=float, default=float(os.environ.get('EDA_SMOKE_PROJECT_POLL_INTERVAL', '3')))
    parser.add_argument('--rulebook-id', default=os.environ.get('EDA_SMOKE_RULEBOOK_ID'), help='Optional rulebook id for create/start activation smoke.')
    parser.add_argument('--decision-environment-id', default=os.environ.get('EDA_SMOKE_DECISION_ENVIRONMENT_ID'))
    parser.add_argument('--organization-id', default=os.environ.get('EDA_SMOKE_ORGANIZATION_ID'))
    parser.add_argument('--eda-credential-id', action='append', dest='eda_credential_ids', default=split_env_words('EDA_SMOKE_CREDENTIAL_IDS'))
    parser.add_argument('--rbac-username', default=os.environ.get('EDA_RBAC_USERNAME'), help='Optional non-admin/operator username for RBAC smoke.')
    parser.add_argument('--rbac-password', default=os.environ.get('EDA_RBAC_PASSWORD'), help='Optional non-admin/operator password for RBAC smoke.')
    parser.add_argument(
        '--rbac-read-status', type=int, default=int(os.environ.get('EDA_RBAC_READ_STATUS', '200')), help='Expected EDA read status for RBAC user.'
    )
    parser.add_argument(
        '--rbac-mutate-status', type=int, default=int(os.environ.get('EDA_RBAC_MUTATE_STATUS', '403')), help='Expected EDA mutation status for RBAC user.'
    )
    parser.add_argument('--skip-anonymous-check', action='store_true', default=env_bool('AWX_SMOKE_SKIP_ANONYMOUS_CHECK', False))
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
    payload: dict[str, Any] | None = None,
    verify_tls: bool,
    timeout: float,
    user_agent: str,
) -> HttpResult:
    url = urllib.parse.urljoin(f'{base_url.rstrip("/")}/', path)
    headers = {
        'Accept': 'application/json, text/html;q=0.9, */*;q=0.8',
        'User-Agent': user_agent,
    }
    headers.update(auth_header(username, password))
    data = None
    if payload is not None:
        data = json.dumps(payload).encode()
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
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
    root = request(base_url, '/', username=None, password=None, verify_tls=args.verify_tls, timeout=args.timeout, user_agent=args.user_agent)
    expect_status('root page', root, 200)
    html = root.text
    scripts = re.findall(r'src="([^"]+\.js)"', html)
    if not scripts:
        raise SmokeFailure('root page did not include a JavaScript bundle.')
    script = scripts[-1]
    chunk = request(base_url, script, username=None, password=None, verify_tls=args.verify_tls, timeout=args.timeout, user_agent=args.user_agent)
    expect_status('root JavaScript bundle', chunk, 200)
    content_type = chunk.header('content-type')
    if 'javascript' not in content_type.lower():
        raise SmokeFailure(f'{script} returned unexpected content type {content_type!r}.')
    return Check('root/static', True, f'{len(root.body)} byte root, {script} {len(chunk.body)} bytes', {'script': script})


def check_json_endpoint(
    base_url: str,
    path: str,
    label: str,
    args: argparse.Namespace,
    *,
    username: str | None = None,
    password: str | None = None,
    expected: int = 200,
) -> tuple[Check, dict[str, Any]]:
    result = request(
        base_url,
        path,
        username=username if username is not None else args.username,
        password=password if password is not None else args.password,
        verify_tls=args.verify_tls,
        timeout=args.timeout,
        user_agent=args.user_agent,
    )
    expect_status(label, result, expected)
    payload = result.json()
    return Check(label, True, f'HTTP {result.status}', compact_payload(payload)), payload


def compact_payload(payload: dict[str, Any]) -> dict[str, Any]:
    keys = ('version', 'username', 'status', 'configured', 'source', 'resource', 'count')
    return {key: payload[key] for key in keys if key in payload}


def check_authenticated_core(base_url: str, args: argparse.Namespace) -> list[Check]:
    ping_check, ping = check_json_endpoint(base_url, '/api/v2/ping/', 'api ping', args)
    me_check, me = check_json_endpoint(base_url, '/api/v2/me/', 'api me', args)
    username = me_username(me)
    if str(username).lower() != str(args.username).lower():
        raise SmokeFailure(f'/api/v2/me/ returned username {username!r}, expected {args.username!r}.')
    ping_check.detail = f'version={ping.get("version", "-")}'
    me_check.detail = f'user={username}'
    return [ping_check, me_check]


def me_username(payload: dict[str, Any]) -> str:
    if payload.get('username'):
        return str(payload['username'])
    results = payload.get('results')
    if isinstance(results, list) and results and isinstance(results[0], dict):
        return str(results[0].get('username') or '')
    return ''


def check_eda_status(base_url: str, args: argparse.Namespace) -> Check:
    check, payload = check_json_endpoint(base_url, '/api/v2/eda/status/', 'eda status', args)
    if not args.allow_eda_unconfigured and not payload.get('configured'):
        raise SmokeFailure('/api/v2/eda/status/ is not configured. Use --allow-eda-unconfigured only for non-EDA environments.')
    check.detail = f'status={payload.get("status")} configured={payload.get("configured")}'
    return check


def resource_path(resource: str) -> str:
    if resource == 'activations':
        return '/api/v2/eda/activations/?page_size=1'
    return f'/api/v2/eda/{resource}/?page_size=1'


def check_eda_resources(base_url: str, args: argparse.Namespace) -> tuple[list[Check], int | None]:
    checks: list[Check] = []
    activation_id: int | None = None
    for resource in args.resources or DEFAULT_RESOURCES:
        check, payload = check_json_endpoint(base_url, resource_path(resource), f'eda {resource}', args)
        results = payload.get('results')
        if not isinstance(results, list):
            raise SmokeFailure(f'EDA resource {resource} did not return a results list.')
        check.detail = f'count={payload.get("count", len(results))} source={payload.get("source", "-")}'
        checks.append(check)
        if resource == 'activations' and results:
            raw_id = results[0].get('id') if isinstance(results[0], dict) else None
            try:
                activation_id = int(raw_id)
            except (TypeError, ValueError):
                activation_id = None
    if activation_id and args.inspect_existing_activation:
        detail_check, _ = check_json_endpoint(base_url, f'/api/v2/eda/activations/{activation_id}/', 'eda activation detail', args)
        events_check, events = check_json_endpoint(base_url, f'/api/v2/eda/activations/{activation_id}/events/?page_size=5', 'eda activation events', args)
        events_check.detail = f'count={events.get("count", 0)}'
        checks.extend([detail_check, events_check])
    return checks, activation_id


def check_eda_rbac_sync(base_url: str, args: argparse.Namespace) -> Check:
    check, payload = check_json_endpoint(base_url, '/api/v2/eda/rbac-sync/', 'eda rbac sync preview', args)
    summary = payload.get('summary') if isinstance(payload.get('summary'), dict) else {}
    check.detail = (
        f"desired={summary.get('desired_assignments', 0)} " f"missing={summary.get('missing_assignments', 0)} " f"extra={summary.get('extra_assignments', 0)}"
    )
    return check


def unique_name(prefix: str) -> str:
    return f'{prefix}-{datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")}'


def check_project_e2e(base_url: str, args: argparse.Namespace) -> list[Check]:
    if not args.project_url:
        return [Check('eda project e2e', True, 'skipped; set --project-url to create/sync/delete')]
    name = unique_name('awx-eda-smoke-project')
    project_id: Any = None
    checks: list[Check] = []
    try:
        created = request(
            base_url,
            '/api/v2/eda/projects/',
            username=args.username,
            password=args.password,
            method='POST',
            payload={'name': name, 'description': 'AWX EDA smoke project', 'url': args.project_url, 'scm_branch': args.project_branch, 'verify_ssl': False},
            verify_tls=args.verify_tls,
            timeout=args.timeout,
            user_agent=args.user_agent,
        )
        expect_status('eda project create', created, 201)
        created_payload = created.json()
        project_id = created_payload.get('id')
        if project_id in (None, ''):
            raise SmokeFailure('EDA project create response did not include an id.')
        checks.append(Check('eda project create', True, f'id={project_id}'))

        synced = request(
            base_url,
            f'/api/v2/eda/projects/{project_id}/sync/',
            username=args.username,
            password=args.password,
            method='POST',
            payload={},
            verify_tls=args.verify_tls,
            timeout=args.timeout,
            user_agent=args.user_agent,
        )
        expect_status('eda project sync', synced, 200)
        checks.append(Check('eda project sync', True, 'requested'))

        last_state = ''
        for _ in range(max(args.project_poll_attempts, 1)):
            detail = request(
                base_url,
                f'/api/v2/eda/projects/{project_id}/',
                username=args.username,
                password=args.password,
                verify_tls=args.verify_tls,
                timeout=args.timeout,
                user_agent=args.user_agent,
            )
            expect_status('eda project poll', detail, 200)
            payload = detail.json()
            last_state = str(payload.get('import_state') or payload.get('status') or '').lower()
            if last_state in TERMINAL_PROJECT_STATES:
                checks.append(Check('eda project poll', True, f'import_state={last_state or "-"}'))
                break
            if last_state in FAILED_PROJECT_STATES:
                raise SmokeFailure(f'EDA project sync ended in {last_state}.')
            time.sleep(max(args.project_poll_interval, 0))
        else:
            raise SmokeFailure(f'EDA project sync did not complete; last state={last_state or "-"}')
        return checks
    finally:
        if project_id not in (None, ''):
            deleted = request(
                base_url,
                f'/api/v2/eda/projects/{project_id}/',
                username=args.username,
                password=args.password,
                method='DELETE',
                verify_tls=args.verify_tls,
                timeout=args.timeout,
                user_agent=args.user_agent,
            )
            if deleted.status in {200, 202, 204, 404}:
                checks.append(Check('eda project cleanup', True, f'HTTP {deleted.status}'))
            else:
                checks.append(Check('eda project cleanup', False, f'HTTP {deleted.status}: {deleted.text[:200]}'))


def check_activation_e2e(base_url: str, args: argparse.Namespace) -> list[Check]:
    if not args.rulebook_id:
        return [Check('eda activation e2e', True, 'skipped; set --rulebook-id to launch/delete')]
    name = unique_name('awx-eda-smoke-activation')
    payload: dict[str, Any] = {'name': name, 'rulebook_id': int(args.rulebook_id), 'poll': True, 'include_events': True}
    if args.decision_environment_id:
        payload['decision_environment_id'] = int(args.decision_environment_id)
    if args.organization_id:
        payload['organization_id'] = int(args.organization_id)
    if args.eda_credential_ids:
        payload['eda_credentials'] = [int(value) for value in args.eda_credential_ids]
    activation_id: Any = None
    checks: list[Check] = []
    try:
        started = request(
            base_url,
            '/api/v2/eda/activations/start/',
            username=args.username,
            password=args.password,
            method='POST',
            payload=payload,
            verify_tls=args.verify_tls,
            timeout=args.timeout,
            user_agent=args.user_agent,
        )
        expect_status('eda activation launch', started, 200)
        started_payload = started.json()
        activation = started_payload.get('activation') if isinstance(started_payload.get('activation'), dict) else {}
        activation_id = activation.get('id')
        if activation_id in (None, ''):
            raise SmokeFailure('EDA activation launch response did not include an activation id.')
        checks.append(Check('eda activation launch', True, f'id={activation_id} actions={started_payload.get("actions", [])}'))
        detail_check, _ = check_json_endpoint(base_url, f'/api/v2/eda/activations/{activation_id}/', 'eda activation detail after launch', args)
        events_check, events = check_json_endpoint(
            base_url, f'/api/v2/eda/activations/{activation_id}/events/?page_size=20', 'eda activation logs after launch', args
        )
        events_check.detail = f'count={events.get("count", 0)}'
        checks.extend([detail_check, events_check])
        return checks
    finally:
        if activation_id not in (None, ''):
            deleted = request(
                base_url,
                f'/api/v2/eda/activations/{activation_id}/',
                username=args.username,
                password=args.password,
                method='DELETE',
                verify_tls=args.verify_tls,
                timeout=args.timeout,
                user_agent=args.user_agent,
            )
            if deleted.status in {200, 202, 204, 404}:
                checks.append(Check('eda activation cleanup', True, f'HTTP {deleted.status}'))
            else:
                checks.append(Check('eda activation cleanup', False, f'HTTP {deleted.status}: {deleted.text[:200]}'))


def check_rbac(base_url: str, args: argparse.Namespace) -> list[Check]:
    checks: list[Check] = []
    if not args.skip_anonymous_check:
        anonymous = request(
            base_url,
            '/api/v2/eda/status/',
            username=None,
            password=None,
            verify_tls=args.verify_tls,
            timeout=args.timeout,
            user_agent=args.user_agent,
        )
        expect_status('anonymous EDA read denied', anonymous, {401, 403})
        checks.append(Check('anonymous EDA read denied', True, f'HTTP {anonymous.status}'))
    if not args.rbac_username:
        checks.append(Check('eda rbac user smoke', True, 'skipped; set --rbac-username/--rbac-password'))
        return checks
    read = request(
        base_url,
        '/api/v2/eda/projects/?page_size=1',
        username=args.rbac_username,
        password=args.rbac_password,
        verify_tls=args.verify_tls,
        timeout=args.timeout,
        user_agent=args.user_agent,
    )
    expect_status('RBAC EDA read', read, args.rbac_read_status)
    checks.append(Check('RBAC EDA read', True, f'{args.rbac_username} HTTP {read.status}'))

    mutate = request(
        base_url,
        '/api/v2/eda/projects/',
        username=args.rbac_username,
        password=args.rbac_password,
        method='POST',
        payload={'name': unique_name('rbac-deny-project')},
        verify_tls=args.verify_tls,
        timeout=args.timeout,
        user_agent=args.user_agent,
    )
    if mutate.status == 201:
        project_id = mutate.json().get('id')
        if project_id:
            request(
                base_url,
                f'/api/v2/eda/projects/{project_id}/',
                username=args.username,
                password=args.password,
                method='DELETE',
                verify_tls=args.verify_tls,
                timeout=args.timeout,
                user_agent=args.user_agent,
            )
    expect_status('RBAC EDA mutation', mutate, args.rbac_mutate_status)
    checks.append(Check('RBAC EDA mutation', True, f'{args.rbac_username} HTTP {mutate.status}'))
    return checks


def run_url(base_url: str, args: argparse.Namespace) -> list[Check]:
    checks: list[Check] = [check_root_assets(base_url, args)]
    checks.extend(check_authenticated_core(base_url, args))
    checks.append(check_eda_status(base_url, args))
    resource_checks, _ = check_eda_resources(base_url, args)
    checks.extend(resource_checks)
    checks.append(check_eda_rbac_sync(base_url, args))
    checks.extend(check_project_e2e(base_url, args))
    checks.extend(check_activation_e2e(base_url, args))
    checks.extend(check_rbac(base_url, args))
    return checks


def emit_check(url: str, check: Check) -> None:
    marker = 'ok' if check.ok else 'fail'
    detail = f' - {check.detail}' if check.detail else ''
    print(f'[{marker}] {url} {check.label}{detail}')


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if not args.password:
        parser.error('AWX admin password is required via --password or AWX_PASSWORD.')
    urls = normalize_urls(args)
    report: dict[str, Any] = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'urls': {},
    }
    failed = False
    for url in urls:
        report['urls'][url] = []
        try:
            checks = run_url(url, args)
        except Exception as exc:
            failed = True
            check = Check('fatal', False, str(exc))
            checks = [check]
        for check in checks:
            if not check.ok:
                failed = True
            emit_check(url, check)
            report['urls'][url].append({'label': check.label, 'ok': check.ok, 'detail': check.detail, 'data': check.data})
    if args.json_output:
        with open(args.json_output, 'w', encoding='utf-8') as stream:
            json.dump(report, stream, indent=2, sort_keys=True)
            stream.write('\n')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
