import pytest
import requests
from django.test import override_settings

from awx.api.versioning import reverse
from awx.main import models


def eda_response(mocker, payload):
    response = mocker.Mock()
    response.status_code = 200
    response.content = b'{}'
    response.raise_for_status.return_value = None
    response.json.return_value = payload
    return response


def eda_error_response(mocker, status_code, text):
    response = mocker.Mock()
    response.status_code = status_code
    response.text = text
    response.content = text.encode()
    response.raise_for_status.side_effect = requests.HTTPError(response=response)
    return response


def eda_openapi_payload(version='0.2.0'):
    return {
        'info': {'title': 'Event Driven Ansible API', 'version': version},
        'paths': {
            '/projects/': {'get': {}, 'post': {}},
            '/projects/{id}/': {'get': {}, 'patch': {}, 'delete': {}},
            '/projects/{id}/sync/': {'post': {}},
        },
    }


def eda_rbac_resource_payloads(organization, user=None, *, assignments=None, teams=None, users=None):
    if users is None:
        users = []
        if user:
            users.append({'id': 50, 'username': user.username, 'email': user.email})
    return {
        'organizations': [{'id': 10, 'name': organization.name}],
        'users': users,
        'teams': teams or [],
        'role-definitions': [
            {'id': 1, 'name': 'Organization Admin', 'content_type': 'shared.organization'},
            {'id': 5, 'name': 'Organization Operator', 'content_type': 'shared.organization'},
            {'id': 6, 'name': 'Organization Auditor', 'content_type': 'shared.organization'},
        ],
        'user-role-assignments': assignments or [],
        'team-role-assignments': [],
    }


def patch_eda_rbac_resources(mocker, payloads):
    return mocker.patch('awx.main.utils.eda_rbac.EDAControllerClient.list_resource_all', side_effect=lambda resource, **kwargs: payloads[resource])


def eda_credential_resource_payloads(organization, *, credential_types=None, credentials=None, users=None, teams=None, assignments=None):
    return {
        'credential-types': credential_types or [],
        'credentials': credentials or [],
        'organizations': [{'id': 10, 'name': organization.name}, {'id': 11, 'name': 'Default'}],
        'users': users or [],
        'teams': teams or [],
        'role-definitions': [
            {'id': 16, 'name': 'EDA Credential Admin', 'content_type': 'eda.edacredential'},
            {'id': 17, 'name': 'EDA Credential Use', 'content_type': 'eda.edacredential'},
        ],
        'user-role-assignments': assignments or [],
        'team-role-assignments': [],
    }


def patch_eda_credential_resources(mocker, payloads):
    return mocker.patch(
        'awx.main.utils.eda_credentials.EDAControllerClient.list_resource_all',
        side_effect=lambda resource, **kwargs: payloads[resource],
    )


def eda_native_credential_payloads(organization):
    credential_type = {
        'id': 21,
        'name': 'Event Engine webhook',
        'description': 'Receives signed events.',
        'managed': False,
        'inputs': {
            'required': ['endpoint', 'token', 'event-name'],
            'fields': [
                {
                    'id': 'endpoint',
                    'label': 'Endpoint',
                    'type': 'string',
                    'hidden': True,
                },
                {
                    'id': 'token',
                    'label': 'Token',
                    'type': 'string',
                    'secret': True,
                    'format': 'aes_key',
                },
            ],
            'metadata': [
                {
                    'id': 'event-name',
                    'label': 'Event name',
                    'type': 'string',
                }
            ],
        },
        'injectors': {
            'file': {'template.token': '{{ token }}'},
            'env': {
                'EDA_ENDPOINT': '{{ endpoint }}',
                'EDA_TOKEN_FILE': '{{ eda.filename.token }}',
            },
        },
    }
    credential = {
        'id': 31,
        'name': 'Operations webhook',
        'description': 'Imported Event Engine credential.',
        'credential_type_id': 21,
        'organization_id': 10,
        'inputs': {
            'endpoint': 'https://events.example.test',
            'token': '$encrypted$',
        },
    }
    return eda_credential_resource_payloads(
        organization,
        credential_types=[credential_type],
        credentials=[credential],
    )


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='')
def test_eda_status_reports_not_configured(get, admin_user):
    response = get(reverse('api:eda_status'), user=admin_user, expect=200)

    assert response.data['configured'] is False
    assert response.data['status'] == 'not_configured'
    assert response.data['controller_url'] == ''
    assert response.data['version'] == ''
    assert response.data['version_detail'] == {}
    assert response.data['version_error'] == ''
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
    assert response.data['activation_start_api_path'] == '/api/eda/v1/activations/{activation_id}/enable/'
    assert response.data['activation_instance_logs_api_path'] == '/api/eda/v1/activation-instances/{activation_instance_id}/logs/'
    assert response.data['activation_events_api_path'] == '/api/eda/v1/activations/{activation_id}/events/'
    assert response.data['activation_poll_attempts'] == 1
    assert response.data['activation_poll_interval'] == 0


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test', EDA_AUTH_TOKEN='eda-token')
def test_eda_status_can_include_version_for_about_modal(get, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.eda.requests.request',
        return_value=eda_response(mocker, eda_openapi_payload()),
    )

    response = get(reverse('api:eda_status') + '?include_version=1', user=admin_user, expect=200)

    assert response.data['configured'] is True
    assert response.data['version'] == '0.2.0'
    assert response.data['compatibility'] == 'compatible'
    assert response.data['compatible'] is True
    assert response.data['missing_capabilities'] == []
    assert response.data['api_contract']['capabilities']['projects.sync'] is True
    assert response.data['version_error'] == ''
    request_mock.assert_called_once()
    assert request_mock.call_args.args[:2] == ('GET', 'https://eda.example.test/api/eda/v1/openapi.json')
    assert request_mock.call_args.kwargs['headers']['Authorization'] == 'Bearer eda-token'


@pytest.mark.django_db
@override_settings(MODULE_EDA_ENABLED=False, EDA_SERVER_URL='https://eda.example.test')
def test_eda_status_reports_module_disabled(get, admin_user):
    response = get(reverse('api:eda_status'), user=admin_user, expect=200)

    assert response.data['configured'] is False
    assert response.data['status'] == 'disabled'
    assert response.data['message'] == 'Event-Driven Ansible module is disabled.'


@pytest.mark.django_db
@override_settings(MODULE_EDA_ENABLED=False, EDA_SERVER_URL='https://eda.example.test')
def test_eda_resource_list_reports_module_disabled(get, admin_user):
    response = get(reverse('api:eda_resource_list', kwargs={'resource': 'projects'}), user=admin_user, expect=200)

    assert response.data['source'] == 'module_disabled'
    assert response.data['resource'] == 'projects'
    assert response.data['count'] == 0
    assert response.data['results'] == []
    assert response.data['detail'] == 'Event-Driven Ansible module is disabled.'


@pytest.mark.django_db
@override_settings(MODULE_EDA_ENABLED=False, EDA_SERVER_URL='https://eda.example.test')
def test_eda_activation_start_rejects_when_module_disabled(post, admin_user, mocker):
    request_mock = mocker.patch('awx.main.utils.eda.requests.request')

    response = post(reverse('api:eda_activation_start'), {'rulebook_name': 'ops'}, user=admin_user, expect=403)

    assert response.data == {
        'detail': 'Event-Driven Ansible module is disabled.',
        'status': 'disabled',
    }
    request_mock.assert_not_called()


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
    assert request_mock.call_args.kwargs['auth'] is None
    assert request_mock.call_args.kwargs['verify'] is False


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test', EDA_AUTH_TOKEN='', EDA_USERNAME='admin', EDA_PASSWORD='eda-pass')
def test_eda_activations_support_basic_auth(get, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.eda.requests.request',
        return_value=eda_response(mocker, {'count': 0, 'next': None, 'previous': None, 'results': []}),
    )

    response = get(reverse('api:eda_activation_list'), user=admin_user, expect=200)

    assert response.data['source'] == 'eda_controller'
    assert response.data['count'] == 0
    assert request_mock.call_args.kwargs['auth'] == ('admin', 'eda-pass')
    assert 'Authorization' not in request_mock.call_args.kwargs['headers']


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test', EDA_AUTH_TOKEN='eda-token', EDA_USERNAME='admin', EDA_PASSWORD='eda-pass')
def test_eda_bearer_token_takes_precedence_over_basic_auth(get, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.eda.requests.request',
        return_value=eda_response(mocker, {'count': 0, 'next': None, 'previous': None, 'results': []}),
    )

    response = get(reverse('api:eda_activation_list'), user=admin_user, expect=200)

    assert response.data['source'] == 'eda_controller'
    assert request_mock.call_args.kwargs['headers']['Authorization'] == 'Bearer eda-token'
    assert request_mock.call_args.kwargs['auth'] is None


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
            eda_response(
                mocker,
                {
                    'id': 42,
                    'name': 'Restart web on alert',
                    'status': 'running',
                    'rulebook_name': 'restart-web.yml',
                    'current_job_id': 84,
                },
            ),
            eda_response(mocker, {'results': [{'id': 9, 'log': 'activation started', 'log_timestamp': '2026-06-01T00:00:00Z'}]}),
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
    assert [call.args[0] for call in request_mock.call_args_list] == ['GET', 'POST', 'POST', 'GET', 'GET', 'GET']
    assert request_mock.call_args_list[1].kwargs['json']['rulebook_name'] == 'Restart web on alert'
    assert request_mock.call_args_list[2].args[1] == 'https://eda.example.test/api/eda/v1/activations/42/enable/'
    assert request_mock.call_args_list[5].args[1] == 'https://eda.example.test/api/eda/v1/activation-instances/84/logs/'


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test', EDA_AUTH_TOKEN='eda-token', EDA_VERIFY_SSL=False)
def test_eda_activation_start_retries_with_upstream_required_ids(post, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.eda.requests.request',
        side_effect=[
            eda_response(mocker, {'count': 0, 'results': []}),
            eda_error_response(mocker, 400, 'Rulebook is required'),
            eda_response(mocker, {'count': 1, 'results': [{'id': 11, 'name': 'codex-smoke.yml'}]}),
            eda_response(mocker, {'count': 1, 'results': [{'id': 12, 'name': 'Codex smoke decision environment'}]}),
            eda_response(mocker, {'count': 1, 'results': [{'id': 13, 'name': 'Default'}]}),
            eda_response(mocker, {'id': 42, 'name': 'codex-smoke.yml', 'status': 'pending', 'rulebook': {'name': 'codex-smoke.yml'}}),
            eda_response(mocker, {'id': 42, 'name': 'codex-smoke.yml', 'status': 'running', 'rulebook': {'name': 'codex-smoke.yml'}}),
        ],
    )

    response = post(
        reverse('api:eda_activation_start'),
        {'rulebook_name': 'codex-smoke.yml', 'poll': False, 'include_events': False},
        user=admin_user,
        expect=200,
    )

    assert response.data['activation']['id'] == 42
    assert response.data['actions'] == ['created', 'started']
    assert [call.args[0] for call in request_mock.call_args_list] == ['GET', 'POST', 'GET', 'GET', 'GET', 'POST', 'POST']
    assert request_mock.call_args_list[5].kwargs['json'] == {
        'name': 'codex-smoke.yml',
        'is_enabled': False,
        'rulebook_id': 11,
        'decision_environment_id': 12,
        'organization_id': 13,
    }


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test', EDA_AUTH_TOKEN='eda-token', EDA_VERIFY_SSL=False)
def test_eda_activation_start_accepts_upstream_fields_from_top_level(post, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.eda.requests.request',
        side_effect=[
            eda_response(mocker, {'count': 0, 'results': []}),
            eda_error_response(mocker, 400, 'Rulebook is required'),
            eda_response(mocker, {'id': 42, 'name': 'codex-smoke.yml', 'status': 'pending', 'rulebook': {'name': 'codex-smoke.yml'}}),
            eda_response(mocker, {'id': 42, 'name': 'codex-smoke.yml', 'status': 'running', 'rulebook': {'name': 'codex-smoke.yml'}}),
        ],
    )

    response = post(
        reverse('api:eda_activation_start'),
        {
            'rulebook_name': 'codex-smoke.yml',
            'rulebook_id': 11,
            'decision_environment_id': 12,
            'organization_id': 13,
            'log_level': 'debug',
            'poll': False,
            'include_events': False,
        },
        user=admin_user,
        expect=200,
    )

    assert response.data['activation']['id'] == 42
    assert response.data['actions'] == ['created', 'started']
    assert [call.args[0] for call in request_mock.call_args_list] == ['GET', 'POST', 'POST', 'POST']
    assert request_mock.call_args_list[2].kwargs['json'] == {
        'rulebook_id': 11,
        'decision_environment_id': 12,
        'organization_id': 13,
        'log_level': 'debug',
        'name': 'codex-smoke.yml',
        'is_enabled': False,
    }


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test', EDA_AUTH_TOKEN='eda-token', EDA_VERIFY_SSL=False)
def test_eda_activation_start_forwards_credentials_and_persistence_fields(post, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.eda.requests.request',
        side_effect=[
            eda_response(mocker, {'count': 0, 'results': []}),
            eda_error_response(mocker, 400, 'Rulebook is required'),
            eda_response(mocker, {'id': 42, 'name': 'codex-smoke.yml', 'status': 'pending', 'rulebook': {'name': 'codex-smoke.yml'}}),
            eda_response(mocker, {'id': 42, 'name': 'codex-smoke.yml', 'status': 'running', 'rulebook': {'name': 'codex-smoke.yml'}}),
        ],
    )

    response = post(
        reverse('api:eda_activation_start'),
        {
            'name': 'credentialed codex smoke',
            'rulebook_name': 'codex-smoke.yml',
            'rulebook_id': 11,
            'decision_environment_id': 12,
            'organization_id': 13,
            'eda_credentials': [21],
            'enable_persistence': True,
            'rule_engine_credential_id': 30,
            'log_level': 'debug',
            'poll': False,
            'include_events': False,
        },
        user=admin_user,
        expect=200,
    )

    assert response.data['activation']['id'] == 42
    assert response.data['actions'] == ['created', 'started']
    assert request_mock.call_args_list[2].kwargs['json'] == {
        'name': 'credentialed codex smoke',
        'rulebook_id': 11,
        'decision_environment_id': 12,
        'organization_id': 13,
        'eda_credentials': [21],
        'enable_persistence': True,
        'rule_engine_credential_id': 30,
        'log_level': 'debug',
        'is_enabled': False,
    }


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test', EDA_AUTH_TOKEN='eda-token')
def test_eda_activation_detail_reads_controller_activation(get, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.eda.requests.request',
        return_value=eda_response(mocker, {'id': 42, 'name': 'Restart web on alert', 'status': 'running', 'rulebook_name': 'restart-web.yml'}),
    )

    response = get(reverse('api:eda_activation_detail', kwargs={'pk': '42'}), user=admin_user, expect=200)

    assert response.data['id'] == 42
    assert response.data['name'] == 'Restart web on alert'
    assert response.data['status'] == 'running'
    assert request_mock.call_args.args[0] == 'GET'
    assert request_mock.call_args.args[1] == 'https://eda.example.test/api/eda/v1/activations/42/'


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_activation_events_reads_controller_events(get, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.eda.requests.request',
        side_effect=[
            eda_response(
                mocker,
                {
                    'id': 42,
                    'name': 'Restart web on alert',
                    'status': 'running',
                    'current_job_id': 84,
                },
            ),
            eda_response(mocker, {'results': [{'id': 9, 'log': 'activation started', 'log_timestamp': '2026-06-01T00:00:00Z'}]}),
        ],
    )

    response = get(reverse('api:eda_activation_events', kwargs={'pk': '42'}), {'page_size': '5'}, user=admin_user, expect=200)

    assert response.data['count'] == 1
    assert response.data['results'][0]['id'] == 9
    assert response.data['results'][0]['message'] == 'activation started'
    assert response.data['results'][0]['created'] == '2026-06-01T00:00:00Z'
    assert [call.args[0] for call in request_mock.call_args_list] == ['GET', 'GET']
    assert request_mock.call_args_list[0].args[1] == 'https://eda.example.test/api/eda/v1/activations/42/'
    assert request_mock.call_args_list[1].args[1] == 'https://eda.example.test/api/eda/v1/activation-instances/84/logs/'
    assert request_mock.call_args.kwargs['params'] == {'page_size': 5}


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_activation_action_posts_controller_action(post, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.eda.requests.request',
        return_value=eda_response(mocker, {'id': 42, 'name': 'Restart web on alert', 'status': 'running'}),
    )

    response = post(reverse('api:eda_activation_action', kwargs={'pk': '42', 'action': 'restart'}), {}, user=admin_user, expect=200)

    assert response.data['activation']['id'] == 42
    assert response.data['actions'] == ['restart']
    assert request_mock.call_args.args[0] == 'POST'
    assert request_mock.call_args.args[1] == 'https://eda.example.test/api/eda/v1/activations/42/restart/'


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_activation_delete_proxies_to_controller(delete, admin_user, mocker):
    request_mock = mocker.patch('awx.main.utils.eda.requests.request', return_value=eda_response(mocker, {}))

    response = delete(reverse('api:eda_activation_detail', kwargs={'pk': '42'}), user=admin_user, expect=202)

    assert response.data == {'id': '42', 'status': 'deleted'}
    assert request_mock.call_args.args[0] == 'DELETE'
    assert request_mock.call_args.args[1] == 'https://eda.example.test/api/eda/v1/activations/42/'


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='')
def test_eda_operator_can_read_activation_facade(get, organization, rando):
    organization.eda_operator_role.members.add(rando)

    response = get(reverse('api:eda_activation_list'), user=rando, expect=200)

    assert response.data['source'] == 'not_configured'


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_operator_can_operate_existing_activation(post, organization, rando, mocker):
    organization.eda_operator_role.members.add(rando)
    control = mocker.patch('awx.api.views.eda.EDAControllerClient.control_activation', return_value={'id': 42, 'status': 'running'})

    response = post(reverse('api:eda_activation_action', kwargs={'pk': '42', 'action': 'restart'}), {}, user=rando, expect=200)

    assert response.data['activation']['id'] == 42
    control.assert_called_once_with('42', 'restart')


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_operator_can_start_existing_activation_by_id(post, organization, rando, mocker):
    organization.eda_operator_role.members.add(rando)
    start = mocker.patch(
        'awx.api.views.eda.EDAControllerClient.ensure_activation_started',
        return_value={'activation': {'id': 42, 'status': 'running'}, 'actions': ['started'], 'events': []},
    )

    response = post(reverse('api:eda_activation_start'), {'activation_id': '42'}, user=rando, expect=200)

    assert response.data['activation']['id'] == 42
    start.assert_called_once()


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_operator_cannot_create_or_delete_activation(post, delete, organization, rando):
    organization.eda_operator_role.members.add(rando)

    post(reverse('api:eda_activation_start'), {'rulebook_name': 'ops'}, user=rando, expect=403)
    post(reverse('api:eda_activation_start'), {'activation_id': '42', 'rulebook_id': 11}, user=rando, expect=403)
    delete(reverse('api:eda_activation_detail', kwargs={'pk': '42'}), user=rando, expect=403)


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_admin_can_create_and_delete_activation(post, delete, organization, rando, mocker):
    organization.eda_admin_role.members.add(rando)
    start = mocker.patch(
        'awx.api.views.eda.EDAControllerClient.ensure_activation_started',
        return_value={'activation': {'id': 42, 'status': 'running'}, 'actions': ['created', 'started'], 'events': []},
    )
    delete_activation = mocker.patch('awx.api.views.eda.EDAControllerClient.delete_activation', return_value={'id': '42', 'status': 'deleted'})

    post(reverse('api:eda_activation_start'), {'rulebook_name': 'ops'}, user=rando, expect=200)
    delete(reverse('api:eda_activation_detail', kwargs={'pk': '42'}), user=rando, expect=202)

    start.assert_called_once()
    delete_activation.assert_called_once_with('42')


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='')
def test_eda_resource_list_reports_not_configured(get, admin_user):
    response = get(reverse('api:eda_resource_list', kwargs={'resource': 'projects'}), user=admin_user, expect=200)

    assert response.data == {
        'count': 0,
        'next': None,
        'previous': None,
        'source': 'not_configured',
        'resource': 'projects',
        'controller_error': '',
        'results': [],
    }


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test', EDA_AUTH_TOKEN='eda-token')
def test_eda_resource_list_proxies_to_controller(get, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.eda.requests.request',
        return_value=eda_response(
            mocker,
            {
                'count': 26,
                'next': 'https://eda.example.test/api/eda/v1/projects/?order_by=name&page=2&page_size=25',
                'previous': None,
                'results': [{'id': 7, 'name': 'Ops project'}],
            },
        ),
    )

    response = get(
        reverse('api:eda_resource_list', kwargs={'resource': 'projects'}),
        {'page': '1', 'page_size': '25', 'order_by': 'name'},
        user=admin_user,
        expect=200,
    )

    assert response.data['source'] == 'eda_controller'
    assert response.data['resource'] == 'projects'
    assert response.data['count'] == 26
    assert response.data['next'].endswith('/api/v2/eda/projects/?order_by=name&page=2&page_size=25')
    assert response.data['next'].startswith('/api/v2/eda/projects/')
    assert response.data['results'][0]['name'] == 'Ops project'
    assert request_mock.call_args.args[0] == 'GET'
    assert request_mock.call_args.args[1] == 'https://eda.example.test/api/eda/v1/projects/'
    assert request_mock.call_args.kwargs['params'] == {'page': '1', 'page_size': '25', 'order_by': 'name'}


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test', EDA_AUTH_TOKEN='eda-token')
def test_eda_resource_list_rewrites_relative_controller_pagination_links(get, admin_user, mocker):
    mocker.patch(
        'awx.main.utils.eda.requests.request',
        return_value=eda_response(
            mocker,
            {
                'count': 2,
                'next': '/api/eda/v1/credential-types/?page=2&page_size=1&order_by=name',
                'previous': '/api/eda/v1/credential-types/?page=1&page_size=1&order_by=name',
                'results': [{'id': 20, 'name': 'Red Hat Ansible Automation Platform'}],
            },
        ),
    )

    response = get(
        reverse('api:eda_resource_list', kwargs={'resource': 'credential-types'}),
        {'page': '1', 'page_size': '1', 'order_by': 'name'},
        user=admin_user,
        expect=200,
    )

    assert response.data['next'].endswith('/api/v2/eda/credential-types/?page=2&page_size=1&order_by=name')
    assert response.data['previous'].endswith('/api/v2/eda/credential-types/?page=1&page_size=1&order_by=name')
    assert response.data['next'].startswith('/api/v2/eda/credential-types/')
    assert response.data['previous'].startswith('/api/v2/eda/credential-types/')
    assert '/api/eda/v1/' not in response.data['next']
    assert '/api/eda/v1/' not in response.data['previous']


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test', EDA_AUTH_TOKEN='eda-token')
@pytest.mark.parametrize(
    'resource,upstream_path',
    [
        ('organizations', '/api/eda/v1/organizations/'),
        ('teams', '/api/eda/v1/teams/'),
        ('users', '/api/eda/v1/users/'),
        ('role-definitions', '/api/eda/v1/roles/'),
        ('user-role-assignments', '/api/eda/v1/role_user_assignments/'),
        ('team-role-assignments', '/api/eda/v1/role_team_assignments/'),
    ],
)
def test_eda_access_resource_list_proxies_to_controller(get, admin_user, mocker, resource, upstream_path):
    request_mock = mocker.patch(
        'awx.main.utils.eda.requests.request',
        return_value=eda_response(mocker, {'count': 1, 'next': None, 'previous': None, 'results': [{'id': 7, 'name': 'EDA resource'}]}),
    )

    response = get(reverse('api:eda_resource_list', kwargs={'resource': resource}), {'page_size': '25'}, user=admin_user, expect=200)

    assert response.data['source'] == 'eda_controller'
    assert response.data['resource'] == resource
    assert response.data['count'] == 1
    assert request_mock.call_args.args[0] == 'GET'
    assert request_mock.call_args.args[1] == f'https://eda.example.test{upstream_path}'
    assert request_mock.call_args.kwargs['params'] == {'page_size': '25'}


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test', EDA_AUTH_TOKEN='eda-token')
def test_eda_optional_access_resource_list_returns_empty_when_controller_does_not_support_endpoint(get, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.eda.requests.request',
        return_value=eda_error_response(mocker, 404, 'not found'),
    )

    response = get(reverse('api:eda_resource_list', kwargs={'resource': 'organizations'}), user=admin_user, expect=200)

    assert response.data['source'] == 'eda_controller'
    assert response.data['resource'] == 'organizations'
    assert response.data['count'] == 0
    assert response.data['results'] == []
    assert response.data['unsupported'] is True
    assert 'not found' in response.data['controller_error']
    assert request_mock.call_args.args[1] == 'https://eda.example.test/api/eda/v1/organizations/'


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test', EDA_AUTH_TOKEN='eda-token')
def test_eda_role_definitions_fall_back_to_legacy_endpoint(get, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.eda.requests.request',
        side_effect=[
            eda_error_response(mocker, 404, 'new roles endpoint missing'),
            eda_response(mocker, {'count': 1, 'next': None, 'previous': None, 'results': [{'id': 7, 'name': 'Organization Admin'}]}),
        ],
    )

    response = get(reverse('api:eda_resource_list', kwargs={'resource': 'role-definitions'}), user=admin_user, expect=200)

    assert response.data['count'] == 1
    assert response.data['results'][0]['name'] == 'Organization Admin'
    assert request_mock.call_args_list[0].args[1] == 'https://eda.example.test/api/eda/v1/roles/'
    assert request_mock.call_args_list[1].args[1] == 'https://eda.example.test/api/eda/v1/role_definitions/'


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test', EDA_AUTH_TOKEN='eda-token')
def test_eda_event_stream_activations_proxy_to_controller(get, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.eda.requests.request',
        return_value=eda_response(
            mocker,
            {
                'count': 2,
                'next': '/api/eda/v1/event-streams/9/activations/?page=2&page_size=1',
                'previous': None,
                'results': [{'id': 42, 'name': 'Webhook activation', 'status': 'running'}],
            },
        ),
    )

    response = get(
        reverse('api:eda_event_stream_activations', kwargs={'pk': '9'}),
        {'page': '1', 'page_size': '1'},
        user=admin_user,
        expect=200,
    )

    assert response.data['source'] == 'eda_controller'
    assert response.data['resource'] == 'event-stream-activations'
    assert response.data['event_stream_id'] == '9'
    assert response.data['count'] == 2
    assert response.data['results'][0]['name'] == 'Webhook activation'
    assert response.data['next'].endswith('/api/v2/eda/event-streams/9/activations/?page=2&page_size=1')
    assert request_mock.call_args.args[0] == 'GET'
    assert request_mock.call_args.args[1] == 'https://eda.example.test/api/eda/v1/event-streams/9/activations/'
    assert request_mock.call_args.kwargs['params'] == {'page': '1', 'page_size': '1'}


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_resource_crud_proxies_to_controller(post, patch, delete, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.eda.requests.request',
        side_effect=[
            eda_response(mocker, {'id': 7, 'name': 'Ops project'}),
            eda_response(mocker, {'id': 7, 'name': 'Renamed ops project'}),
            eda_response(mocker, {}),
        ],
    )

    created = post(
        reverse('api:eda_resource_list', kwargs={'resource': 'projects'}),
        {'name': 'Ops project', 'url': 'https://git.example.test/eda.git', 'organization_id': 1, 'verify_ssl': True},
        user=admin_user,
        expect=201,
    )
    updated = patch(
        reverse('api:eda_resource_detail', kwargs={'resource': 'projects', 'pk': '7'}), {'name': 'Renamed ops project'}, user=admin_user, expect=200
    )
    deleted = delete(reverse('api:eda_resource_detail', kwargs={'resource': 'projects', 'pk': '7'}), user=admin_user, expect=202)

    assert created.data['name'] == 'Ops project'
    assert updated.data['name'] == 'Renamed ops project'
    assert deleted.data == {'id': '7', 'status': 'deleted'}
    assert [call.args[0] for call in request_mock.call_args_list] == ['POST', 'PATCH', 'DELETE']
    assert request_mock.call_args_list[0].args[1] == 'https://eda.example.test/api/eda/v1/projects/'
    assert request_mock.call_args_list[0].kwargs['json'] == {
        'name': 'Ops project',
        'url': 'https://git.example.test/eda.git',
        'organization_id': 1,
        'verify_ssl': True,
    }
    assert request_mock.call_args_list[1].args[1] == 'https://eda.example.test/api/eda/v1/projects/7/'
    assert request_mock.call_args_list[1].kwargs['json'] == {'name': 'Renamed ops project'}
    assert request_mock.call_args_list[2].args[1] == 'https://eda.example.test/api/eda/v1/projects/7/'


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_project_create_defaults_upstream_required_fields(post, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.eda.requests.request',
        side_effect=[
            eda_response(mocker, {'count': 1, 'results': [{'id': 1, 'name': 'Default'}]}),
            eda_response(mocker, {'id': 7, 'name': 'Ops project'}),
        ],
    )

    response = post(
        reverse('api:eda_resource_list', kwargs={'resource': 'projects'}),
        {'name': 'Ops project', 'scm_type': 'git', 'scm_url': 'https://git.example.test/eda.git'},
        user=admin_user,
        expect=201,
    )

    assert response.data['id'] == 7
    assert [call.args[0] for call in request_mock.call_args_list] == ['GET', 'POST']
    assert request_mock.call_args_list[0].args[1] == 'https://eda.example.test/api/eda/v1/organizations/'
    assert request_mock.call_args_list[1].kwargs['json'] == {
        'name': 'Ops project',
        'url': 'https://git.example.test/eda.git',
        'verify_ssl': True,
        'organization_id': 1,
    }


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_decision_environment_create_defaults_organization(post, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.eda.requests.request',
        side_effect=[
            eda_response(mocker, {'count': 1, 'results': [{'id': 1, 'name': 'Default'}]}),
            eda_response(mocker, {'id': 8, 'name': 'Rulebook runtime'}),
        ],
    )

    response = post(
        reverse('api:eda_resource_list', kwargs={'resource': 'decision-environments'}),
        {'name': 'Rulebook runtime', 'image': 'quay.io/ansible/ansible-rulebook:latest'},
        user=admin_user,
        expect=201,
    )

    assert response.data['id'] == 8
    assert [call.args[0] for call in request_mock.call_args_list] == ['GET', 'POST']
    assert request_mock.call_args_list[1].kwargs['json'] == {
        'name': 'Rulebook runtime',
        'image_url': 'quay.io/ansible/ansible-rulebook:latest',
        'organization_id': 1,
    }


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_project_sync_proxies_to_controller(post, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.eda.requests.request',
        return_value=eda_response(mocker, {'id': 7, 'name': 'Ops project', 'import_state': 'pending'}),
    )

    response = post(reverse('api:eda_project_sync', kwargs={'pk': '7'}), {}, user=admin_user, expect=200)

    assert response.data['source'] == 'eda_controller'
    assert response.data['actions'] == ['sync']
    assert response.data['project']['id'] == 7
    assert request_mock.call_args.args[0] == 'POST'
    assert request_mock.call_args.args[1] == 'https://eda.example.test/api/eda/v1/projects/7/sync/'
    assert request_mock.call_args.kwargs['json'] == {}


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_project_sources_list_uses_rbac_filtered_capstan_projects(get, admin_user, project, mocker):
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
                        'id': 77,
                        'name': f'Capstan Project {project.pk} - {project.name}',
                        'description': f'[capstan-project:{project.pk}]',
                        'url': project.scm_url,
                        'scm_branch': project.scm_branch,
                        'scm_refspec': project.scm_refspec,
                        'update_revision_on_launch': project.scm_update_on_launch,
                        'scm_update_cache_timeout': project.scm_update_cache_timeout,
                        'import_state': 'completed',
                        'last_synced_at': '2026-07-30T12:00:00Z',
                    }
                ],
            },
        ),
    )

    response = get(reverse('api:eda_project_source_list'), user=admin_user, expect=200)

    assert response.data['source'] == 'capstan_projects'
    assert response.data['count'] == 1
    assert response.data['results'][0]['id'] == project.pk
    assert response.data['results'][0]['eda_project_id'] == 77
    assert response.data['results'][0]['integration_status'] == 'synced'
    assert response.data['results'][0]['scm_url'] == project.scm_url
    assert response.data['results'][0]['user_capabilities'] == {'edit': True, 'sync': True}
    assert request_mock.call_args.args[:2] == ('GET', 'https://eda.example.test/api/eda/v1/projects/')


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_project_source_sync_launches_durable_project_update(post, admin_user, project, mocker):
    signal_start = mocker.patch.object(models.ProjectUpdate, 'signal_start', return_value=True)
    request_mock = mocker.patch('awx.main.utils.eda.requests.request')

    response = post(reverse('api:eda_project_source_sync', kwargs={'pk': project.pk}), {}, user=admin_user, expect=202)

    project_update = models.ProjectUpdate.objects.get(pk=response.data['project_update'])
    assert response.data['source'] == 'capstan_project'
    assert response.data['capstan_project_id'] == project.pk
    assert response.data['id'] == project_update.pk
    assert response.data['type'] == 'project_update'
    assert response.data['eda_sync'] is True
    assert response.headers['Location'].endswith(f'/api/v2/project_updates/{project_update.pk}/')
    assert project_update.project == project
    assert project_update.launch_type == 'manual'
    assert project_update.eda_sync is True
    signal_start.assert_called_once_with()
    request_mock.assert_not_called()


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_project_source_sync_reports_job_start_failure(post, admin_user, project, mocker):
    mocker.patch.object(models.ProjectUpdate, 'signal_start', return_value=False)

    response = post(reverse('api:eda_project_source_sync', kwargs={'pk': project.pk}), {}, user=admin_user, expect=400)

    assert response.data['detail'] == 'The Event Engine project synchronization job could not be started.'


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_status_reports_capability_compatible_untested_version(get, admin_user, mocker):
    mocker.patch(
        'awx.main.utils.eda.requests.request',
        return_value=eda_response(mocker, eda_openapi_payload(version='0.3.0')),
    )

    response = get(reverse('api:eda_status') + '?include_version=1', user=admin_user, expect=200)

    assert response.data['compatible'] is True
    assert response.data['compatibility'] == 'compatible_untested'
    assert response.data['api_contract']['tested_api_version_spec'] == '>=0.2.0,<0.3.0'


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_operator_can_read_but_not_mutate_generic_resources(get, post, organization, rando, mocker):
    organization.eda_operator_role.members.add(rando)
    request_mock = mocker.patch(
        'awx.main.utils.eda.requests.request',
        return_value=eda_response(mocker, {'count': 0, 'next': None, 'previous': None, 'results': []}),
    )

    get(reverse('api:eda_resource_list', kwargs={'resource': 'projects'}), user=rando, expect=200)
    post(reverse('api:eda_resource_list', kwargs={'resource': 'projects'}), {'name': 'Ops project'}, user=rando, expect=403)

    request_mock.assert_called_once()


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_operator_can_read_but_not_mutate_access_resources(get, post, organization, rando, mocker):
    organization.eda_operator_role.members.add(rando)
    request_mock = mocker.patch(
        'awx.main.utils.eda.requests.request',
        return_value=eda_response(mocker, {'count': 0, 'next': None, 'previous': None, 'results': []}),
    )

    get(reverse('api:eda_resource_list', kwargs={'resource': 'teams'}), user=rando, expect=200)
    post(reverse('api:eda_resource_list', kwargs={'resource': 'teams'}), {'name': 'EDA operators'}, user=rando, expect=403)

    request_mock.assert_called_once()


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_controller_managed_resources_are_read_only(post, patch, delete, admin_user):
    for resource in (
        'rule-audit',
        'rulebooks',
        'organizations',
        'teams',
        'users',
        'role-definitions',
        'user-role-assignments',
        'team-role-assignments',
        'credentials',
        'credential-types',
    ):
        response = post(reverse('api:eda_resource_list', kwargs={'resource': resource}), {'name': 'audit'}, user=admin_user, expect=405)
        patch(reverse('api:eda_resource_detail', kwargs={'resource': resource, 'pk': '1'}), {'name': 'audit'}, user=admin_user, expect=405)
        delete(reverse('api:eda_resource_detail', kwargs={'resource': resource, 'pk': '1'}), user=admin_user, expect=405)
        if resource in ('credentials', 'credential-types'):
            assert 'Capstan Credentials' in response.data['detail']
        elif resource not in ('rule-audit', 'rulebooks'):
            assert 'Capstan Access Management' in response.data['detail']


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_project_sync_rejects_non_admin(post, rando):
    response = post(reverse('api:eda_project_sync', kwargs={'pk': '7'}), {}, user=rando, expect=403)
    assert response.status_code == 403


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_activation_start_rejects_non_admin(post, rando):
    response = post(reverse('api:eda_activation_start'), {'rulebook_name': 'ops'}, user=rando, expect=403)
    assert response.status_code == 403


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_activation_action_rejects_non_admin(post, rando):
    response = post(reverse('api:eda_activation_action', kwargs={'pk': '42', 'action': 'restart'}), {}, user=rando, expect=403)
    assert response.status_code == 403


@pytest.mark.django_db
def test_api_root_includes_eda_status_link(get, admin_user):
    response = get(reverse('api:api_v2_root_view'), user=admin_user, expect=200)

    assert response.data['eda'].endswith('/api/v2/eda/status/')


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_rbac_sync_preview_reports_missing_assignment(get, organization, rando, admin_user, mocker):
    organization.eda_operator_role.members.add(rando)
    patch_eda_rbac_resources(mocker, eda_rbac_resource_payloads(organization, rando))

    response = get(reverse('api:eda_rbac_sync'), user=admin_user, expect=200)

    assert response.data['source'] == 'eda_controller'
    assert response.data['mode'] == 'observe'
    assert response.data['summary']['desired_assignments'] == 1
    assert response.data['summary']['missing_assignments'] == 1
    assert response.data['summary']['extra_assignments'] == 0
    assert response.data['missing_assignments'][0]['actor_type'] == 'user'
    assert response.data['missing_assignments'][0]['actor_name'] == rando.username
    assert response.data['missing_assignments'][0]['eda_role_name'] == 'Organization Operator'
    assert response.data['actions'] == []


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_rbac_service_reconciliation_includes_all_organizations(organization, rando, mocker):
    from awx.main.utils.eda_rbac import build_eda_rbac_sync_report

    second_organization = models.Organization.objects.create(name='Second EDA organization')
    organization.eda_operator_role.members.add(rando)
    second_organization.eda_operator_role.members.add(rando)
    payloads = eda_rbac_resource_payloads(organization, rando)
    payloads['organizations'].append({'id': 11, 'name': second_organization.name})
    patch_eda_rbac_resources(mocker, payloads)

    report = build_eda_rbac_sync_report(mode='observe')

    assert report['summary']['awx_organizations'] == 2
    assert report['summary']['desired_assignments'] == 2
    assert {assignment['awx_organization_name'] for assignment in report['desired_assignments']} == {
        organization.name,
        second_organization.name,
    }


@pytest.mark.django_db
@override_settings(MODULE_EDA_ENABLED=True, EDA_SERVER_URL='https://eda.example.test')
def test_eda_rbac_change_schedules_reconciliation_after_commit(mocker):
    from awx.main.signals import schedule_eda_rbac_reconciliation

    mocker.patch('awx.main.signals.is_testing', return_value=False)
    on_commit = mocker.patch('awx.main.signals.connection.on_commit')
    reconcile = mocker.patch('awx.main.signals.reconcile_eda_rbac.delay')

    schedule_eda_rbac_reconciliation(action='post_add')

    on_commit.assert_called_once()
    on_commit.call_args.args[0]()
    reconcile.assert_called_once_with()


@pytest.mark.django_db
@override_settings(MODULE_EDA_ENABLED=True, EDA_SERVER_URL='https://eda.example.test')
def test_eda_configuration_change_schedules_initial_reconciliation(mocker):
    from awx.main.signals import schedule_eda_configuration_reconciliation

    mocker.patch('awx.main.signals.is_testing', return_value=False)
    on_commit = mocker.patch('awx.main.signals.connection.on_commit')
    reconcile = mocker.patch('awx.main.signals.reconcile_eda_rbac.delay')

    schedule_eda_configuration_reconciliation(setting='EDA_SERVER_URL')

    on_commit.assert_called_once()
    on_commit.call_args.args[0]()
    reconcile.assert_called_once_with(refresh_credential_secrets=True)


@pytest.mark.django_db
@override_settings(MODULE_EDA_ENABLED=True, EDA_SERVER_URL='https://eda.example.test')
def test_unrelated_configuration_change_does_not_schedule_eda_reconciliation(mocker):
    from awx.main.signals import schedule_eda_configuration_reconciliation

    mocker.patch('awx.main.signals.is_testing', return_value=False)
    on_commit = mocker.patch('awx.main.signals.connection.on_commit')

    schedule_eda_configuration_reconciliation(setting='CUSTOM_LOGO')

    on_commit.assert_not_called()


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_rbac_sync_creates_missing_assignment(post, organization, rando, admin_user, mocker):
    organization.eda_operator_role.members.add(rando)
    patch_eda_rbac_resources(mocker, eda_rbac_resource_payloads(organization, rando))
    create_resource = mocker.patch('awx.main.utils.eda_rbac.EDAControllerClient.create_resource', return_value={'id': 99})

    response = post(reverse('api:eda_rbac_sync'), {'mode': 'sync'}, user=admin_user, expect=200)

    assert response.data['summary']['actions'] == 1
    assert response.data['actions'][0]['action'] == 'create_assignment'
    create_resource.assert_called_once_with(
        'user-role-assignments',
        {'user': 50, 'role_definition': 5, 'content_type': 'shared.organization', 'object_id': 10},
    )


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_rbac_sync_projects_organization_credential_administrator(get, organization, rando, admin_user, mocker):
    organization.credential_admin_role.members.add(rando)
    payloads = eda_rbac_resource_payloads(organization, rando)
    payloads['role-definitions'].append(
        {
            'id': 18,
            'name': 'Organization EDA Credential Admin',
            'content_type': 'shared.organization',
        }
    )
    patch_eda_rbac_resources(mocker, payloads)

    response = get(reverse('api:eda_rbac_sync'), user=admin_user, expect=200)

    assert response.data['summary']['desired_assignments'] == 1
    assert response.data['missing_assignments'][0]['actor_name'] == rando.username
    assert response.data['missing_assignments'][0]['awx_role_label'] == 'Credential Administrator'
    assert response.data['missing_assignments'][0]['eda_role_name'] == 'Organization EDA Credential Admin'


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_rbac_sync_creates_missing_user_with_generated_password(post, organization, rando, admin_user, mocker):
    organization.eda_operator_role.members.add(rando)
    patch_eda_rbac_resources(mocker, eda_rbac_resource_payloads(organization, users=[]))
    create_resource = mocker.patch(
        'awx.main.utils.eda_rbac.EDAControllerClient.create_resource',
        side_effect=[
            {'id': 50, 'username': rando.username, 'email': rando.email},
            {'id': 99},
        ],
    )

    response = post(reverse('api:eda_rbac_sync'), {'mode': 'sync'}, user=admin_user, expect=200)

    assert response.data['summary']['actions'] == 2
    assert response.data['actions'][0]['resource'] == 'users'
    assert response.data['actions'][1]['resource'] == 'user-role-assignments'
    user_payload = create_resource.call_args_list[0].args[1]
    assert create_resource.call_args_list[0].args[0] == 'users'
    assert user_payload['username'] == rando.username
    assert isinstance(user_payload['password'], str)
    assert len(user_payload['password']) >= 32
    assert create_resource.call_args_list[1].args == (
        'user-role-assignments',
        {'user': 50, 'role_definition': 5, 'content_type': 'shared.organization', 'object_id': 10},
    )


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_rbac_sync_supports_legacy_short_organization_role_names(get, organization, rando, admin_user, mocker):
    organization.eda_operator_role.members.add(rando)
    payloads = eda_rbac_resource_payloads(organization, rando)
    payloads['role-definitions'] = [{'id': 5, 'name': 'Operator', 'content_type': 'shared.organization'}]
    patch_eda_rbac_resources(mocker, payloads)

    response = get(reverse('api:eda_rbac_sync'), user=admin_user, expect=200)

    assert response.data['summary']['desired_assignments'] == 1
    assert response.data['missing_identities']['role_definitions'] == [
        {
            'name': 'Organization Admin',
            'content_type': 'shared.organization',
            'awx_role_field': 'admin_role',
            'aliases': ['Admin'],
        },
        {
            'name': 'Organization Admin',
            'content_type': 'shared.organization',
            'awx_role_field': 'eda_admin_role',
            'aliases': ['Admin'],
        },
        {
            'name': 'Organization Auditor',
            'content_type': 'shared.organization',
            'awx_role_field': 'auditor_role',
            'aliases': ['Auditor', 'Organization Viewer'],
        },
        {
            'name': 'Organization EDA Credential Admin',
            'content_type': 'shared.organization',
            'awx_role_field': 'credential_admin_role',
            'aliases': ['EDA Credential Admin'],
        },
    ]


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_rbac_sync_enforce_removes_stale_awx_known_assignment(post, organization, rando, admin_user, mocker):
    assignments = [{'id': 77, 'user': 50, 'role_definition': 5, 'content_type': 'shared.organization', 'object_id': 10}]
    patch_eda_rbac_resources(mocker, eda_rbac_resource_payloads(organization, rando, assignments=assignments))
    delete_resource = mocker.patch('awx.main.utils.eda_rbac.EDAControllerClient.delete_resource', return_value={'status': 'deleted'})

    response = post(reverse('api:eda_rbac_sync'), {'mode': 'enforce'}, user=admin_user, expect=200)

    assert response.data['summary']['desired_assignments'] == 0
    assert response.data['summary']['extra_assignments'] == 1
    assert response.data['summary']['actions'] == 1
    assert response.data['extra_assignments'][0]['eda_actor_name'] == rando.username
    delete_resource.assert_called_once_with('user-role-assignments', 77)


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_rbac_sync_creates_missing_team_identity_and_assignment(post, organization, admin_user, mocker):
    team = models.Team.objects.create(name='EDA operators', organization=organization)
    team.member_role.children.add(organization.eda_operator_role)
    patch_eda_rbac_resources(mocker, eda_rbac_resource_payloads(organization, teams=[]))
    create_resource = mocker.patch(
        'awx.main.utils.eda_rbac.EDAControllerClient.create_resource',
        side_effect=[
            {'id': 88, 'name': team.name, 'organization_id': 10},
            {'id': 99},
        ],
    )

    response = post(reverse('api:eda_rbac_sync'), {'mode': 'sync'}, user=admin_user, expect=200)

    assert response.data['summary']['actions'] == 2
    assert response.data['actions'][0]['resource'] == 'teams'
    assert response.data['actions'][1]['resource'] == 'team-role-assignments'
    assert create_resource.call_args_list[0].args == ('teams', {'name': team.name, 'organization_id': '10', 'description': 'Managed by AWX RBAC sync'})
    assert create_resource.call_args_list[1].args == (
        'team-role-assignments',
        {'team': 88, 'role_definition': 5, 'content_type': 'shared.organization', 'object_id': 10},
    )


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_rbac_sync_rejects_operator(post, organization, rando):
    organization.eda_operator_role.members.add(rando)

    response = post(reverse('api:eda_rbac_sync'), {'mode': 'sync'}, user=rando, expect=403)

    assert response.status_code == 403


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_credential_sync_projects_type_credential_and_secret_without_leaking_it(post, organization, admin_user, mocker):
    credential_type = models.CredentialType.objects.create(
        name='Capstan API',
        kind='cloud',
        inputs={
            'fields': [
                {'id': 'endpoint', 'label': 'Endpoint', 'type': 'string'},
                {'id': 'token', 'label': 'Token', 'type': 'string', 'secret': True},
            ]
        },
        injectors={
            'file': {'template.token': '{{ token }}'},
            'env': {
                'CAPSTAN_ENDPOINT': '{{ endpoint }}',
                'CAPSTAN_TOKEN': '{{ token }}',
                'CAPSTAN_TOKEN_FILE': '{{ tower.filename.token }}',
            },
        },
    )
    credential = models.Credential.objects.create(
        name='Capstan API production',
        organization=organization,
        credential_type=credential_type,
        inputs={'endpoint': 'https://api.example.test', 'token': 'never-return-this-token'},
    )
    patch_eda_credential_resources(mocker, eda_credential_resource_payloads(organization))

    def create_resource(resource, payload):
        if resource == 'credential-types':
            return {'id': 20, **payload, 'managed': False}
        if resource == 'credentials':
            return {
                'id': 30,
                'name': payload['name'],
                'description': payload['description'],
                'credential_type_id': payload['credential_type_id'],
                'organization_id': payload['organization_id'],
            }
        raise AssertionError(f'Unexpected EDA create resource: {resource}')

    create = mocker.patch('awx.main.utils.eda_credentials.EDAControllerClient.create_resource', side_effect=create_resource)

    response = post(
        reverse('api:eda_credential_sync'),
        {'mode': 'sync', 'refresh_secrets': True},
        user=admin_user,
        expect=200,
    )

    assert response.data['summary']['capstan_credential_types'] == 1
    assert response.data['summary']['capstan_credentials'] == 1
    assert response.data['summary']['projected_credential_types'] == 1
    assert response.data['summary']['projected_credentials'] == 1
    assert response.data['secret_values_included'] is False
    assert 'never-return-this-token' not in str(response.data)
    assert response.data['desired_credentials'][0]['input_fields'] == ['endpoint', 'token']
    assert response.data['actions'][1]['input_fields'] == ['endpoint', 'token']
    credential_payload = create.call_args_list[1].args[1]
    assert credential_payload['inputs'] == {
        'endpoint': 'https://api.example.test',
        'token': 'never-return-this-token',
    }
    assert credential_payload['description'].startswith(f'[capstan-credential:{credential.pk}]')
    type_payload = create.call_args_list[0].args[1]
    assert type_payload['injectors']['env']['CAPSTAN_TOKEN_FILE'] == '{{ eda.filename.token }}'
    assert credential_type.injectors['env']['CAPSTAN_TOKEN_FILE'] == '{{ tower.filename.token }}'


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_credential_sync_reuses_compatible_managed_type_and_projects_use_access(
    post,
    organization,
    rando,
    admin_user,
    credentialtype_scm,
    mocker,
):
    credential = models.Credential.objects.create(
        name='Git source',
        organization=organization,
        credential_type=credentialtype_scm,
        inputs={'username': 'git-user', 'password': 'git-secret'},
    )
    credential.use_role.members.add(rando)
    payloads = eda_credential_resource_payloads(
        organization,
        credential_types=[
            {
                'id': 21,
                'name': credentialtype_scm.name,
                'namespace': credentialtype_scm.namespace,
                'managed': True,
                'inputs': credentialtype_scm.inputs,
                'injectors': credentialtype_scm.injectors,
            }
        ],
        users=[{'id': 50, 'username': rando.username}],
    )
    patch_eda_credential_resources(mocker, payloads)

    def create_resource(resource, payload):
        if resource == 'credentials':
            return {
                'id': 31,
                'name': payload['name'],
                'description': payload['description'],
                'credential_type_id': payload['credential_type_id'],
                'organization_id': payload['organization_id'],
            }
        if resource == 'user-role-assignments':
            return {'id': 70, **payload}
        raise AssertionError(f'Unexpected EDA create resource: {resource}')

    create = mocker.patch('awx.main.utils.eda_credentials.EDAControllerClient.create_resource', side_effect=create_resource)

    response = post(reverse('api:eda_credential_sync'), {'mode': 'sync'}, user=admin_user, expect=200)

    assert response.data['summary']['projected_credential_types'] == 1
    assert response.data['summary']['projected_credentials'] == 1
    assert response.data['summary']['desired_access_assignments'] == 1
    assert response.data['missing_access_assignments'][0]['actor_name'] == rando.username
    assert response.data['missing_access_assignments'][0]['role_name'] == 'EDA Credential Use'
    assert create.call_args_list[0].args[0] == 'credentials'
    assert create.call_args_list[1].args == (
        'user-role-assignments',
        {
            'user': 50,
            'role_definition': 17,
            'content_type': 'eda.edacredential',
            'object_id': 31,
        },
    )


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_credential_sync_rejects_dynamic_secret_sources_without_resolving_them(
    post,
    organization,
    admin_user,
    credentialtype_scm,
    mocker,
):
    credential = models.Credential.objects.create(
        name='Dynamic Git source',
        organization=organization,
        credential_type=credentialtype_scm,
        inputs={'username': 'git-user'},
    )
    mocker.patch.object(models.Credential, 'dynamic_input_fields', new_callable=mocker.PropertyMock, return_value=['password'])
    payloads = eda_credential_resource_payloads(
        organization,
        credential_types=[
            {
                'id': 21,
                'name': credentialtype_scm.name,
                'namespace': credentialtype_scm.namespace,
                'managed': True,
            }
        ],
    )
    patch_eda_credential_resources(mocker, payloads)
    create = mocker.patch('awx.main.utils.eda_credentials.EDAControllerClient.create_resource')

    response = post(reverse('api:eda_credential_sync'), {'mode': 'sync'}, user=admin_user, expect=200)

    assert response.data['summary']['projected_credentials'] == 0
    assert response.data['errors'][0]['action'] == 'resolve_credential_inputs'
    assert response.data['errors'][0]['name'] == credential.name
    create.assert_not_called()


@pytest.mark.django_db
@override_settings(MODULE_EDA_ENABLED=True, EDA_SERVER_URL='https://eda.example.test')
def test_eda_credential_change_schedules_secret_refresh_after_commit(mocker):
    from awx.main.signals import schedule_eda_credential_reconciliation

    mocker.patch('awx.main.signals.is_testing', return_value=False)
    on_commit = mocker.patch('awx.main.signals.connection.on_commit')
    reconcile = mocker.patch('awx.main.signals.reconcile_eda_rbac.delay')

    schedule_eda_credential_reconciliation()

    on_commit.assert_called_once()
    on_commit.call_args.args[0]()
    reconcile.assert_called_once_with(refresh_credential_secrets=True)


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_credential_sync_rejects_operator(post, organization, rando):
    organization.eda_operator_role.members.add(rando)

    response = post(reverse('api:eda_credential_sync'), {'mode': 'sync'}, user=rando, expect=403)

    assert response.status_code == 403


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_credential_import_preview_does_not_change_capstan(get, organization, admin_user, mocker):
    patch_eda_credential_resources(mocker, eda_native_credential_payloads(organization))

    response = get(reverse('api:eda_credential_import'), user=admin_user, expect=200)

    assert response.data['mode'] == 'preview'
    assert response.data['secret_values_included'] is False
    assert response.data['summary'] == {
        'eda_credential_types': 1,
        'eda_credentials': 1,
        'importable_credential_types': 1,
        'importable_credentials': 1,
        'existing': 0,
        'secrets_required': 1,
        'actions': 0,
        'errors': 0,
    }
    assert response.data['credentials'][0]['missing_secret_fields'] == ['token']
    assert '$encrypted$' not in str(response.data)
    assert not models.CredentialType.objects.filter(name='Event Engine webhook').exists()
    assert not models.Credential.objects.filter(name='Operations webhook').exists()


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_credential_import_copies_types_and_non_secret_inputs_idempotently(post, organization, admin_user, mocker):
    payloads = eda_native_credential_payloads(organization)
    patch_eda_credential_resources(mocker, payloads)

    response = post(reverse('api:eda_credential_import'), {}, user=admin_user, expect=200)

    assert response.data['mode'] == 'apply'
    assert response.data['summary']['actions'] == 2
    assert response.data['summary']['secrets_required'] == 1
    credential_type = models.CredentialType.objects.get(name='Event Engine webhook')
    credential = models.Credential.objects.get(name='Operations webhook')
    assert credential_type.kind == 'cloud'
    assert credential_type.description.startswith('[eda-credential-type:21]')
    assert credential_type.inputs == {
        'fields': [
            {'id': 'endpoint', 'label': 'Endpoint', 'type': 'string'},
            {'id': 'token', 'label': 'Token', 'type': 'string', 'secret': True},
        ],
        'required': ['endpoint', 'token'],
    }
    assert credential_type.injectors['env']['EDA_TOKEN_FILE'] == '{{ tower.filename.token }}'
    assert credential.description.startswith('[eda-credential:31]\n[eda-missing-secrets:token]')
    assert credential.inputs == {'endpoint': 'https://events.example.test'}
    assert 'token' not in credential.inputs
    assert '$encrypted$' not in str(response.data)

    repeated = post(reverse('api:eda_credential_import'), {}, user=admin_user, expect=200)

    assert repeated.data['summary']['actions'] == 0
    assert repeated.data['summary']['existing'] == 2
    assert models.CredentialType.objects.filter(name='Event Engine webhook').count() == 1
    assert models.Credential.objects.filter(name='Operations webhook').count() == 1


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_credential_import_requires_system_administrator(get, post, organization, rando, mocker):
    organization.eda_admin_role.members.add(rando)
    list_resources = patch_eda_credential_resources(mocker, eda_native_credential_payloads(organization))

    get(reverse('api:eda_credential_import'), user=rando, expect=403)
    post(reverse('api:eda_credential_import'), {}, user=rando, expect=403)

    list_resources.assert_not_called()


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test')
def test_eda_credential_sync_does_not_overwrite_imported_credential_until_secret_is_entered(
    post,
    organization,
    admin_user,
    mocker,
):
    payloads = eda_native_credential_payloads(organization)
    patch_eda_credential_resources(mocker, payloads)
    post(reverse('api:eda_credential_import'), {}, user=admin_user, expect=200)
    update_resource = mocker.patch(
        'awx.main.utils.eda_credentials.EDAControllerClient.update_resource',
        side_effect=lambda resource, pk, payload: {'id': pk, **payload, 'managed': False},
    )

    response = post(
        reverse('api:eda_credential_sync'),
        {'mode': 'enforce', 'refresh_secrets': True},
        user=admin_user,
        expect=200,
    )

    assert response.data['summary']['projected_credentials'] == 1
    assert response.data['summary']['errors'] == 1
    assert response.data['errors'][0]['action'] == 'resolve_credential_inputs'
    assert 'enter these secret fields in Capstan' in response.data['errors'][0]['detail']
    assert all(call.args[0] == 'credential-types' for call in update_resource.call_args_list)
