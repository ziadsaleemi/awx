import pytest

from awx.api.versioning import reverse

pytestmark = pytest.mark.django_db


def test_external_automation_check_requires_system_admin(post, rando):
    post(reverse('api:external_automation_check'), {}, user=rando, expect=403)


def test_external_automation_check_runs_shared_smoke(post, admin_user, mocker):
    check = mocker.patch(
        'awx.api.views.external_automation.run_external_automation_checks',
        return_value={
            'ok': True,
            'checks': {
                'eda': {'ok': True, 'status': 'available'},
                'opa': {'ok': True, 'status': 'available', 'deny_smoke': {'ok': True, 'status': 'denied'}},
            },
        },
    )

    response = post(
        reverse('api:external_automation_check'),
        {
            'include_eda': True,
            'include_opa': True,
            'sync_opa_policy': True,
            'opa_policy_id': 'awx/ui_smoke',
            'opa_deny_smoke': True,
            'start_eda_activation': False,
        },
        user=admin_user,
        expect=200,
    )

    assert response.data['ok'] is True
    assert response.data['checks']['opa']['deny_smoke']['status'] == 'denied'
    check.assert_called_once_with(
        include_eda=True,
        include_opa=True,
        start_eda_activation=False,
        eda_rulebook_name='codex-smoke.yml',
        eda_activation_id='',
        eda_event_source='',
        eda_activation_extra_data='{}',
        eda_include_events=False,
        cleanup_eda_activation=False,
        sync_opa_policy=True,
        opa_policy_id='awx/ui_smoke',
        opa_deny_smoke=True,
        opa_deny_policy_id='awx/codex_deny_smoke',
    )
