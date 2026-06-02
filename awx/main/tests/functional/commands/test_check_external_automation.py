import contextlib
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
