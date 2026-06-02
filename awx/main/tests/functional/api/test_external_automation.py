import json

import pytest

from awx.api.versioning import reverse
from awx.main.models import ActivityStream

pytestmark = pytest.mark.django_db


def test_external_automation_check_requires_system_admin(post, rando):
    post(reverse('api:external_automation_check'), {}, user=rando, expect=403)
    assert ActivityStream.objects.filter(object1='external_automation').count() == 0


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
    assert response.data['audit']['activity_stream_id']
    assert response.data['audit']['activity_stream_url'].endswith(f"/api/v2/activity_stream/{response.data['audit']['activity_stream_id']}/")
    audit = ActivityStream.objects.get(pk=response.data['audit']['activity_stream_id'])
    assert audit.actor == admin_user
    assert audit.user.filter(pk=admin_user.pk).exists()
    assert audit.operation == 'create'
    assert audit.object1 == 'external_automation'
    assert audit.object2 == 'check'
    changes = json.loads(audit.changes)
    assert changes['triggered_by'] == 'settings_external_automation_smoke'
    assert changes['source'] == 'external_automation_check'
    assert changes['is_error'] is False
    assert changes['checks']['eda']['status'] == 'available'
    assert changes['checks']['opa']['deny_smoke']['status'] == 'denied'
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


def test_external_automation_check_audits_failed_smoke(post, admin_user, mocker):
    mocker.patch(
        'awx.api.views.external_automation.run_external_automation_checks',
        return_value={
            'ok': False,
            'checks': {
                'opa': {
                    'ok': False,
                    'status': 'deny_smoke_failed',
                    'allowed': True,
                    'deny_smoke': {'requested': True, 'ok': False, 'status': 'allowed_unexpectedly', 'allowed': True},
                }
            },
        },
    )

    response = post(reverse('api:external_automation_check'), {'include_eda': False, 'opa_deny_smoke': True}, user=admin_user, expect=200)

    audit = ActivityStream.objects.get(pk=response.data['audit']['activity_stream_id'])
    changes = json.loads(audit.changes)
    assert response.data['ok'] is False
    assert changes['is_error'] is True
    assert changes['checks']['opa']['status'] == 'deny_smoke_failed'
    assert changes['checks']['opa']['deny_smoke']['allowed'] is True
