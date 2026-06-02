import json

import requests
from django.core.management.base import BaseCommand, CommandError

from awx.api.views.opa import OPAPolicyEngine, opa_response_allows
from awx.main.tasks.policy import opa_cert_file
from awx.main.utils.eda import EDAControllerClient, EDAControllerError

OPA_SMOKE_POLICY_PATH = 'awx/job_launch/allow'


class Command(BaseCommand):
    help = 'Check configured external automation services used by AWX integrations.'

    def add_arguments(self, parser):
        parser.add_argument('--json', action='store_true', dest='json_output', help='Print JSON output.')
        parser.add_argument('--skip-eda', action='store_true', help='Skip Event-Driven Ansible Controller check.')
        parser.add_argument('--skip-opa', action='store_true', help='Skip Open Policy Agent check.')
        parser.add_argument('--fail-on-unavailable', action='store_true', help='Return nonzero when a checked service is unavailable.')

    def handle(self, *args, **options):
        checks = {}
        if not options['skip_eda']:
            checks['eda'] = self._check_eda()
        if not options['skip_opa']:
            checks['opa'] = self._check_opa()

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

    def _check_eda(self):
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
        return result

    def _check_opa(self):
        engine = OPAPolicyEngine()
        result = {
            'ok': False,
            'status': 'not_configured',
            'server_url': engine.base_url,
            'policy_path': OPA_SMOKE_POLICY_PATH,
        }
        if not engine.is_available():
            return result

        try:
            engine.validate_configuration()
            health_status_code = self._check_opa_health(engine)
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
