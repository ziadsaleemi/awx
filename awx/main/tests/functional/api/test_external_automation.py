import json

import pytest

from awx.api.versioning import reverse
from awx.main.management.commands.check_external_automation import run_external_automation_checks
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
                'gatekeeper': {
                    'ok': True,
                    'status': 'available',
                    'context': 'prod',
                    'counts': {'constraint_templates': 1, 'constraints': 2, 'violations': 3, 'configs': 1},
                },
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
            'include_gatekeeper': True,
            'gatekeeper_context': 'prod',
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
    assert changes['checks']['gatekeeper']['context'] == 'prod'
    assert changes['checks']['gatekeeper']['counts']['violations'] == 3
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
        include_gatekeeper=True,
        gatekeeper_context='prod',
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


def test_external_automation_shared_smoke_checks_gatekeeper(mocker):
    client = mocker.Mock()
    client.context_error = ''
    client.server_url = 'https://kube.example.test'
    client.context = 'prod'
    client.verify_ssl = False
    client.is_configured.return_value = True
    client.context_options.return_value = [
        {
            'name': 'prod',
            'selected': True,
            'configured': True,
            'server_url': 'https://kube.example.test',
            'verify_ssl': False,
            'source': 'settings',
        }
    ]
    client.list_constraint_templates.return_value = ('v1', [{'metadata': {'name': 'required-labels'}}])
    client.list_constraint_resources.return_value = (
        [
            {'metadata': {'name': 'require-team'}, 'status': {'violations': [{'message': 'missing team'}, {'message': 'missing owner'}]}},
            {'metadata': {'name': 'require-env'}, 'status': {}},
        ],
        [],
    )
    client.list_configs.return_value = [{'metadata': {'name': 'config'}}]
    client_cls = mocker.patch('awx.main.management.commands.check_external_automation.GatekeeperKubernetesClient', return_value=client)

    result = run_external_automation_checks(include_eda=False, include_opa=False, include_gatekeeper=True, gatekeeper_context='prod')

    client_cls.assert_called_once_with('prod')
    assert result['ok'] is True
    assert result['checks']['gatekeeper']['status'] == 'available'
    assert result['checks']['gatekeeper']['api_versions']['constraint_templates'] == 'v1'
    assert result['checks']['gatekeeper']['counts'] == {
        'constraint_templates': 1,
        'constraints': 2,
        'violations': 2,
        'configs': 1,
    }


def test_external_automation_gatekeeper_unconfigured_is_not_ok(mocker):
    client = mocker.Mock()
    client.context_error = ''
    client.server_url = ''
    client.context = 'default'
    client.verify_ssl = True
    client.is_configured.return_value = False
    client.context_options.return_value = [
        {'name': 'default', 'selected': True, 'configured': False, 'server_url': '', 'verify_ssl': True, 'source': 'settings'}
    ]
    mocker.patch('awx.main.management.commands.check_external_automation.GatekeeperKubernetesClient', return_value=client)

    result = run_external_automation_checks(include_eda=False, include_opa=False, include_gatekeeper=True)

    assert result['ok'] is False
    assert result['checks']['gatekeeper']['status'] == 'not_configured'
