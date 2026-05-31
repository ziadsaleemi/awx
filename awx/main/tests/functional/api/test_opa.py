from unittest import mock

import pytest
from django.test import override_settings

from awx.api.versioning import reverse
from awx.api.views.opa import OPAPolicyEngine, check_opa_policy
from awx.main.tasks.policy import OPA_AUTH_TYPES


@pytest.mark.django_db
@override_settings(OPA_HOST='opa.example.com', OPA_PORT=8181, OPA_SSL=True)
def test_opa_policy_list_uses_registered_policy_settings(get, admin_user):
    response = get(reverse('api:opa_policies'), user=admin_user, expect=200)

    assert response.data['enabled'] is True
    assert response.data['server_url'] == 'https://opa.example.com:8181'
    assert {policy['id'] for policy in response.data['policies']} >= {'job_launch', 'ai_action'}


@pytest.mark.django_db
def test_opa_policy_list_requires_system_admin(get, rando):
    get(reverse('api:opa_policies'), user=rando, expect=403)


@pytest.mark.django_db
@override_settings(OPA_HOST='')
def test_opa_evaluate_disabled_fails_open(get, admin_user):
    response = get(reverse('api:opa_policies'), user=admin_user, expect=200)

    assert response.data['enabled'] is False
    assert response.data['server_url'] == ''


@pytest.mark.django_db
def test_opa_evaluate_requires_system_admin(post, rando):
    post(
        reverse('api:opa_evaluate'),
        data={'policy_path': 'awx/job_launch/allow', 'input': {}},
        user=rando,
        expect=403,
    )


@pytest.mark.django_db
@override_settings(
    OPA_HOST='opa.example.com',
    OPA_PORT=8181,
    OPA_SSL=True,
    OPA_AUTH_TYPE=OPA_AUTH_TYPES.TOKEN,
    OPA_AUTH_TOKEN='secret-token',
    OPA_AUTH_CUSTOM_HEADERS={'X-Custom': 'Header'},
    OPA_REQUEST_TIMEOUT=2.5,
)
def test_opa_evaluate_uses_registered_connection_settings_and_parses_denial(post, admin_user):
    opa_response = mock.Mock()
    opa_response.json.return_value = {'result': {'allowed': False, 'violations': ['blocked']}}
    opa_response.raise_for_status.return_value = None

    with mock.patch('awx.api.views.opa.requests.post', return_value=opa_response) as requests_post:
        response = post(
            reverse('api:opa_evaluate'),
            data={'policy_path': 'awx/job_launch/allow', 'input': {'action': 'launch'}},
            user=admin_user,
            expect=200,
        )

    assert response.data['allowed'] is False
    assert response.data['result'] == {'allowed': False, 'violations': ['blocked']}
    requests_post.assert_called_once_with(
        'https://opa.example.com:8181/v1/data/awx/job_launch/allow',
        json={'input': {'action': 'launch'}},
        timeout=2.5,
        headers={
            'Content-Type': 'application/json',
            'X-Custom': 'Header',
            'Authorization': 'Bearer secret-token',
        },
        cert=None,
        verify=True,
    )


@override_settings(OPA_HOST='opa.example.com', OPA_SSL=False)
def test_check_opa_policy_understands_structured_denial():
    with mock.patch.object(OPAPolicyEngine, 'evaluate', return_value={'result': {'allowed': False, 'violations': ['blocked']}}):
        assert check_opa_policy('awx/ai_action/allow', {'action': 'launch'}) is False
