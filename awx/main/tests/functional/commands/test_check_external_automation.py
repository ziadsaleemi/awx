import contextlib
import hashlib
import json
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import override_settings

from awx.main.utils.eda import EDAControllerError

pytestmark = pytest.mark.django_db


@override_settings(EDA_SERVER_URL='https://eda.example.test', OPA_HOST='opa.example.test', OPA_PORT=8181, OPA_SSL=False)
def test_check_external_automation_json_success(mocker):
    eda_client = mocker.Mock()
    eda_client.status = 'configured'
    eda_client.controller_url = 'https://eda.example.test'
    eda_client.auth_configured = True
    eda_client.is_configured = True
    eda_client.list_activations.return_value = {'count': 2, 'results': [{'id': 1}]}
    mocker.patch('awx.main.management.commands.check_external_automation.EDAControllerClient', return_value=eda_client)

    opa_engine = mocker.Mock()
    opa_engine.base_url = 'http://opa.example.test:8181'
    opa_engine.timeout = 1.5
    opa_engine.is_available.return_value = True
    opa_engine.validate_configuration.return_value = None
    opa_engine._headers.return_value = {'Content-Type': 'application/json'}
    opa_engine.evaluate.return_value = {'result': True}
    mocker.patch('awx.main.management.commands.check_external_automation.OPAPolicyEngine', return_value=opa_engine)
    mocker.patch('awx.main.management.commands.check_external_automation.opa_cert_file', return_value=contextlib.nullcontext((None, False)))

    health_response = mocker.Mock()
    health_response.status_code = 200
    health_response.raise_for_status.return_value = None
    requests_get = mocker.patch('awx.main.management.commands.check_external_automation.requests.get', return_value=health_response)

    output = StringIO()
    call_command('check_external_automation', '--json', stdout=output)
    payload = json.loads(output.getvalue())

    assert payload['ok'] is True
    assert payload['checks']['eda']['count'] == 2
    assert payload['checks']['eda']['auth_configured'] is True
    assert payload['checks']['opa']['allowed'] is True
    assert payload['checks']['opa']['health_status_code'] == 200
    assert requests_get.call_args.args[0] == 'http://opa.example.test:8181/health'


@override_settings(EDA_SERVER_URL='https://eda.example.test', OPA_HOST='')
def test_check_external_automation_can_start_eda_activation(mocker):
    eda_client = mocker.Mock()
    eda_client.status = 'configured'
    eda_client.controller_url = 'https://eda.example.test'
    eda_client.auth_configured = True
    eda_client.is_configured = True
    eda_client.list_activations.return_value = {'count': 0, 'results': []}
    eda_client.ensure_activation_started.return_value = {
        'activation': {'id': 42, 'name': 'codex-smoke.yml', 'status': 'running'},
        'actions': ['created', 'started'],
        'events': [],
    }
    eda_client.delete_activation.return_value = {'id': 42, 'status': 'deleted'}
    mocker.patch('awx.main.management.commands.check_external_automation.EDAControllerClient', return_value=eda_client)

    output = StringIO()
    call_command(
        'check_external_automation',
        '--json',
        '--skip-opa',
        '--start-eda-activation',
        '--eda-rulebook-name=codex-smoke.yml',
        '--eda-activation-extra-data={"organization_id":1}',
        '--cleanup-eda-activation',
        stdout=output,
    )
    payload = json.loads(output.getvalue())

    assert payload['ok'] is True
    assert payload['checks']['eda']['activation_start']['status'] == 'started'
    assert payload['checks']['eda']['activation_start']['actions'] == ['created', 'started']
    assert payload['checks']['eda']['activation_start']['cleanup'] == {'id': 42, 'status': 'deleted'}
    eda_client.ensure_activation_started.assert_called_once_with(
        'codex-smoke.yml',
        activation_id='',
        event_source='',
        extra_data={'organization_id': 1},
        poll=True,
        include_events=False,
    )
    eda_client.delete_activation.assert_called_once_with(42)


def test_check_external_automation_can_check_proxmox(mocker):
    session = mocker.Mock()
    session.headers = {}
    version_response = mocker.Mock(ok=True)
    version_response.json.return_value = {'data': {'version': '8.2.7', 'release': '1'}}
    resources_response = mocker.Mock(ok=True)
    resources_response.json.return_value = {
        'data': [
            {'type': 'node', 'node': 'pve1', 'status': 'online'},
            {'type': 'qemu', 'name': 'eda-server', 'status': 'running', 'node': 'pve1', 'vmid': 101},
            {'type': 'qemu', 'name': 'opa-gatekeeper', 'status': 'running', 'node': 'pve1', 'vmid': 102},
            {'type': 'qemu', 'name': 'ubuntu-template', 'template': 1, 'status': 'stopped', 'node': 'pve1', 'vmid': 9000},
        ]
    }
    session.get.side_effect = [version_response, resources_response]
    mocker.patch('awx.main.management.commands.check_external_automation.requests.Session', return_value=session)

    output = StringIO()
    call_command(
        'check_external_automation',
        '--json',
        '--skip-eda',
        '--skip-opa',
        '--skip-gatekeeper',
        '--check-proxmox',
        '--proxmox-api-url=https://proxmox.example.test:8006/api2/json',
        '--proxmox-api-token-id=awx@pve!token',
        '--proxmox-api-token-secret=secret',
        '--proxmox-tls-insecure',
        '--proxmox-expected-vm=eda-server',
        '--proxmox-expected-vm=opa-gatekeeper',
        stdout=output,
    )
    payload = json.loads(output.getvalue())

    proxmox = payload['checks']['proxmox']
    assert payload['ok'] is True
    assert proxmox['status'] == 'available'
    assert proxmox['version'] == '8.2.7'
    assert proxmox['counts'] == {'nodes': 1, 'vms': 2, 'containers': 0, 'templates': 1, 'running_vms': 2}
    assert proxmox['expected_vms_found'] == 2
    assert 'secret' not in json.dumps(proxmox)
    assert session.verify is False
    assert session.headers['Authorization'] == 'PVEAPIToken=awx@pve!token=secret'
    assert session.get.call_args_list[0].args[0] == 'https://proxmox.example.test:8006/api2/json/version'
    assert session.get.call_args_list[1].args[0] == 'https://proxmox.example.test:8006/api2/json/cluster/resources'


@override_settings(
    EDA_SERVER_URL='',
    OPA_HOST='opa.example.test',
    OPA_PORT=8181,
    OPA_SSL=False,
    OPA_POLICY_BUNDLE='package awx.job_launch\nallow := true',
)
def test_check_external_automation_can_sync_opa_policy_bundle(mocker):
    opa_engine = mocker.Mock()
    opa_engine.base_url = 'http://opa.example.test:8181'
    opa_engine.timeout = 1.5
    opa_engine.is_available.return_value = True
    opa_engine.validate_configuration.return_value = None
    opa_engine._headers.return_value = {'Content-Type': 'application/json'}
    opa_engine.put_policy.return_value = {'status_code': 200}
    opa_engine.evaluate.return_value = {'result': True}
    mocker.patch('awx.main.management.commands.check_external_automation.OPAPolicyEngine', return_value=opa_engine)
    mocker.patch('awx.main.management.commands.check_external_automation.opa_cert_file', return_value=contextlib.nullcontext((None, False)))

    health_response = mocker.Mock()
    health_response.status_code = 200
    health_response.raise_for_status.return_value = None
    mocker.patch('awx.main.management.commands.check_external_automation.requests.get', return_value=health_response)

    output = StringIO()
    call_command('check_external_automation', '--json', '--skip-eda', '--sync-opa-policy', '--opa-policy-id=awx/smoke', stdout=output)
    payload = json.loads(output.getvalue())

    assert payload['ok'] is True
    assert payload['checks']['opa']['policy_sync'] == {
        'requested': True,
        'ok': True,
        'status': 'synced',
        'policy_id': 'awx/smoke',
        'size': len('package awx.job_launch\nallow := true'),
        'line_count': 2,
        'sha256': hashlib.sha256(b'package awx.job_launch\nallow := true').hexdigest(),
        'opa_response': {'status_code': 200},
    }
    opa_engine.put_policy.assert_called_once_with('awx/smoke', 'package awx.job_launch\nallow := true')
    opa_engine.evaluate.assert_called_once()


@override_settings(EDA_SERVER_URL='', OPA_HOST='opa.example.test', OPA_PORT=8181, OPA_SSL=False)
def test_check_external_automation_can_run_opa_deny_smoke(mocker):
    opa_engine = mocker.Mock()
    opa_engine.base_url = 'http://opa.example.test:8181'
    opa_engine.timeout = 1.5
    opa_engine.is_available.return_value = True
    opa_engine.validate_configuration.return_value = None
    opa_engine._headers.return_value = {'Content-Type': 'application/json'}
    opa_engine.put_policy.return_value = {'status_code': 200}
    opa_engine.delete_policy.return_value = {'status_code': 204}
    opa_engine.evaluate.side_effect = [{'result': True}, {'result': False}]
    mocker.patch('awx.main.management.commands.check_external_automation.OPAPolicyEngine', return_value=opa_engine)
    mocker.patch('awx.main.management.commands.check_external_automation.opa_cert_file', return_value=contextlib.nullcontext((None, False)))

    health_response = mocker.Mock()
    health_response.status_code = 200
    health_response.raise_for_status.return_value = None
    mocker.patch('awx.main.management.commands.check_external_automation.requests.get', return_value=health_response)

    output = StringIO()
    call_command('check_external_automation', '--json', '--skip-eda', '--opa-deny-smoke', '--opa-deny-policy-id=awx/test_deny', stdout=output)
    payload = json.loads(output.getvalue())
    deny_smoke = payload['checks']['opa']['deny_smoke']

    assert payload['ok'] is True
    assert deny_smoke['ok'] is True
    assert deny_smoke['status'] == 'denied'
    assert deny_smoke['allowed'] is False
    assert deny_smoke['cleanup'] == {'status_code': 204}
    opa_engine.put_policy.assert_called_once()
    assert opa_engine.put_policy.call_args.args[0] == 'awx/test_deny'
    assert 'package awx.codex_deny_smoke' in opa_engine.put_policy.call_args.args[1]
    opa_engine.delete_policy.assert_called_once_with('awx/test_deny')


@override_settings(EDA_SERVER_URL='', OPA_HOST='opa.example.test', OPA_PORT=8181, OPA_SSL=False)
def test_check_external_automation_opa_deny_smoke_fails_on_unexpected_allow(mocker):
    opa_engine = mocker.Mock()
    opa_engine.base_url = 'http://opa.example.test:8181'
    opa_engine.timeout = 1.5
    opa_engine.is_available.return_value = True
    opa_engine.validate_configuration.return_value = None
    opa_engine._headers.return_value = {'Content-Type': 'application/json'}
    opa_engine.put_policy.return_value = {'status_code': 200}
    opa_engine.delete_policy.return_value = {'status_code': 204}
    opa_engine.evaluate.side_effect = [{'result': True}, {'result': True}]
    mocker.patch('awx.main.management.commands.check_external_automation.OPAPolicyEngine', return_value=opa_engine)
    mocker.patch('awx.main.management.commands.check_external_automation.opa_cert_file', return_value=contextlib.nullcontext((None, False)))

    health_response = mocker.Mock()
    health_response.status_code = 200
    health_response.raise_for_status.return_value = None
    mocker.patch('awx.main.management.commands.check_external_automation.requests.get', return_value=health_response)

    output = StringIO()
    with pytest.raises(CommandError):
        call_command('check_external_automation', '--json', '--skip-eda', '--opa-deny-smoke', '--fail-on-unavailable', stdout=output)

    payload = json.loads(output.getvalue())
    deny_smoke = payload['checks']['opa']['deny_smoke']
    assert payload['ok'] is False
    assert payload['checks']['opa']['status'] == 'deny_smoke_failed'
    assert deny_smoke['ok'] is False
    assert deny_smoke['status'] == 'allowed_unexpectedly'
    assert deny_smoke['allowed'] is True
    assert deny_smoke['cleanup'] == {'status_code': 204}
    opa_engine.delete_policy.assert_called_once()


@override_settings(EDA_SERVER_URL='', OPA_HOST='opa.example.test', OPA_PORT=8181, OPA_SSL=False, OPA_POLICY_BUNDLE='')
def test_check_external_automation_opa_policy_sync_requires_bundle(mocker):
    opa_engine = mocker.Mock()
    opa_engine.base_url = 'http://opa.example.test:8181'
    opa_engine.timeout = 1.5
    opa_engine.is_available.return_value = True
    opa_engine.validate_configuration.return_value = None
    opa_engine._headers.return_value = {'Content-Type': 'application/json'}
    mocker.patch('awx.main.management.commands.check_external_automation.OPAPolicyEngine', return_value=opa_engine)
    mocker.patch('awx.main.management.commands.check_external_automation.opa_cert_file', return_value=contextlib.nullcontext((None, False)))

    health_response = mocker.Mock()
    health_response.status_code = 200
    health_response.raise_for_status.return_value = None
    mocker.patch('awx.main.management.commands.check_external_automation.requests.get', return_value=health_response)

    output = StringIO()
    with pytest.raises(CommandError):
        call_command('check_external_automation', '--json', '--skip-eda', '--sync-opa-policy', '--fail-on-unavailable', stdout=output)

    payload = json.loads(output.getvalue())
    assert payload['ok'] is False
    assert payload['checks']['opa']['status'] == 'policy_sync_failed'
    assert payload['checks']['opa']['policy_sync']['status'] == 'empty_policy_bundle'


@override_settings(EDA_SERVER_URL='https://eda.example.test', OPA_HOST='')
def test_check_external_automation_fail_on_unavailable(mocker):
    eda_client = mocker.Mock()
    eda_client.status = 'configured'
    eda_client.controller_url = 'https://eda.example.test'
    eda_client.auth_configured = True
    eda_client.is_configured = True
    eda_client.list_activations.side_effect = EDAControllerError('EDA Controller request failed: 401', 'unreachable')
    mocker.patch('awx.main.management.commands.check_external_automation.EDAControllerClient', return_value=eda_client)

    output = StringIO()
    with pytest.raises(CommandError):
        call_command('check_external_automation', '--json', '--skip-opa', '--fail-on-unavailable', stdout=output)

    payload = json.loads(output.getvalue())
    assert payload['ok'] is False
    assert payload['checks']['eda']['status'] == 'unreachable'
    assert payload['checks']['eda']['error'] == 'EDA Controller request failed: 401'
