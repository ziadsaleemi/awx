import pytest
import requests
from django.test import override_settings

from awx.api.versioning import reverse


def galaxy_response(mocker, payload):
    response = mocker.Mock()
    response.content = b'{}'
    response.raise_for_status.return_value = None
    response.json.return_value = payload
    return response


@pytest.mark.django_db
@override_settings(MODULE_GALAXY_NG_ENABLED=False, GALAXY_NG_SERVER_URL='https://hub.example.test')
def test_galaxy_ng_status_reports_module_disabled(get, admin_user):
    response = get(reverse('api:galaxy_ng_status'), user=admin_user, expect=200)

    assert response.data['enabled'] is False
    assert response.data['configured'] is False
    assert response.data['status'] == 'disabled'
    assert response.data['server_url'] == ''
    assert response.data['settings_url'].endswith('/api/v2/settings/galaxy_ng/')


@pytest.mark.django_db
@override_settings(MODULE_GALAXY_NG_ENABLED=True, GALAXY_NG_SERVER_URL='')
def test_galaxy_ng_status_reports_not_configured(get, admin_user):
    response = get(reverse('api:galaxy_ng_status'), user=admin_user, expect=200)

    assert response.data['enabled'] is True
    assert response.data['configured'] is False
    assert response.data['status'] == 'not_configured'
    assert response.data['counts'] == {
        'namespaces': 0,
        'collections': 0,
        'repositories': 0,
        'tasks': 0,
    }


@pytest.mark.django_db
@override_settings(
    MODULE_GALAXY_NG_ENABLED=True,
    GALAXY_NG_SERVER_URL='https://hub.example.test',
    GALAXY_NG_AUTH_TOKEN='hub-token',
    GALAXY_NG_VERIFY_SSL=False,
    GALAXY_NG_REQUEST_TIMEOUT=3,
)
def test_galaxy_ng_status_reads_live_counts(get, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.galaxy_ng.requests.get',
        side_effect=[
            galaxy_response(mocker, {'database_connection': {'connected': True}}),
            galaxy_response(mocker, {'count': 2, 'results': []}),
            galaxy_response(mocker, {'count': 5, 'results': []}),
            galaxy_response(mocker, {'count': 3, 'results': []}),
            galaxy_response(mocker, {'count': 8, 'results': []}),
        ],
    )

    response = get(reverse('api:galaxy_ng_status'), user=admin_user, expect=200)

    assert response.data['enabled'] is True
    assert response.data['configured'] is True
    assert response.data['status'] == 'configured'
    assert response.data['server_url'] == 'https://hub.example.test'
    assert response.data['api_root_url'] == 'https://hub.example.test/api/galaxy/'
    assert response.data['content_url'] == 'https://hub.example.test/pulp/content/'
    assert response.data['ui_url'] == 'https://hub.example.test/ui/'
    assert response.data['auth_configured'] is True
    assert response.data['verify_ssl'] is False
    assert response.data['request_timeout'] == 3
    assert response.data['counts'] == {
        'namespaces': 2,
        'collections': 5,
        'repositories': 3,
        'tasks': 8,
    }
    assert response.data['controller_error'] == ''
    assert request_mock.call_count == 5
    first_call = request_mock.call_args_list[0]
    assert first_call.args[0] == 'https://hub.example.test/api/galaxy/pulp/api/v3/status/'
    assert first_call.kwargs['headers']['Authorization'] == 'Bearer hub-token'
    assert first_call.kwargs['verify'] is False
    assert first_call.kwargs['timeout'] == 3


@pytest.mark.django_db
@override_settings(MODULE_GALAXY_NG_ENABLED=True, GALAXY_NG_SERVER_URL='https://hub.example.test')
def test_galaxy_ng_status_fails_soft_when_controller_unreachable(get, admin_user, mocker):
    mocker.patch('awx.main.utils.galaxy_ng.requests.get', side_effect=requests.Timeout('boom'))

    response = get(reverse('api:galaxy_ng_status'), user=admin_user, expect=200)

    assert response.data['configured'] is True
    assert response.data['counts']['collections'] == 0
    assert 'boom' in response.data['controller_error']
