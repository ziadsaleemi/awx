import pytest
import requests
from django.test import override_settings

from awx.api.versioning import reverse


def eda_response(mocker, payload):
    response = mocker.Mock()
    response.status_code = 200
    response.content = b'{}'
    response.raise_for_status.return_value = None
    response.json.return_value = payload
    return response


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='')
def test_eda_status_reports_not_configured(get, admin_user):
    response = get(reverse('api:eda_status'), user=admin_user, expect=200)

    assert response.data['configured'] is False
    assert response.data['status'] == 'not_configured'
    assert response.data['controller_url'] == ''
    assert response.data['auth_configured'] is False
    assert response.data['settings_url'].endswith('/api/v2/settings/eda/')
    assert response.data['activations_url'].endswith('/api/v2/eda/activations/')


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test', EDA_AUTH_TOKEN='eda-token', EDA_VERIFY_SSL=False, EDA_REQUEST_TIMEOUT=7)
def test_eda_status_reports_configured_controller(get, admin_user):
    response = get(reverse('api:eda_status'), user=admin_user, expect=200)

    assert response.data['configured'] is True
    assert response.data['status'] == 'configured'
    assert response.data['controller_url'] == 'https://eda.example.test'
    assert response.data['auth_configured'] is True
    assert response.data['verify_ssl'] is False
    assert response.data['request_timeout'] == 7
    assert response.data['activations_api_path'] == '/api/eda/v1/activations/'
    assert response.data['activation_start_api_path'] == '/api/eda/v1/activations/{activation_id}/start/'
    assert response.data['activation_events_api_path'] == '/api/eda/v1/activations/{activation_id}/events/'
    assert response.data['activation_poll_attempts'] == 1
    assert response.data['activation_poll_interval'] == 0


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_activations_fall_back_when_controller_unreachable(get, admin_user, mocker):
    mocker.patch('awx.main.utils.eda.requests.request', side_effect=requests.Timeout)

    response = get(reverse('api:eda_activation_list'), user=admin_user, expect=200)

    assert response.data == {
        'count': 0,
        'next': None,
        'previous': None,
        'source': 'awx_job_match',
        'controller_error': 'EDA Controller request timed out.',
        'results': [],
    }


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test', EDA_AUTH_TOKEN='eda-token', EDA_VERIFY_SSL=False)
def test_eda_activations_are_read_from_controller(get, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.eda.requests.request',
        return_value=eda_response(
            mocker,
            {
                'count': 1,
                'next': None,
                'previous': None,
                'results': [
                    {
                        'id': 42,
                        'name': 'Restart web on alert',
                        'status': 'running',
                        'rulebook_name': 'restart-web.yml',
                        'event_source': {'name': 'Webhook'},
                    }
                ],
            },
        ),
    )

    response = get(reverse('api:eda_activation_list'), user=admin_user, expect=200)

    assert response.data['source'] == 'eda_controller'
    assert response.data['controller_error'] == ''
    assert response.data['count'] == 1
    assert response.data['results'][0]['id'] == 42
    assert response.data['results'][0]['name'] == 'Restart web on alert'
    assert response.data['results'][0]['status'] == 'running'
    assert response.data['results'][0]['rulebook'] == 'restart-web.yml'
    assert response.data['results'][0]['event_source'] == 'Webhook'
    request_mock.assert_called_once()
    assert request_mock.call_args.args[0] == 'GET'
    assert request_mock.call_args.kwargs['headers']['Authorization'] == 'Bearer eda-token'
    assert request_mock.call_args.kwargs['verify'] is False


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test', EDA_AUTH_TOKEN='eda-token', EDA_VERIFY_SSL=False)
def test_eda_activation_start_creates_starts_polls_and_reads_events(post, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.eda.requests.request',
        side_effect=[
            eda_response(mocker, {'count': 0, 'results': []}),
            eda_response(mocker, {'id': 42, 'name': 'Restart web on alert', 'status': 'created', 'rulebook_name': 'restart-web.yml'}),
            eda_response(mocker, {'id': 42, 'name': 'Restart web on alert', 'status': 'running', 'rulebook_name': 'restart-web.yml'}),
            eda_response(mocker, {'id': 42, 'name': 'Restart web on alert', 'status': 'running', 'rulebook_name': 'restart-web.yml'}),
            eda_response(mocker, {'results': [{'id': 9, 'event_type': 'rule', 'message': 'activation started'}]}),
        ],
    )

    response = post(
        reverse('api:eda_activation_start'),
        {'rulebook_name': 'Restart web on alert', 'event_source': 'Webhook'},
        user=admin_user,
        expect=200,
    )

    assert response.data['activation']['id'] == 42
    assert response.data['activation']['status'] == 'running'
    assert response.data['actions'] == ['created', 'started', 'polled', 'events']
    assert response.data['events'][0]['message'] == 'activation started'
    assert [call.args[0] for call in request_mock.call_args_list] == ['GET', 'POST', 'POST', 'GET', 'GET']
    assert request_mock.call_args_list[1].kwargs['json']['rulebook_name'] == 'Restart web on alert'
    assert request_mock.call_args_list[2].args[1] == 'https://eda.example.test/api/eda/v1/activations/42/start/'


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_activation_start_rejects_non_admin(post, rando):
    response = post(reverse('api:eda_activation_start'), {'rulebook_name': 'ops'}, user=rando, expect=403)
    assert response.status_code == 403


@pytest.mark.django_db
def test_api_root_includes_eda_status_link(get, admin_user):
    response = get(reverse('api:api_v2_root_view'), user=admin_user, expect=200)

    assert response.data['eda'].endswith('/api/v2/eda/status/')
