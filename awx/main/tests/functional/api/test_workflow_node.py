import pytest
import json

from django.test import override_settings

from awx.api.versioning import reverse
from awx.main.models.activity_stream import ActivityStream
from awx.main.models.inventory import Inventory
from awx.main.models.jobs import JobTemplate
from awx.main.models.workflow import (
    AIWorkflowTaskError,
    WORKFLOW_NODE_TYPE_AI_TASK,
    WORKFLOW_NODE_TYPE_EDA_RULEBOOK,
    WorkflowApproval,
    WorkflowApprovalTemplate,
    WorkflowJob,
    WorkflowJobTemplate,
    WorkflowJobTemplateNode,
)
from awx.main.models.credential import Credential
from awx.main.models.label import Label
from awx.main.scheduler import TaskManager, WorkflowManager, DependencyManager

# Django
from django.utils.timezone import now, timedelta


@pytest.fixture
def job_template(inventory, project):
    # need related resources set for these tests
    return JobTemplate.objects.create(name='test-job_template', inventory=inventory, project=project)


@pytest.fixture
def node(workflow_job_template, admin_user, job_template):
    return WorkflowJobTemplateNode.objects.create(workflow_job_template=workflow_job_template, unified_job_template=job_template)


@pytest.fixture
def approval_node(workflow_job_template, admin_user):
    return WorkflowJobTemplateNode.objects.create(workflow_job_template=workflow_job_template)


def eda_response(mocker, payload):
    response = mocker.Mock()
    response.status_code = 200
    response.content = b'{}'
    response.raise_for_status.return_value = None
    response.json.return_value = payload
    return response


@pytest.mark.django_db
def test_node_rejects_unprompted_fields(inventory, project, workflow_job_template, post, admin_user):
    job_template = JobTemplate.objects.create(inventory=inventory, project=project, playbook='helloworld.yml', ask_limit_on_launch=False)
    url = reverse('api:workflow_job_template_workflow_nodes_list', kwargs={'pk': workflow_job_template.pk})
    r = post(url, {'unified_job_template': job_template.pk, 'limit': 'webservers'}, user=admin_user, expect=400)
    assert 'limit' in r.data
    assert 'not configured to prompt on launch' in r.data['limit'][0]


@pytest.mark.django_db
def test_node_accepts_prompted_fields(inventory, project, workflow_job_template, post, admin_user):
    job_template = JobTemplate.objects.create(inventory=inventory, project=project, playbook='helloworld.yml', ask_limit_on_launch=True)
    url = reverse('api:workflow_job_template_workflow_nodes_list', kwargs={'pk': workflow_job_template.pk})
    post(url, {'unified_job_template': job_template.pk, 'limit': 'webservers'}, user=admin_user, expect=201)


@pytest.mark.django_db
def test_node_extra_data_patch_with_unprompted_labels(inventory, project, organization, workflow_job_template, patch, admin_user):
    """AAP-41742: PATCH extra_data on a workflow node should succeed even when
    the node has labels associated but the JT has ask_labels_on_launch=False."""
    jt = JobTemplate.objects.create(
        inventory=inventory,
        project=project,
        playbook='helloworld.yml',
        ask_variables_on_launch=True,
        ask_labels_on_launch=False,
    )
    label = Label.objects.create(name='repro-label', organization=organization)

    node = WorkflowJobTemplateNode.objects.create(
        workflow_job_template=workflow_job_template,
        unified_job_template=jt,
        extra_data={'foo': 'bar'},
    )
    node.labels.add(label)

    url = reverse('api:workflow_job_template_node_detail', kwargs={'pk': node.pk})
    r = patch(url, {'extra_data': {'foo': 'edited'}}, user=admin_user, expect=200)
    assert r.data['extra_data'] == {'foo': 'edited'}


@pytest.mark.django_db
@pytest.mark.parametrize(
    "field_name, field_value",
    [
        ('all_parents_must_converge', True),
        ('all_parents_must_converge', False),
    ],
)
def test_create_node_with_field(field_name, field_value, workflow_job_template, post, admin_user):
    url = reverse('api:workflow_job_template_workflow_nodes_list', kwargs={'pk': workflow_job_template.pk})
    res = post(url, {field_name: field_value}, user=admin_user, expect=201)
    assert res.data[field_name] == field_value


@pytest.mark.django_db
def test_create_eda_rulebook_node(workflow_job_template, post, admin_user):
    url = reverse('api:workflow_job_template_workflow_nodes_list', kwargs={'pk': workflow_job_template.pk})
    res = post(
        url,
        {
            'node_type': 'eda_rulebook',
            'eda_rulebook_name': 'ops-alerts',
            'eda_activation_id': 'activation-1',
            'eda_event_source': 'webhook',
            'eda_event_source_status': 'running',
            'identifier': 'ops-alerts',
        },
        user=admin_user,
        expect=201,
    )

    assert res.data['node_type'] == 'eda_rulebook'
    assert res.data['unified_job_template'] is None
    assert res.data['eda_rulebook_name'] == 'ops-alerts'
    assert res.data['summary_fields']['eda_rulebook']['event_source'] == 'webhook'


@pytest.mark.django_db
def test_create_ai_task_node(workflow_job_template, post, admin_user):
    url = reverse('api:workflow_job_template_workflow_nodes_list', kwargs={'pk': workflow_job_template.pk})
    res = post(
        url,
        {
            'node_type': 'ai_task',
            'ai_task_prompt': 'Create a rollout plan from parent artifacts',
            'ai_task_model': 'gpt-5.2',
            'ai_task_approval_required': True,
            'identifier': 'ai-plan',
        },
        user=admin_user,
        expect=201,
    )

    assert res.data['node_type'] == 'ai_task'
    assert res.data['unified_job_template'] is None
    assert res.data['ai_task_prompt'] == 'Create a rollout plan from parent artifacts'
    assert res.data['summary_fields']['ai_task']['model'] == 'gpt-5.2'
    assert res.data['summary_fields']['ai_task']['approval_required'] is True


@pytest.mark.django_db
def test_launch_eda_rulebook_node_completes_as_virtual_success(post, admin_user, controlplane_instance_group):
    workflow_job_template = WorkflowJobTemplate.objects.create(name='eda workflow')
    WorkflowJobTemplateNode.objects.create(
        workflow_job_template=workflow_job_template,
        node_type=WORKFLOW_NODE_TYPE_EDA_RULEBOOK,
        eda_rulebook_name='ops-alerts',
        eda_activation_id='activation-1',
        eda_event_source='webhook',
        eda_event_source_status='running',
        identifier='ops-alerts',
    )

    res = post(reverse('api:workflow_job_template_launch', kwargs={'pk': workflow_job_template.pk}), user=admin_user, expect=201)
    workflow_job = WorkflowJob.objects.get(pk=res.data['workflow_job'])
    workflow_job.created_by = admin_user
    workflow_job.save(update_fields=['created_by'])

    DependencyManager().schedule()
    TaskManager().schedule()
    WorkflowManager().schedule()
    node = workflow_job.workflow_job_nodes.get(identifier='ops-alerts')
    assert node.bypassed_job_status == 'successful'
    assert node.ancestor_artifacts['awx_eda']['rulebook_name'] == 'ops-alerts'

    WorkflowManager().schedule()
    workflow_job.refresh_from_db()
    assert workflow_job.status == 'successful'


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test', EDA_AUTH_TOKEN='eda-token')
def test_launch_eda_rulebook_node_syncs_controller_status(post, admin_user, controlplane_instance_group, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.eda.requests.request',
        return_value=eda_response(
            mocker,
            {
                'id': 'activation-1',
                'name': 'ops-alerts',
                'status': 'running',
                'rulebook_name': 'ops-alerts.yml',
                'event_source': 'webhook',
            },
        ),
    )
    workflow_job_template = WorkflowJobTemplate.objects.create(name='eda workflow controller sync')
    WorkflowJobTemplateNode.objects.create(
        workflow_job_template=workflow_job_template,
        node_type=WORKFLOW_NODE_TYPE_EDA_RULEBOOK,
        eda_rulebook_name='ops-alerts',
        eda_activation_id='activation-1',
        eda_event_source='webhook',
        eda_event_source_status='planned',
        identifier='ops-alerts',
    )

    res = post(reverse('api:workflow_job_template_launch', kwargs={'pk': workflow_job_template.pk}), user=admin_user, expect=201)
    workflow_job = WorkflowJob.objects.get(pk=res.data['workflow_job'])

    DependencyManager().schedule()
    TaskManager().schedule()
    WorkflowManager().schedule()
    node = workflow_job.workflow_job_nodes.get(identifier='ops-alerts')

    assert node.bypassed_job_status == 'successful'
    assert node.eda_event_source_status == 'running'
    assert node.ancestor_artifacts['awx_eda']['source'] == 'eda_controller'
    assert node.ancestor_artifacts['awx_eda']['controller_status'] == 'ok'
    assert node.ancestor_artifacts['awx_eda']['activation']['rulebook'] == 'ops-alerts.yml'
    assert node.ancestor_artifacts['awx_eda']['actions'] == ['found', 'polled']
    assert request_mock.call_args.kwargs['headers']['Authorization'] == 'Bearer eda-token'


@pytest.mark.django_db
@override_settings(EDA_SERVER_URL='https://eda.example.test', EDA_AUTH_TOKEN='eda-token', EDA_VERIFY_SSL=False)
def test_launch_eda_rulebook_node_creates_starts_and_polls_activation(post, admin_user, controlplane_instance_group, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.eda.requests.request',
        side_effect=[
            eda_response(mocker, {'count': 0, 'results': []}),
            eda_response(mocker, {'id': 'created-1', 'name': 'ops-alerts', 'status': 'created', 'rulebook_name': 'ops-alerts.yml'}),
            eda_response(mocker, {'id': 'created-1', 'name': 'ops-alerts', 'status': 'running', 'rulebook_name': 'ops-alerts.yml'}),
            eda_response(mocker, {'id': 'created-1', 'name': 'ops-alerts', 'status': 'running', 'rulebook_name': 'ops-alerts.yml'}),
            eda_response(mocker, {'id': 'created-1', 'name': 'ops-alerts', 'status': 'running', 'current_job_id': 'instance-1'}),
            eda_response(mocker, {'results': [{'id': 'event-1', 'log': 'activation started'}]}),
        ],
    )
    workflow_job_template = WorkflowJobTemplate.objects.create(name='eda workflow controller start')
    WorkflowJobTemplateNode.objects.create(
        workflow_job_template=workflow_job_template,
        node_type=WORKFLOW_NODE_TYPE_EDA_RULEBOOK,
        eda_rulebook_name='ops-alerts',
        eda_event_source='webhook',
        eda_event_source_status='planned',
        identifier='ops-alerts',
    )

    res = post(reverse('api:workflow_job_template_launch', kwargs={'pk': workflow_job_template.pk}), user=admin_user, expect=201)
    workflow_job = WorkflowJob.objects.get(pk=res.data['workflow_job'])

    DependencyManager().schedule()
    TaskManager().schedule()
    WorkflowManager().schedule()
    node = workflow_job.workflow_job_nodes.get(identifier='ops-alerts')

    assert node.bypassed_job_status == 'successful'
    assert node.eda_activation_id == 'created-1'
    assert node.eda_event_source_status == 'running'
    assert node.ancestor_artifacts['awx_eda']['actions'] == ['created', 'started', 'polled', 'events']
    assert node.ancestor_artifacts['awx_eda']['events'][0]['message'] == 'activation started'
    assert [call.args[0] for call in request_mock.call_args_list] == ['GET', 'POST', 'POST', 'GET', 'GET', 'GET']
    assert request_mock.call_args_list[1].kwargs['json']['event_source'] == 'webhook'
    assert request_mock.call_args_list[2].args[1] == 'https://eda.example.test/api/eda/v1/activations/created-1/enable/'
    assert request_mock.call_args_list[5].args[1] == 'https://eda.example.test/api/eda/v1/activation-instances/instance-1/logs/'


@pytest.mark.django_db
def test_launch_ai_task_node_generates_runtime_plan(post, admin_user, controlplane_instance_group, mocker):
    run_mock = mocker.patch(
        'awx.main.models.workflow.run_ai_workflow_task',
        return_value={
            'provider': 'openai_codex',
            'model': 'gpt-5.2',
            'response': '{"steps":[{"name":"verify"}]}',
            'plan': {'steps': [{'name': 'verify'}]},
        },
    )
    workflow_job_template = WorkflowJobTemplate.objects.create(name='ai workflow')
    WorkflowJobTemplateNode.objects.create(
        workflow_job_template=workflow_job_template,
        node_type=WORKFLOW_NODE_TYPE_AI_TASK,
        ai_task_prompt='Build execution plan',
        ai_task_model='gpt-5.2',
        identifier='ai-plan',
    )

    res = post(reverse('api:workflow_job_template_launch', kwargs={'pk': workflow_job_template.pk}), user=admin_user, expect=201)
    workflow_job = WorkflowJob.objects.get(pk=res.data['workflow_job'])

    DependencyManager().schedule()
    TaskManager().schedule()
    WorkflowManager().schedule()
    node = workflow_job.workflow_job_nodes.get(identifier='ai-plan')

    assert node.bypassed_job_status == 'successful'
    assert node.ai_task_status == 'successful'
    assert node.ai_task_result['plan']['steps'][0]['name'] == 'verify'
    assert node.ancestor_artifacts['awx_ai']['provider'] == 'openai_codex'
    assert node.ancestor_artifacts['awx_ai']['approval_required'] is True
    run_mock.assert_called_once_with('Build execution plan', {}, 'gpt-5.2')


@pytest.mark.django_db
def test_launch_ai_task_node_waits_for_resource_action_approval(get, post, admin_user, rando, organization, controlplane_instance_group, mocker):
    mocker.patch(
        'awx.main.models.workflow.run_ai_workflow_task',
        return_value={
            'provider': 'openai_codex',
            'model': 'gpt-5.2',
            'response': '{"name":"Create inventory","operations":[{"id":"inv","operation":"create","resource_type":"inventory","data":{"name":"AI Approved Inventory","organization":%s}}]}'
            % organization.pk,
            'plan': {
                'name': 'Create inventory',
                'operations': [
                    {
                        'id': 'inv',
                        'operation': 'create',
                        'resource_type': 'inventory',
                        'data': {'name': 'AI Approved Inventory', 'organization': organization.pk},
                    }
                ],
            },
        },
    )
    workflow_job_template = WorkflowJobTemplate.objects.create(name='ai workflow approval', organization=organization)
    workflow_job_template.read_role.members.add(rando)
    WorkflowJobTemplateNode.objects.create(
        workflow_job_template=workflow_job_template,
        node_type=WORKFLOW_NODE_TYPE_AI_TASK,
        ai_task_prompt='Create approved inventory',
        identifier='ai-plan',
    )

    res = post(reverse('api:workflow_job_template_launch', kwargs={'pk': workflow_job_template.pk}), user=admin_user, expect=201)
    workflow_job = WorkflowJob.objects.get(pk=res.data['workflow_job'])
    workflow_job.created_by = admin_user
    workflow_job.save(update_fields=['created_by'])

    DependencyManager().schedule()
    TaskManager().schedule()
    WorkflowManager().schedule()
    node = workflow_job.workflow_job_nodes.get(identifier='ai-plan')

    assert node.bypassed_job_status == ''
    assert node.ai_task_status == 'awaiting_approval'
    assert node.ai_task_result['resource_action']['mode'] == 'preview'
    assert node.ai_task_result['resource_action']['can_apply'] is True
    assert not Inventory.objects.filter(name='AI Approved Inventory', organization=organization).exists()
    approval = WorkflowApproval.objects.get(unified_job_node=node)
    assert approval.status == 'pending'
    assert approval.workflow_approval_template is None

    node_detail = get(reverse('api:workflow_job_node_detail', kwargs={'pk': node.pk}), user=admin_user, expect=200)
    assert node_detail.data['related']['approval'].endswith(f'/api/v2/workflow_approvals/{approval.pk}/')

    approve_url = reverse('api:workflow_approval_approve', kwargs={'pk': approval.pk})
    post(approve_url, user=rando, expect=403)
    organization.ai_approver_role.members.add(rando)
    apply_url = reverse('api:workflow_job_node_apply_ai_plan', kwargs={'pk': node.pk})
    post(apply_url, user=rando, expect=201)
    node.refresh_from_db()
    approval.refresh_from_db()

    assert approval.status == 'successful'
    assert node.bypassed_job_status == 'successful'
    assert node.ai_task_status == 'applied'
    assert node.ai_task_result['resource_action']['mode'] == 'apply'
    assert node.ai_task_result['resource_action']['can_apply'] is True
    assert Inventory.objects.filter(name='AI Approved Inventory', organization=organization).exists()


@pytest.mark.django_db
def test_approved_ai_task_resource_action_sends_human_approval_to_opa(post, admin_user, organization, controlplane_instance_group, mocker):
    inventory = Inventory.objects.create(name='AI OPA Workflow Source', organization=organization)
    policy_inputs = []

    def deny_apply_without_human_approval(policy_path, input_data):
        policy_inputs.append(input_data)
        assert policy_path == 'awx/ai_action/allow'
        if input_data['mode'] == 'apply' and input_data['destructive']:
            return input_data['human_approved']
        return True

    mocker.patch('awx.api.views.ai.check_opa_policy', side_effect=deny_apply_without_human_approval)
    mocker.patch(
        'awx.main.models.workflow.run_ai_workflow_task',
        return_value={
            'provider': 'openai_codex',
            'model': 'gpt-5.2',
            'response': '{"name":"Rename inventory","operations":[{"id":"inv","operation":"update","resource_type":"inventory","object_id":%s,"data":{"name":"AI OPA Workflow Renamed"}}]}'
            % inventory.pk,
            'plan': {
                'name': 'Rename inventory',
                'operations': [
                    {
                        'id': 'inv',
                        'operation': 'update',
                        'resource_type': 'inventory',
                        'object_id': inventory.pk,
                        'data': {'name': 'AI OPA Workflow Renamed'},
                    }
                ],
            },
        },
    )
    workflow_job_template = WorkflowJobTemplate.objects.create(name='ai workflow opa approval')
    WorkflowJobTemplateNode.objects.create(
        workflow_job_template=workflow_job_template,
        node_type=WORKFLOW_NODE_TYPE_AI_TASK,
        ai_task_prompt='Rename inventory',
        identifier='ai-plan',
    )

    res = post(reverse('api:workflow_job_template_launch', kwargs={'pk': workflow_job_template.pk}), user=admin_user, expect=201)
    workflow_job = WorkflowJob.objects.get(pk=res.data['workflow_job'])
    workflow_job.created_by = admin_user
    workflow_job.save(update_fields=['created_by'])

    DependencyManager().schedule()
    TaskManager().schedule()
    WorkflowManager().schedule()
    node = workflow_job.workflow_job_nodes.get(identifier='ai-plan')
    assert node.ai_task_status == 'awaiting_approval'
    approval = WorkflowApproval.objects.get(unified_job_node=node)

    post(reverse('api:workflow_approval_approve', kwargs={'pk': approval.pk}), user=admin_user, expect=204)

    inventory.refresh_from_db()
    apply_input = next(input_data for input_data in policy_inputs if input_data['mode'] == 'apply')
    assert inventory.name == 'AI OPA Workflow Renamed'
    assert apply_input['source'] == 'workflow_ai_task'
    assert apply_input['destructive'] is True
    assert apply_input['human_approved'] is True
    assert apply_input['approval']['workflow_job_node'] == node.pk
    assert apply_input['approval']['approved_by'] == admin_user.pk


@pytest.mark.django_db
def test_denied_ai_task_resource_action_fails_from_workflow_approval(post, admin_user, organization, controlplane_instance_group, mocker):
    mocker.patch(
        'awx.main.models.workflow.run_ai_workflow_task',
        return_value={
            'provider': 'openai_codex',
            'model': 'gpt-5.2',
            'response': '{"name":"Create inventory","operations":[{"id":"inv","operation":"create","resource_type":"inventory","data":{"name":"AI Denied Inventory","organization":%s}}]}'
            % organization.pk,
            'plan': {
                'name': 'Create inventory',
                'operations': [
                    {
                        'id': 'inv',
                        'operation': 'create',
                        'resource_type': 'inventory',
                        'data': {'name': 'AI Denied Inventory', 'organization': organization.pk},
                    }
                ],
            },
        },
    )
    workflow_job_template = WorkflowJobTemplate.objects.create(name='ai workflow deny approval')
    WorkflowJobTemplateNode.objects.create(
        workflow_job_template=workflow_job_template,
        node_type=WORKFLOW_NODE_TYPE_AI_TASK,
        ai_task_prompt='Create denied inventory',
        identifier='ai-plan',
    )

    res = post(reverse('api:workflow_job_template_launch', kwargs={'pk': workflow_job_template.pk}), user=admin_user, expect=201)
    workflow_job = WorkflowJob.objects.get(pk=res.data['workflow_job'])
    workflow_job.created_by = admin_user
    workflow_job.save(update_fields=['created_by'])

    DependencyManager().schedule()
    TaskManager().schedule()
    WorkflowManager().schedule()
    node = workflow_job.workflow_job_nodes.get(identifier='ai-plan')
    approval = WorkflowApproval.objects.get(unified_job_node=node)

    post(reverse('api:workflow_approval_deny', kwargs={'pk': approval.pk}), user=admin_user, expect=204)
    node.refresh_from_db()
    approval.refresh_from_db()

    assert approval.status == 'failed'
    assert node.bypassed_job_status == 'failed'
    assert node.ai_task_status == 'failed'
    assert node.ai_task_result['approval']['denied_by'] == admin_user.pk
    assert not Inventory.objects.filter(name='AI Denied Inventory', organization=organization).exists()


@pytest.mark.django_db
def test_launch_ai_task_node_auto_applies_resource_action_when_approval_disabled(post, admin_user, organization, controlplane_instance_group, mocker):
    mocker.patch(
        'awx.main.models.workflow.run_ai_workflow_task',
        return_value={
            'provider': 'openai_codex',
            'model': 'gpt-5.2',
            'response': '{"name":"Create inventory","operations":[{"id":"inv","operation":"create","resource_type":"inventory","data":{"name":"AI Auto Inventory","organization":%s}}]}'
            % organization.pk,
            'plan': {
                'name': 'Create inventory',
                'operations': [
                    {
                        'id': 'inv',
                        'operation': 'create',
                        'resource_type': 'inventory',
                        'data': {'name': 'AI Auto Inventory', 'organization': organization.pk},
                    }
                ],
            },
        },
    )
    workflow_job_template = WorkflowJobTemplate.objects.create(name='ai workflow auto apply')
    WorkflowJobTemplateNode.objects.create(
        workflow_job_template=workflow_job_template,
        node_type=WORKFLOW_NODE_TYPE_AI_TASK,
        ai_task_prompt='Create inventory',
        ai_task_approval_required=False,
        identifier='ai-plan',
    )

    res = post(reverse('api:workflow_job_template_launch', kwargs={'pk': workflow_job_template.pk}), user=admin_user, expect=201)
    workflow_job = WorkflowJob.objects.get(pk=res.data['workflow_job'])
    workflow_job.created_by = admin_user
    workflow_job.save(update_fields=['created_by'])

    DependencyManager().schedule()
    TaskManager().schedule()
    WorkflowManager().schedule()
    node = workflow_job.workflow_job_nodes.get(identifier='ai-plan')

    assert node.bypassed_job_status == 'successful'
    assert node.ai_task_status == 'applied'
    assert node.ai_task_result['resource_action']['mode'] == 'apply'
    assert Inventory.objects.filter(name='AI Auto Inventory', organization=organization).exists()


@pytest.mark.django_db
def test_launch_ai_task_node_routes_provider_error_to_failure_path(post, admin_user, controlplane_instance_group, mocker):
    mocker.patch('awx.main.models.workflow.run_ai_workflow_task', side_effect=AIWorkflowTaskError('provider offline'))
    workflow_job_template = WorkflowJobTemplate.objects.create(name='ai workflow failure')
    ai_node = WorkflowJobTemplateNode.objects.create(
        workflow_job_template=workflow_job_template,
        node_type=WORKFLOW_NODE_TYPE_AI_TASK,
        ai_task_prompt='Build execution plan',
        identifier='ai-plan',
    )
    failure_node = WorkflowJobTemplateNode.objects.create(
        workflow_job_template=workflow_job_template,
        node_type=WORKFLOW_NODE_TYPE_EDA_RULEBOOK,
        eda_rulebook_name='failure-handler',
        identifier='failure-handler',
    )
    ai_node.failure_nodes.add(failure_node)

    res = post(reverse('api:workflow_job_template_launch', kwargs={'pk': workflow_job_template.pk}), user=admin_user, expect=201)
    workflow_job = WorkflowJob.objects.get(pk=res.data['workflow_job'])

    DependencyManager().schedule()
    TaskManager().schedule()
    WorkflowManager().schedule()
    TaskManager().schedule()
    WorkflowManager().schedule()
    ai_job_node = workflow_job.workflow_job_nodes.get(identifier='ai-plan')
    failure_job_node = workflow_job.workflow_job_nodes.get(identifier='failure-handler')

    assert ai_job_node.bypassed_job_status == 'failed'
    assert ai_job_node.ai_task_status == 'failed'
    assert ai_job_node.ancestor_artifacts['awx_ai']['error'] == 'provider offline'
    assert failure_job_node.bypassed_job_status == 'successful'


@pytest.mark.django_db
def test_eda_rulebook_node_requires_rulebook_name(workflow_job_template, post, admin_user):
    url = reverse('api:workflow_job_template_workflow_nodes_list', kwargs={'pk': workflow_job_template.pk})
    res = post(url, {'node_type': 'eda_rulebook'}, user=admin_user, expect=400)

    assert 'eda_rulebook_name' in res.data


@pytest.mark.django_db
def test_eda_rulebook_node_rejects_unified_job_template(workflow_job_template, post, admin_user, job_template):
    url = reverse('api:workflow_job_template_workflow_nodes_list', kwargs={'pk': workflow_job_template.pk})
    res = post(
        url,
        {'node_type': 'eda_rulebook', 'eda_rulebook_name': 'ops-alerts', 'unified_job_template': job_template.pk},
        user=admin_user,
        expect=400,
    )

    assert 'unified_job_template' in res.data


@pytest.mark.django_db
def test_ai_task_node_requires_prompt(workflow_job_template, post, admin_user):
    url = reverse('api:workflow_job_template_workflow_nodes_list', kwargs={'pk': workflow_job_template.pk})
    res = post(url, {'node_type': 'ai_task'}, user=admin_user, expect=400)

    assert 'ai_task_prompt' in res.data


@pytest.mark.django_db
def test_ai_task_node_rejects_unified_job_template(workflow_job_template, post, admin_user, job_template):
    url = reverse('api:workflow_job_template_workflow_nodes_list', kwargs={'pk': workflow_job_template.pk})
    res = post(
        url,
        {'node_type': 'ai_task', 'ai_task_prompt': 'Build plan', 'unified_job_template': job_template.pk},
        user=admin_user,
        expect=400,
    )

    assert 'unified_job_template' in res.data


@pytest.mark.django_db
class TestApprovalNodes:
    def test_approval_node_creation(self, post, approval_node, admin_user):
        url = reverse('api:workflow_job_template_node_create_approval', kwargs={'pk': approval_node.pk, 'version': 'v2'})
        post(url, {'name': 'Test', 'description': 'Approval Node', 'timeout': 0}, user=admin_user, expect=201)

        approval_node = WorkflowJobTemplateNode.objects.get(pk=approval_node.pk)
        assert isinstance(approval_node.unified_job_template, WorkflowApprovalTemplate)
        assert approval_node.unified_job_template.name == 'Test'
        assert approval_node.unified_job_template.description == 'Approval Node'
        assert approval_node.unified_job_template.timeout == 0

    def test_approval_node_creation_with_timeout(self, post, approval_node, admin_user):
        assert approval_node.timeout is None

        url = reverse('api:workflow_job_template_node_create_approval', kwargs={'pk': approval_node.pk, 'version': 'v2'})
        post(url, {'name': 'Test', 'description': 'Approval Node', 'timeout': 10}, user=admin_user, expect=201)

        approval_node = WorkflowJobTemplateNode.objects.get(pk=approval_node.pk)
        approval_node.refresh_from_db()
        assert approval_node.timeout is None
        assert isinstance(approval_node.unified_job_template, WorkflowApprovalTemplate)
        assert approval_node.unified_job_template.timeout == 10

    def test_approval_node_creation_failure(self, post, approval_node, admin_user):
        # This test leaves off a required param to assert that user will get a 400.
        url = reverse('api:workflow_job_template_node_create_approval', kwargs={'pk': approval_node.pk, 'version': 'v2'})
        r = post(url, {'name': '', 'description': 'Approval Node', 'timeout': 0}, user=admin_user, expect=400)
        approval_node = WorkflowJobTemplateNode.objects.get(pk=approval_node.pk)
        assert isinstance(approval_node.unified_job_template, WorkflowApprovalTemplate) is False
        assert {'name': ['This field may not be blank.']} == json.loads(r.content)

    @pytest.mark.parametrize(
        "is_admin, is_org_admin, status",
        [
            [True, False, 201],  # if they're a WFJT admin, they get a 201
            [False, False, 403],  # if they're not a WFJT *nor* org admin, they get a 403
            [False, True, 201],  # if they're an organization admin, they get a 201
        ],
    )
    def test_approval_node_creation_rbac(self, post, approval_node, alice, is_admin, is_org_admin, status):
        url = reverse('api:workflow_job_template_node_create_approval', kwargs={'pk': approval_node.pk, 'version': 'v2'})
        if is_admin is True:
            approval_node.workflow_job_template.admin_role.members.add(alice)
        if is_org_admin is True:
            approval_node.workflow_job_template.organization.admin_role.members.add(alice)
        post(url, {'name': 'Test', 'description': 'Approval Node', 'timeout': 0}, user=alice, expect=status)

    @pytest.mark.django_db
    def test_approval_node_exists(self, post, admin_user, get):
        workflow_job_template = WorkflowJobTemplate.objects.create()
        approval_node = WorkflowJobTemplateNode.objects.create(workflow_job_template=workflow_job_template)
        url = reverse('api:workflow_job_template_node_create_approval', kwargs={'pk': approval_node.pk, 'version': 'v2'})
        post(url, {'name': 'URL Test', 'description': 'An approval', 'timeout': 0}, user=admin_user)
        get(url, admin_user, expect=200)

    @pytest.mark.django_db
    def test_activity_stream_create_wf_approval(self, post, admin_user, workflow_job_template):
        wfjn = WorkflowJobTemplateNode.objects.create(workflow_job_template=workflow_job_template)
        url = reverse('api:workflow_job_template_node_create_approval', kwargs={'pk': wfjn.pk, 'version': 'v2'})
        post(url, {'name': 'Activity Stream Test', 'description': 'Approval Node', 'timeout': 0}, user=admin_user)

        qs1 = ActivityStream.objects.filter(organization__isnull=False)
        assert qs1.count() == 1
        assert qs1[0].operation == 'create'

        qs2 = ActivityStream.objects.filter(organization__isnull=True)
        assert qs2.count() == 5
        assert list(qs2.values_list('operation', 'object1')) == [
            ('create', 'user'),
            ('create', 'workflow_job_template'),
            ('create', 'workflow_job_template_node'),
            ('create', 'workflow_approval_template'),
            ('update', 'workflow_job_template_node'),
        ]

    @pytest.mark.django_db
    def test_approval_node_approve(self, post, admin_user, job_template, controlplane_instance_group):
        # This test ensures that a user (with permissions to do so) can APPROVE
        # workflow approvals.  Also asserts that trying to APPROVE approvals
        # that have already been dealt with will throw an error.
        wfjt = WorkflowJobTemplate.objects.create(name='foobar')
        node = wfjt.workflow_nodes.create(unified_job_template=job_template)
        url = reverse('api:workflow_job_template_node_create_approval', kwargs={'pk': node.pk, 'version': 'v2'})
        post(url, {'name': 'Approve Test', 'description': '', 'timeout': 0}, user=admin_user, expect=201)
        post(reverse('api:workflow_job_template_launch', kwargs={'pk': wfjt.pk}), user=admin_user, expect=201)
        wf_job = WorkflowJob.objects.first()
        DependencyManager().schedule()  # TODO: exclude workflows from this and delete line
        TaskManager().schedule()
        WorkflowManager().schedule()
        wfj_node = wf_job.workflow_nodes.first()
        approval = wfj_node.job
        assert approval.name == 'Approve Test'
        post(reverse('api:workflow_approval_approve', kwargs={'pk': approval.pk}), user=admin_user, expect=204)
        # Test that there is an activity stream entry that was created for the "approve" action.
        qs = ActivityStream.objects.order_by('-timestamp').first()
        assert qs.object1 == 'workflow_approval'
        assert qs.changes == '{"status": ["pending", "successful"]}'
        assert WorkflowApproval.objects.get(pk=approval.pk).status == 'successful'
        assert qs.operation == 'update'
        post(reverse('api:workflow_approval_approve', kwargs={'pk': approval.pk}), user=admin_user, expect=400)

    @pytest.mark.django_db
    def test_approval_node_deny(self, post, admin_user, job_template, controlplane_instance_group):
        # This test ensures that a user (with permissions to do so) can DENY
        # workflow approvals.  Also asserts that trying to DENY approvals
        # that have already been dealt with will throw an error.
        wfjt = WorkflowJobTemplate.objects.create(name='foobar')
        node = wfjt.workflow_nodes.create(unified_job_template=job_template)
        url = reverse('api:workflow_job_template_node_create_approval', kwargs={'pk': node.pk, 'version': 'v2'})
        post(url, {'name': 'Deny Test', 'description': '', 'timeout': 0}, user=admin_user, expect=201)
        post(reverse('api:workflow_job_template_launch', kwargs={'pk': wfjt.pk}), user=admin_user, expect=201)
        wf_job = WorkflowJob.objects.first()
        DependencyManager().schedule()  # TODO: exclude workflows from this and delete line
        TaskManager().schedule()
        WorkflowManager().schedule()
        wfj_node = wf_job.workflow_nodes.first()
        approval = wfj_node.job
        assert approval.name == 'Deny Test'
        post(reverse('api:workflow_approval_deny', kwargs={'pk': approval.pk}), user=admin_user, expect=204)
        # Test that there is an activity stream entry that was created for the "deny" action.
        qs = ActivityStream.objects.order_by('-timestamp').first()
        assert qs.object1 == 'workflow_approval'
        assert qs.changes == '{"status": ["pending", "failed"]}'
        assert WorkflowApproval.objects.get(pk=approval.pk).status == 'failed'
        assert qs.operation == 'update'
        post(reverse('api:workflow_approval_deny', kwargs={'pk': approval.pk}), user=admin_user, expect=400)

    def test_approval_node_cleanup(self, post, approval_node, admin_user, get):
        workflow_job_template = WorkflowJobTemplate.objects.create()
        approval_node = WorkflowJobTemplateNode.objects.create(workflow_job_template=workflow_job_template)
        url = reverse('api:workflow_job_template_node_create_approval', kwargs={'pk': approval_node.pk, 'version': 'v2'})

        post(url, {'name': 'URL Test', 'description': 'An approval', 'timeout': 0}, user=admin_user)
        assert WorkflowApprovalTemplate.objects.count() == 1
        workflow_job_template.delete()
        assert WorkflowApprovalTemplate.objects.count() == 0
        get(url, admin_user, expect=404)

    def test_changed_approval_deletion(self, post, approval_node, admin_user, workflow_job_template, job_template):
        # This test verifies that when an approval node changes into something else
        # (in this case, a job template), then the previously-set WorkflowApprovalTemplate
        # is automatically deleted.
        workflow_job_template = WorkflowJobTemplate.objects.create()
        approval_node = WorkflowJobTemplateNode.objects.create(workflow_job_template=workflow_job_template)
        url = reverse('api:workflow_job_template_node_create_approval', kwargs={'pk': approval_node.pk, 'version': 'v2'})
        post(url, {'name': 'URL Test', 'description': 'An approval', 'timeout': 0}, user=admin_user)
        assert WorkflowApprovalTemplate.objects.count() == 1
        approval_node.unified_job_template = job_template
        approval_node.save()
        assert WorkflowApprovalTemplate.objects.count() == 0

    def test_deleted_approval_denial(self, post, approval_node, admin_user, workflow_job_template):
        # Verifying that when a WorkflowApprovalTemplate is deleted, any/all of
        # its pending approvals are auto-denied (vs left in 'pending' state).
        workflow_job_template = WorkflowJobTemplate.objects.create()
        approval_node = WorkflowJobTemplateNode.objects.create(workflow_job_template=workflow_job_template)
        url = reverse('api:workflow_job_template_node_create_approval', kwargs={'pk': approval_node.pk, 'version': 'v2'})
        post(url, {'name': 'URL Test', 'description': 'An approval', 'timeout': 0}, user=admin_user)
        assert WorkflowApprovalTemplate.objects.count() == 1
        approval_template = WorkflowApprovalTemplate.objects.first()
        approval = approval_template.create_unified_job()
        approval.status = 'pending'
        approval.save()
        approval_template.delete()
        approval.refresh_from_db()
        assert approval.status == 'failed'

    def test_expires_time_on_creation(self):
        now_time = now()
        wa = WorkflowApproval.objects.create(timeout=34)
        # this is fudged, so we assert that the expires time is in reasonable range
        assert timedelta(seconds=33) < (wa.expires - now_time) < timedelta(seconds=35)

    @pytest.mark.parametrize('with_update_fields', [True, False])
    def test_expires_time_update(self, with_update_fields):
        wa = WorkflowApproval.objects.create()
        assert wa.timeout == 0
        assert wa.expires is None
        wa.timeout = 1234
        if with_update_fields:
            wa.save(update_fields=['timeout'])
        else:
            wa.save()
        assert wa.created + timedelta(seconds=1234) == wa.expires

    @pytest.mark.parametrize('with_update_fields', [True, False])
    def test_reset_timeout_and_expires(self, with_update_fields):
        wa = WorkflowApproval.objects.create()
        wa.timeout = 1234
        wa.save()
        assert wa.expires
        wa.timeout = 0
        if with_update_fields:
            wa.save(update_fields=['timeout'])
        else:
            wa.save()
        assert wa.expires is None


@pytest.mark.django_db
class TestExclusiveRelationshipEnforcement:
    @pytest.fixture
    def n1(self, workflow_job_template):
        return WorkflowJobTemplateNode.objects.create(workflow_job_template=workflow_job_template)

    @pytest.fixture
    def n2(self, workflow_job_template):
        return WorkflowJobTemplateNode.objects.create(workflow_job_template=workflow_job_template)

    def generate_url(self, relationship, id):
        return reverse('api:workflow_job_template_node_{}_nodes_list'.format(relationship), kwargs={'pk': id})

    relationship_permutations = [
        ['success', 'failure', 'always'],
        ['success', 'always', 'failure'],
        ['failure', 'always', 'success'],
        ['failure', 'success', 'always'],
        ['always', 'success', 'failure'],
        ['always', 'failure', 'success'],
    ]

    @pytest.mark.parametrize("relationships", relationship_permutations, ids=["-".join(item) for item in relationship_permutations])
    def test_multi_connections_same_parent_disallowed(self, post, admin_user, n1, n2, relationships):
        for index, relationship in enumerate(relationships):
            r = post(self.generate_url(relationship, n1.id), data={'associate': True, 'id': n2.id}, user=admin_user, expect=204 if index == 0 else 400)

            if index != 0:
                assert {'Error': 'Relationship not allowed.'} == json.loads(r.content)

    @pytest.mark.parametrize("relationship", ['success', 'failure', 'always'])
    def test_existing_relationship_allowed(self, post, admin_user, n1, n2, relationship):
        post(self.generate_url(relationship, n1.id), data={'associate': True, 'id': n2.id}, user=admin_user, expect=204)
        post(self.generate_url(relationship, n1.id), data={'associate': True, 'id': n2.id}, user=admin_user, expect=204)


@pytest.mark.django_db
class TestNodeCredentials:
    """
    The supported way to provide credentials on launch is through a list
    under the "credentials" key - WFJT nodes have a many-to-many relationship
    corresponding to this, and it must follow rules consistent with other prompts
    """

    @pytest.fixture
    def job_template_ask(self, job_template):
        job_template.ask_credential_on_launch = True
        job_template.save()
        return job_template

    def test_not_allows_non_job_models(self, post, admin_user, workflow_job_template, project, machine_credential):
        node = WorkflowJobTemplateNode.objects.create(workflow_job_template=workflow_job_template, unified_job_template=project)
        r = post(
            reverse('api:workflow_job_template_node_credentials_list', kwargs={'pk': node.pk}), data={'id': machine_credential.pk}, user=admin_user, expect=400
        )
        assert 'cannot accept credentials on launch' in str(r.data['msg'])

    def test_credential_accepted_create(self, workflow_job_template, post, admin_user, job_template_ask, machine_credential):
        r = post(
            reverse('api:workflow_job_template_workflow_nodes_list', kwargs={'pk': workflow_job_template.pk}),
            data={'unified_job_template': job_template_ask.pk},
            user=admin_user,
            expect=201,
        )
        node = WorkflowJobTemplateNode.objects.get(pk=r.data['id'])
        post(url=r.data['related']['credentials'], data={'id': machine_credential.pk}, user=admin_user, expect=204)
        assert list(node.credentials.all()) == [machine_credential]

    @pytest.mark.parametrize('role,code', [['use_role', 204], ['read_role', 403]])
    def test_credential_rbac(self, role, code, workflow_job_template, post, rando, job_template_ask, machine_credential):
        role_obj = getattr(machine_credential, role)
        role_obj.members.add(rando)
        job_template_ask.execute_role.members.add(rando)
        workflow_job_template.admin_role.members.add(rando)
        r = post(
            reverse('api:workflow_job_template_workflow_nodes_list', kwargs={'pk': workflow_job_template.pk}),
            data={'unified_job_template': job_template_ask.pk},
            user=rando,
            expect=201,
        )
        creds_url = r.data['related']['credentials']
        post(url=creds_url, data={'id': machine_credential.pk}, user=rando, expect=code)

    def test_credential_add_remove(self, node, get, post, machine_credential, admin_user):
        node.unified_job_template.ask_credential_on_launch = True
        node.unified_job_template.save()
        url = node.get_absolute_url()
        r = get(url=url, user=admin_user, expect=200)
        post(url=r.data['related']['credentials'], data={'id': machine_credential.pk}, user=admin_user, expect=204)
        node.refresh_from_db()

        post(url=r.data['related']['credentials'], data={'id': machine_credential.pk, 'disassociate': True}, user=admin_user, expect=204)
        node.refresh_from_db()
        assert list(node.credentials.values_list('pk', flat=True)) == []

    def test_credential_replace(self, node, get, post, credentialtype_ssh, admin_user):
        node.unified_job_template.ask_credential_on_launch = True
        node.unified_job_template.save()
        cred1 = Credential.objects.create(credential_type=credentialtype_ssh, name='machine-cred1', inputs={'username': 'test_user', 'password': 'pas4word'})
        cred2 = Credential.objects.create(credential_type=credentialtype_ssh, name='machine-cred2', inputs={'username': 'test_user', 'password': 'pas4word'})
        node.credentials.add(cred1)
        url = node.get_absolute_url()
        r = get(url=url, user=admin_user, expect=200)
        creds_url = r.data['related']['credentials']
        # cannot do it this way
        r2 = post(url=creds_url, data={'id': cred2.pk}, user=admin_user, expect=400)
        assert 'This launch configuration already provides a Machine credential' in r2.data['msg']
        # guess I will remove that existing one
        post(url=creds_url, data={'id': cred1.pk, 'disassociate': True}, user=admin_user, expect=204)
        # okay, now I will add the new one
        post(url=creds_url, data={'id': cred2.pk}, user=admin_user, expect=204)
        assert list(node.credentials.values_list('id', flat=True)) == [cred2.pk]
