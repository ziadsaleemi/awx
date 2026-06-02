import json
import hashlib
import re

import requests
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from awx.api.views.opa import OPAPolicyEngine, opa_response_allows
from awx.main.tasks.policy import opa_cert_file
from awx.main.utils.eda import EDAControllerClient, EDAControllerError, EDA_FAILURE_STATUSES

OPA_SMOKE_POLICY_PATH = 'awx/job_launch/allow'


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
        parser.add_argument('--fail-on-unavailable', action='store_true', help='Return nonzero when a checked service is unavailable.')

    def handle(self, *args, **options):
        checks = {}
        if not options['skip_eda']:
            checks['eda'] = self._check_eda(
                start_activation=options['start_eda_activation'],
                rulebook_name=options['eda_rulebook_name'],
                activation_id=options['eda_activation_id'],
                event_source=options['eda_event_source'],
                extra_data_json=options['eda_activation_extra_data'],
                include_events=options['eda_include_events'],
                cleanup=options['cleanup_eda_activation'],
            )
        if not options['skip_opa']:
            checks['opa'] = self._check_opa(sync_policy=options['sync_opa_policy'], policy_id=options['opa_policy_id'])

        result = {
            'ok': all(check['ok'] for check in checks.values()) if checks else True,
            'checks': checks,
        }

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

    def _check_opa(self, sync_policy=False, policy_id='awx/managed'):
        engine = OPAPolicyEngine()
        result = {
            'ok': False,
            'status': 'not_configured',
            'server_url': engine.base_url,
            'policy_path': OPA_SMOKE_POLICY_PATH,
            'policy_sync': {'requested': bool(sync_policy)},
        }
        if not engine.is_available():
            return result

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

        result.update(
            {
                'ok': allowed,
                'status': 'available' if allowed else 'policy_denied',
                'health_status_code': health_status_code,
                'allowed': allowed,
            }
        )
        return result

    def _sync_opa_policy(self, engine, policy_id):
        policy_id = str(policy_id or '').strip().strip('/')
        if not policy_id:
            return {'requested': True, 'ok': False, 'status': 'invalid_policy_id', 'error': 'OPA policy id is required.'}
        if not re.match(r'^[a-zA-Z0-9_/-]+$', policy_id):
            return {'requested': True, 'ok': False, 'status': 'invalid_policy_id', 'error': 'OPA policy id contains invalid characters.'}

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

    def _write_text_result(self, result):
        self.stdout.write(f"Overall: {'ok' if result['ok'] else 'failed'}")
        for name, check in result['checks'].items():
            self.stdout.write(f"{name.upper()}: {check['status']}")
