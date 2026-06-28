import hashlib
import json
import re

import requests
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from awx.api.views.opa import OPAPolicyEngine, opa_response_allows
from awx.api.views.gatekeeper import GatekeeperKubernetesClient
from awx.main.tasks.policy import opa_cert_file
from awx.main.utils.eda import EDAControllerClient, EDAControllerError, EDA_FAILURE_STATUSES

OPA_SMOKE_POLICY_PATH = 'awx/job_launch/allow'
OPA_DENY_SMOKE_POLICY_ID = 'awx/codex_deny_smoke'
OPA_DENY_SMOKE_POLICY_PATH = 'awx/codex_deny_smoke/allow'
OPA_DENY_SMOKE_POLICY_TEXT = """package awx.codex_deny_smoke

default allow := false

allow if input.action == "allow"
"""


class Command(BaseCommand):
    help = 'Check configured external automation services used by AWX integrations.'

    def add_arguments(self, parser):
        parser.add_argument('--json', action='store_true', dest='json_output', help='Print JSON output.')
        parser.add_argument('--skip-eda', action='store_true', help='Skip Event-Driven Ansible Controller check.')
        parser.add_argument('--start-eda-activation', action='store_true', help='Create or start an EDA activation after the list check.')
        parser.add_argument('--eda-rulebook-name', default='codex-smoke.yml', help='EDA rulebook name used with --start-eda-activation.')
        parser.add_argument('--eda-activation-id', default='', help='Existing EDA activation id used with --start-eda-activation.')
        parser.add_argument('--eda-event-source', default='', help='Optional EDA event source label used with --start-eda-activation.')
        parser.add_argument('--eda-activation-extra-data', default='{}', help='JSON object merged into EDA activation create payload.')
        parser.add_argument('--eda-include-events', action='store_true', help='Read activation events/logs after starting.')
        parser.add_argument('--cleanup-eda-activation', action='store_true', help='Delete the activation after a successful start smoke.')
        parser.add_argument('--skip-opa', action='store_true', help='Skip Open Policy Agent check.')
        parser.add_argument('--sync-opa-policy', action='store_true', help='Sync OPA_POLICY_BUNDLE to OPA before evaluating smoke policy.')
        parser.add_argument('--opa-policy-id', default='awx/managed', help='OPA policy id used with --sync-opa-policy.')
        parser.add_argument(
            '--opa-deny-smoke',
            action='store_true',
            help='Install a temporary deny policy, verify denied evaluation, then delete it.',
        )
        parser.add_argument('--opa-deny-policy-id', default=OPA_DENY_SMOKE_POLICY_ID, help='Temporary OPA policy id used with --opa-deny-smoke.')
        parser.add_argument('--check-gatekeeper', action='store_true', help='Check the Gatekeeper Kubernetes API connection.')
        parser.add_argument('--skip-gatekeeper', action='store_true', help='Skip Gatekeeper Kubernetes API check.')
        parser.add_argument('--gatekeeper-context', default='', help='Optional configured Gatekeeper Kubernetes context to check.')
        parser.add_argument('--check-proxmox', action='store_true', help='Check a Proxmox VE API endpoint.')
        parser.add_argument('--proxmox-api-url', default='', help='Proxmox VE API URL, usually https://host:8006/api2/json.')
        parser.add_argument('--proxmox-api-token-id', default='', help='Proxmox VE API token id.')
        parser.add_argument('--proxmox-api-token-secret', default='', help='Proxmox VE API token secret.')
        parser.add_argument('--proxmox-tls-insecure', action='store_true', help='Disable TLS verification for the Proxmox API check.')
        parser.add_argument(
            '--proxmox-expected-vm',
            action='append',
            default=[],
            help='Expected EDA/OPA/Gatekeeper VM name to prove on Proxmox. Can be specified more than once.',
        )
        parser.add_argument('--fail-on-unavailable', action='store_true', help='Return nonzero when a checked service is unavailable.')

    def handle(self, *args, **options):
        result = run_external_automation_checks(
            include_eda=not options['skip_eda'],
            include_opa=not options['skip_opa'],
            start_eda_activation=options['start_eda_activation'],
            eda_rulebook_name=options['eda_rulebook_name'],
            eda_activation_id=options['eda_activation_id'],
            eda_event_source=options['eda_event_source'],
            eda_activation_extra_data=options['eda_activation_extra_data'],
            eda_include_events=options['eda_include_events'],
            cleanup_eda_activation=options['cleanup_eda_activation'],
            sync_opa_policy=options['sync_opa_policy'],
            opa_policy_id=options['opa_policy_id'],
            opa_deny_smoke=options['opa_deny_smoke'],
            opa_deny_policy_id=options['opa_deny_policy_id'],
            include_gatekeeper=(options['check_gatekeeper'] or bool(options['gatekeeper_context'])) and not options['skip_gatekeeper'],
            gatekeeper_context=options['gatekeeper_context'],
            include_proxmox=options['check_proxmox'],
            proxmox_api_url=options['proxmox_api_url'],
            proxmox_api_token_id=options['proxmox_api_token_id'],
            proxmox_api_token_secret=options['proxmox_api_token_secret'],
            proxmox_tls_insecure=options['proxmox_tls_insecure'],
            proxmox_expected_vms=options['proxmox_expected_vm'],
        )

        if options['json_output']:
            self.stdout.write(json.dumps(result, indent=2, sort_keys=True))
        else:
            self._write_text_result(result)

        if options['fail_on_unavailable'] and not result['ok']:
            raise CommandError('External automation check failed.')

    def _check_eda(
        self,
        start_activation=False,
        rulebook_name='codex-smoke.yml',
        activation_id='',
        event_source='',
        extra_data_json='{}',
        include_events=False,
        cleanup=False,
    ):
        client = EDAControllerClient()
        result = {
            'ok': False,
            'status': client.status,
            'controller_url': client.controller_url,
            'auth_configured': client.auth_configured,
        }
        if not client.is_configured:
            return result

        try:
            payload = client.list_activations(page=1, page_size=1)
        except EDAControllerError as exc:
            result.update({'status': exc.status, 'error': str(exc)})
            return result

        result.update(
            {
                'ok': True,
                'status': 'available',
                'source': payload.get('source', 'eda_controller'),
                'count': payload.get('count', len(payload.get('results', []))),
            }
        )
        if start_activation:
            result['activation_start'] = self._start_eda_activation(
                client, rulebook_name, activation_id, event_source, extra_data_json, include_events, cleanup
            )
            result['ok'] = result['ok'] and result['activation_start']['ok']
            if not result['activation_start']['ok']:
                result['status'] = result['activation_start']['status']
        return result

    def _start_eda_activation(self, client, rulebook_name, activation_id, event_source, extra_data_json, include_events, cleanup):
        try:
            extra_data = json.loads(extra_data_json or '{}')
        except ValueError:
            return {'requested': True, 'ok': False, 'status': 'invalid_extra_data', 'error': 'EDA activation extra data must be valid JSON.'}
        if not isinstance(extra_data, dict):
            return {'requested': True, 'ok': False, 'status': 'invalid_extra_data', 'error': 'EDA activation extra data must be a JSON object.'}

        try:
            response = client.ensure_activation_started(
                rulebook_name,
                activation_id=activation_id,
                event_source=event_source,
                extra_data=extra_data,
                poll=True,
                include_events=include_events,
            )
        except EDAControllerError as exc:
            return {'requested': True, 'ok': False, 'status': exc.status, 'error': str(exc)}

        activation = response.get('activation') or {}
        status = str(activation.get('status') or '').strip().lower().replace(' ', '_')
        ok = bool(activation.get('id')) and status not in EDA_FAILURE_STATUSES
        result = {
            'requested': True,
            'ok': ok,
            'status': 'started' if ok else status or 'missing',
            'activation': activation,
            'actions': response.get('actions', []),
            'event_count': len(response.get('events', [])),
        }
        if include_events:
            result['events'] = response.get('events', [])

        if cleanup and activation.get('id') and ok:
            try:
                result['cleanup'] = client.delete_activation(activation.get('id'))
            except EDAControllerError as exc:
                result['ok'] = False
                result['cleanup'] = {'status': exc.status, 'error': str(exc)}
                result['status'] = 'cleanup_failed'
        return result

    def _check_opa(self, sync_policy=False, policy_id='awx/managed', deny_smoke=False, deny_policy_id=OPA_DENY_SMOKE_POLICY_ID):
        engine = OPAPolicyEngine()
        result = {
            'ok': False,
            'status': 'not_configured',
            'server_url': engine.base_url,
            'policy_path': OPA_SMOKE_POLICY_PATH,
            'policy_sync': {'requested': bool(sync_policy)},
            'deny_smoke': {'requested': bool(deny_smoke)},
        }
        if not engine.is_available():
            return result

        health_status_code = None
        try:
            engine.validate_configuration()
            health_status_code = self._check_opa_health(engine)
            if sync_policy:
                result['policy_sync'] = self._sync_opa_policy(engine, policy_id)
                if not result['policy_sync']['ok']:
                    result.update({'status': 'policy_sync_failed'})
                    return result
            decision = engine.evaluate(
                OPA_SMOKE_POLICY_PATH,
                {'action': 'smoke', 'source': 'awx-manage', 'metadata': {'command': 'check_external_automation'}},
            )
            allowed = opa_response_allows(decision)
        except Exception as exc:
            result.update({'status': 'unreachable', 'error': str(exc)})
            return result

        deny_smoke_ok = True
        if deny_smoke:
            result['deny_smoke'] = self._check_opa_deny_smoke(engine, deny_policy_id)
            deny_smoke_ok = result['deny_smoke']['ok']

        result.update(
            {
                'ok': allowed and deny_smoke_ok,
                'status': 'available' if allowed and deny_smoke_ok else 'deny_smoke_failed' if allowed else 'policy_denied',
                'health_status_code': health_status_code,
                'allowed': allowed,
            }
        )
        return result

    def _sync_opa_policy(self, engine, policy_id):
        policy_id, error = self._normalize_opa_policy_id(policy_id)
        if error:
            return {'requested': True, 'ok': False, 'status': 'invalid_policy_id', 'error': error}

        policy_bundle = getattr(settings, 'OPA_POLICY_BUNDLE', '') or ''
        if not policy_bundle.strip():
            return {'requested': True, 'ok': False, 'status': 'empty_policy_bundle', 'error': 'OPA_POLICY_BUNDLE is empty.'}

        try:
            response = engine.put_policy(policy_id, policy_bundle)
        except Exception as exc:
            return {'requested': True, 'ok': False, 'status': 'unreachable', 'error': str(exc)}

        return {
            'requested': True,
            'ok': True,
            'status': 'synced',
            'policy_id': policy_id,
            'size': len(policy_bundle),
            'line_count': policy_bundle.count('\n') + 1,
            'sha256': hashlib.sha256(policy_bundle.encode()).hexdigest(),
            'opa_response': response,
        }

    def _check_opa_deny_smoke(self, engine, policy_id):
        policy_id, error = self._normalize_opa_policy_id(policy_id)
        if error:
            return {'requested': True, 'ok': False, 'status': 'invalid_policy_id', 'error': error}

        result = {
            'requested': True,
            'ok': False,
            'status': 'pending',
            'policy_id': policy_id,
            'policy_path': OPA_DENY_SMOKE_POLICY_PATH,
        }
        policy_written = False
        try:
            result['policy_sync'] = engine.put_policy(policy_id, OPA_DENY_SMOKE_POLICY_TEXT)
            policy_written = True
            decision = engine.evaluate(
                OPA_DENY_SMOKE_POLICY_PATH,
                {'action': 'deny', 'source': 'awx-manage', 'metadata': {'command': 'check_external_automation', 'check': 'opa_deny_smoke'}},
            )
            allowed = opa_response_allows(decision)
            result.update(
                {
                    'allowed': allowed,
                    'opa_response': decision,
                    'status': 'allowed_unexpectedly' if allowed else 'denied',
                    'ok': not allowed,
                }
            )
        except Exception as exc:
            result.update({'status': 'unreachable', 'error': str(exc)})
        finally:
            if policy_written:
                try:
                    result['cleanup'] = engine.delete_policy(policy_id)
                except Exception as exc:
                    result['cleanup'] = {'ok': False, 'status': 'cleanup_failed', 'error': str(exc)}
                    result['ok'] = False
                    result['status'] = 'cleanup_failed'
        return result

    def _normalize_opa_policy_id(self, policy_id):
        policy_id = str(policy_id or '').strip().strip('/')
        if not policy_id:
            return '', 'OPA policy id is required.'
        if not re.match(r'^[a-zA-Z0-9_/-]+$', policy_id):
            return '', 'OPA policy id contains invalid characters.'
        return policy_id, ''

    def _check_opa_health(self, engine):
        with opa_cert_file() as cert_files:
            cert, verify = cert_files
            response = requests.get(
                f'{engine.base_url}/health',
                timeout=engine.timeout,
                headers=engine._headers(),
                cert=cert,
                verify=verify,
            )
        response.raise_for_status()
        return response.status_code

    def _check_gatekeeper(self, context_name=''):
        client = GatekeeperKubernetesClient(context_name)
        result = {
            'ok': False,
            'status': 'not_configured',
            'server_url': client.server_url,
            'context': client.context,
            'verify_ssl': client.verify_ssl,
            'contexts': client.context_options(),
        }
        if client.context_error:
            result.update({'status': 'invalid_context', 'error': str(client.context_error)})
            return result
        if not client.is_configured():
            return result

        try:
            template_version, templates = client.list_constraint_templates()
            constraints, constraint_errors = client.list_constraint_resources()
            try:
                configs = client.list_configs()
            except requests.HTTPError as exc:
                response = getattr(exc, 'response', None)
                if response is None or response.status_code != 404:
                    raise
                configs = []
            violations = sum(len((constraint.get('status') or {}).get('violations') or []) for constraint in constraints)
        except Exception as exc:
            result.update({'status': 'unreachable', 'error': str(exc)})
            return result

        partial = bool(constraint_errors)
        result.update(
            {
                'ok': not partial,
                'status': 'partial' if partial else 'available',
                'api_versions': {
                    'constraint_templates': template_version,
                },
                'counts': {
                    'constraint_templates': len(templates),
                    'constraints': len(constraints),
                    'violations': violations,
                    'configs': len(configs),
                },
                'errors': constraint_errors,
            }
        )
        return result

    def _check_proxmox(
        self,
        api_url='',
        api_token_id='',
        api_token_secret='',
        tls_insecure=False,
        expected_vms=None,
        connection_id='',
        connection_name='',
        connection_status='',
    ):
        api_url = str(api_url or '').strip().rstrip('/')
        expected_names = _normalize_expected_vm_names(expected_vms)
        result = {
            'ok': False,
            'status': 'not_configured',
            'api_url': api_url,
            'connection_id': str(connection_id or ''),
            'connection_name': str(connection_name or ''),
            'connection_status': str(connection_status or ''),
            'verify_ssl': not bool(tls_insecure),
            'expected_vm_names': expected_names,
        }
        if connection_status == 'missing':
            result['status'] = 'missing_connection'
            return result
        if not api_url or not api_token_id or not api_token_secret:
            return result

        session = requests.Session()
        session.headers.update(
            {
                'Authorization': f'PVEAPIToken={api_token_id}={api_token_secret}',
                'Accept': 'application/json',
            }
        )
        session.verify = not bool(tls_insecure)

        try:
            version = self._proxmox_get(session, api_url, '/version')
            resources = self._proxmox_get(session, api_url, '/cluster/resources')
        except Exception as exc:
            result.update({'status': 'unreachable', 'error': str(exc)})
            return result

        counts = {
            'nodes': 0,
            'vms': 0,
            'containers': 0,
            'templates': 0,
            'running_vms': 0,
        }
        vm_resources = []
        resource_list = resources if isinstance(resources, list) else []
        for resource in resource_list:
            if not isinstance(resource, dict):
                continue
            resource_type = resource.get('type')
            if resource_type == 'node':
                counts['nodes'] += 1
            elif resource_type == 'qemu':
                if resource.get('template', 0):
                    counts['templates'] += 1
                else:
                    counts['vms'] += 1
                    if str(resource.get('status') or '').lower() == 'running':
                        counts['running_vms'] += 1
                    vm_resources.append(resource)
            elif resource_type == 'lxc':
                counts['containers'] += 1
                vm_resources.append(resource)

        expected_results = _match_expected_vms(expected_names, vm_resources)
        expected_found = sum(1 for item in expected_results if item['found'])
        missing_expected = bool(expected_names) and expected_found != len(expected_names)
        result.update(
            {
                'ok': not missing_expected,
                'status': 'missing_expected_vms' if missing_expected else 'available',
                'version': version.get('version') if isinstance(version, dict) else '',
                'release': version.get('release') if isinstance(version, dict) else '',
                'counts': counts,
                'expected_vms': expected_results,
                'expected_vms_found': expected_found,
            }
        )
        return result

    def _proxmox_get(self, session, api_url, path):
        response = session.get(f'{api_url}/{path.lstrip("/")}', timeout=20)
        if not response.ok:
            detail = response.text
            try:
                body = response.json()
                detail = body.get('errors') or body.get('message') or detail
            except Exception:
                pass
            raise RuntimeError(f'Proxmox API error ({response.status_code}): {detail}')
        return response.json().get('data', []) or []

    def _write_text_result(self, result):
        self.stdout.write(f"Overall: {'ok' if result['ok'] else 'failed'}")
        for name, check in result['checks'].items():
            self.stdout.write(f"{name.upper()}: {check['status']}")


def run_external_automation_checks(
    include_eda=True,
    include_opa=True,
    start_eda_activation=False,
    eda_rulebook_name='codex-smoke.yml',
    eda_activation_id='',
    eda_event_source='',
    eda_activation_extra_data='{}',
    eda_include_events=False,
    cleanup_eda_activation=False,
    sync_opa_policy=False,
    opa_policy_id='awx/managed',
    opa_deny_smoke=False,
    opa_deny_policy_id=OPA_DENY_SMOKE_POLICY_ID,
    include_gatekeeper=False,
    gatekeeper_context='',
    include_proxmox=False,
    proxmox_api_url='',
    proxmox_api_token_id='',
    proxmox_api_token_secret='',
    proxmox_tls_insecure=False,
    proxmox_expected_vms=None,
    proxmox_connection_id='',
    proxmox_connection_name='',
    proxmox_connection_status='',
):
    checker = Command()
    checks = {}
    if include_eda:
        checks['eda'] = checker._check_eda(
            start_activation=start_eda_activation,
            rulebook_name=eda_rulebook_name,
            activation_id=eda_activation_id,
            event_source=eda_event_source,
            extra_data_json=eda_activation_extra_data,
            include_events=eda_include_events,
            cleanup=cleanup_eda_activation,
        )
    if include_opa:
        checks['opa'] = checker._check_opa(
            sync_policy=sync_opa_policy,
            policy_id=opa_policy_id,
            deny_smoke=opa_deny_smoke,
            deny_policy_id=opa_deny_policy_id,
        )
    if include_gatekeeper:
        checks['gatekeeper'] = checker._check_gatekeeper(context_name=gatekeeper_context)
    if include_proxmox:
        checks['proxmox'] = checker._check_proxmox(
            api_url=proxmox_api_url,
            api_token_id=proxmox_api_token_id,
            api_token_secret=proxmox_api_token_secret,
            tls_insecure=proxmox_tls_insecure,
            expected_vms=proxmox_expected_vms,
            connection_id=proxmox_connection_id,
            connection_name=proxmox_connection_name,
            connection_status=proxmox_connection_status,
        )
    return {
        'ok': all(check['ok'] for check in checks.values()) if checks else True,
        'checks': checks,
    }


def _normalize_expected_vm_names(expected_vms):
    if expected_vms is None:
        return []
    if isinstance(expected_vms, str):
        values = expected_vms.split(',')
    else:
        values = expected_vms
    names = []
    for value in values:
        name = str(value or '').strip()
        if name:
            names.append(name)
    return names


def _match_expected_vms(expected_names, resources):
    by_name = {}
    for resource in resources:
        name = str(resource.get('name') or '').strip()
        if name:
            by_name.setdefault(name.lower(), resource)

    results = []
    for expected_name in expected_names:
        resource = by_name.get(expected_name.lower())
        results.append(
            {
                'name': expected_name,
                'found': resource is not None,
                'status': str((resource or {}).get('status') or ''),
                'node': str((resource or {}).get('node') or ''),
                'type': str((resource or {}).get('type') or ''),
                'vmid': (resource or {}).get('vmid'),
            }
        )
    return results
