from unittest import mock

import pytest
from django.test import override_settings

from awx.api.versioning import reverse
from awx.api.views.opa import OPAPolicyEngine, check_opa_policy
from awx.main.models import CatalogDeployment, CatalogItem, Job, SystemJob, TerraformJob, WorkflowJob
from awx.main.tasks.policy import OPA_AUTH_TYPES


@pytest.mark.django_db
@override_settings(OPA_HOST='opa.example.com', OPA_PORT=8181, OPA_SSL=True, OPA_POLICY_BUNDLE='package awx\nallow := true')
def test_opa_policy_list_uses_registered_policy_settings(get, admin_user):
    response = get(reverse('api:opa_policies'), user=admin_user, expect=200)

    assert response.data['enabled'] is True
    assert response.data['server_url'] == 'https://opa.example.com:8181'
    assert {policy['id'] for policy in response.data['policies']} >= {'job_launch', 'ai_action'}
    job_launch_policy = next(policy for policy in response.data['policies'] if policy['id'] == 'job_launch')
    ai_action_policy = next(policy for policy in response.data['policies'] if policy['id'] == 'ai_action')
    assert job_launch_policy['input_example']['source'] == 'api'
    assert job_launch_policy['input_example']['launch']['extra_var_keys'] == ['env']
    assert ai_action_policy['input_example']['source'] == 'workflow_ai_task'
    assert ai_action_policy['input_example']['destructive'] is True
    assert ai_action_policy['input_example']['human_approved'] is True
    assert response.data['policy_bundle']['configured'] is True
    assert response.data['policy_bundle']['size'] == len('package awx\nallow := true')


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


@pytest.mark.django_db
@override_settings(OPA_HOST='opa.example.com', OPA_SSL=False)
def test_check_opa_policy_understands_structured_denial():
    with mock.patch.object(OPAPolicyEngine, 'evaluate', return_value={'result': {'allowed': False, 'violations': ['blocked']}}):
        assert check_opa_policy('awx/ai_action/allow', {'action': 'launch'}) is False


@pytest.mark.django_db
def test_opa_guardrail_denies_job_template_launch_before_job_create(post, admin_user, jt_linked):
    jt_linked.ask_variables_on_launch = True
    jt_linked.save(update_fields=['ask_variables_on_launch'])
    before_count = Job.objects.count()

    with mock.patch('awx.api.views.opa.check_opa_policy', return_value=False) as check_policy:
        post(
            reverse('api:job_template_launch', kwargs={'pk': jt_linked.pk}),
            data={'extra_vars': {'env': 'prod', 'secret_value': 'do-not-leak'}},
            user=admin_user,
            expect=403,
        )

    assert Job.objects.count() == before_count
    policy_path, input_data = check_policy.call_args.args
    assert policy_path == 'awx/job_launch/allow'
    assert input_data['source'] == 'api'
    assert input_data['template']['id'] == jt_linked.pk
    assert input_data['template']['type'] == 'jobtemplate'
    assert input_data['launch']['extra_var_keys'] == ['env', 'secret_value']
    assert 'do-not-leak' not in str(input_data)


@pytest.mark.django_db
def test_opa_guardrail_denies_workflow_launch_before_workflow_job_create(post, admin_user, workflow_job_template):
    before_count = WorkflowJob.objects.count()

    with mock.patch('awx.api.views.opa.check_opa_policy', return_value=False) as check_policy:
        post(
            reverse('api:workflow_job_template_launch', kwargs={'pk': workflow_job_template.pk}),
            data={},
            user=admin_user,
            expect=403,
        )

    assert WorkflowJob.objects.count() == before_count
    assert check_policy.call_args.args[1]['template']['type'] == 'workflowjobtemplate'


@pytest.mark.django_db
def test_opa_guardrail_denies_terraform_launch_before_job_create(post, admin_user, terraform_job_template):
    before_count = TerraformJob.objects.count()

    with mock.patch('awx.api.views.opa.check_opa_policy', return_value=False) as check_policy:
        post(
            reverse('api:terraform_job_template_launch', kwargs={'pk': terraform_job_template.pk}),
            data={},
            user=admin_user,
            expect=403,
        )

    assert TerraformJob.objects.count() == before_count
    assert check_policy.call_args.args[1]['template']['type'] == 'terraformjobtemplate'


@pytest.mark.django_db
def test_opa_guardrail_denies_system_job_launch_before_job_create(post, admin_user, system_job_template):
    before_count = SystemJob.objects.count()

    with mock.patch('awx.api.views.opa.check_opa_policy', return_value=False) as check_policy:
        post(
            reverse('api:system_job_template_launch', kwargs={'pk': system_job_template.pk}),
            data={'extra_vars': {'cleanup_password': 'do-not-leak'}},
            user=admin_user,
            expect=403,
        )

    assert SystemJob.objects.count() == before_count
    assert check_policy.call_args.args[1]['template']['type'] == 'systemjobtemplate'
    assert 'do-not-leak' not in str(check_policy.call_args.args[1])


@pytest.mark.django_db
def test_opa_guardrail_denies_catalog_deploy_before_deployment_create(post, admin_user, organization, workflow_job_template):
    item = CatalogItem.objects.create(name='OPA Catalog Item', organization=organization, provision_workflow=workflow_job_template)
    before_count = CatalogDeployment.objects.count()

    with mock.patch('awx.api.views.opa.check_opa_policy', return_value=False) as check_policy:
        post(
            reverse('api:catalog_item_deploy', kwargs={'pk': item.pk}),
            data={'name': 'blocked deployment', 'extra_vars': {'token': 'do-not-leak'}},
            user=admin_user,
            expect=403,
        )

    assert CatalogDeployment.objects.count() == before_count
    input_data = check_policy.call_args.args[1]
    assert input_data['source'] == 'catalog'
    assert input_data['action'] == 'deploy'
    assert input_data['metadata']['catalog_item'] == item.pk
    assert input_data['launch']['extra_var_keys'] == ['terraform_override_limit', 'token']
    assert 'do-not-leak' not in str(input_data)
