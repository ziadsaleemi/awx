import base64
import json
from unittest import mock

import pytest
from django.test import override_settings

from awx.api.versioning import reverse
from awx.conf.models import Setting
from awx.main.models import (
    ActivityStream,
    CloudProviderConnection,
    CloudProviderState,
    Credential,
    CredentialType,
    Group,
    Host,
    Inventory,
    InventorySource,
    JobTemplate,
    Notification,
    NotificationTemplate,
    Organization,
    Project,
    ProjectUpdate,
    Schedule,
    WorkflowApproval,
    WorkflowApprovalTemplate,
    WorkflowJobTemplate,
    WorkflowJobTemplateNode,
)


class FakeJSONResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.ok = status_code < 400
        self.text = json.dumps(payload)
        self.headers = {'content-type': 'application/json'}

    def json(self):
        return self._payload


class FakeCodexStreamResponse:
    status_code = 200
    ok = True
    text = ''

    def iter_lines(self, decode_unicode=False):
        yield b'data: {"type":"response.output_text.delta","delta":"O"}'
        yield b'data: {"type":"response.output_text.delta","delta":"K"}'
        yield b'data: [DONE]'


def _jwt(payload):
    def encode(data):
        return base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip('=')

    return f'{encode({"alg": "none"})}.{encode(payload)}.'


def _activity_changes(entry):
    if isinstance(entry.changes, dict):
        return entry.changes
    return json.loads(entry.changes)


@pytest.fixture(autouse=True)
def clear_ai_rate_limit_store():
    from awx.api.views import ai

    ai._rate_limit_store.clear()


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_PROVIDER='openai', AI_API_KEY='api-key', AI_MODEL_NAME='gpt-4o')
def test_ai_chat_openai_api_key_provider_still_uses_chat_completions(post, admin_user):
    with mock.patch('awx.api.views.ai.requests.post', return_value=FakeJSONResponse({'choices': [{'message': {'content': 'OK'}}]})) as requests_post:
        response = post(
            reverse('api:ai_chat'),
            data={'messages': [{'role': 'user', 'content': 'Say OK'}]},
            user=admin_user,
            expect=200,
        )

    assert response.data['message']['content'] == 'OK'
    assert response.data['provider'] == 'openai'
    assert requests_post.call_args.args[0] == 'https://api.openai.com/v1/chat/completions'
    assert requests_post.call_args.kwargs['headers']['Authorization'] == 'Bearer api-key'


@pytest.mark.django_db
@override_settings(
    AI_ENABLED=True,
    AI_PROVIDER='openai_codex',
    AI_API_KEY='',
    AI_MODEL_NAME='gpt-5.2',
    AI_OPENAI_CODEX_ACCESS_TOKEN=_jwt(
        {
            'scope': 'openid profile email offline_access model.request api.responses.write',
            'https://api.openai.com/auth': {'chatgpt_account_id': 'acct_123', 'chatgpt_plan_type': 'pro'},
        }
    ),
    AI_OPENAI_CODEX_REFRESH_TOKEN='',
    AI_OPENAI_CODEX_TOKEN_EXPIRES_AT='',
    AI_OPENAI_CODEX_CHATGPT_ACCOUNT_ID='',
    AI_OPENAI_CODEX_PLAN_TYPE='',
)
def test_ai_chat_openai_codex_provider_uses_device_token_without_api_key(post, get, admin_user):
    settings_response = get(reverse('api:ai_settings'), user=admin_user, expect=200)
    assert settings_response.data['configured'] is True
    assert settings_response.data['openai_codex_connected'] is True

    with mock.patch('awx.api.views.ai.requests.post', return_value=FakeCodexStreamResponse()) as requests_post:
        response = post(
            reverse('api:ai_chat'),
            data={'messages': [{'role': 'user', 'content': 'Say OK'}]},
            user=admin_user,
            expect=200,
        )

    assert response.data['message']['content'] == 'OK'
    assert response.data['provider'] == 'openai_codex'
    assert requests_post.call_args.args[0] == 'https://chatgpt.com/backend-api/codex/responses'
    assert requests_post.call_args.kwargs['headers']['chatgpt-account-id'] == 'acct_123'
    assert requests_post.call_args.kwargs['headers']['OpenAI-Beta'] == 'responses=experimental'


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_PROVIDER='openai', AI_API_KEY='api-key', AI_MODEL_NAME='gpt-4o')
def test_ai_chat_answers_visible_host_count_without_provider(post, admin_user, organization):
    source_inv = Inventory.objects.create(name='source-inv', organization=organization)
    source_host = source_inv.hosts.create(name='host1')
    source_inv.hosts.create(name='host2')

    constructed = Inventory.objects.create(name='constructed-inv', kind='constructed', organization=organization)
    Host.objects.create(name='host1', inventory=constructed, instance_id=str(source_host.pk))

    with mock.patch('awx.api.views.ai.requests.post') as requests_post:
        response = post(
            reverse('api:ai_chat'),
            data={'messages': [{'role': 'user', 'content': 'How many hosts do we have?'}]},
            user=admin_user,
            expect=200,
        )

    assert response.data['message']['content'] == 'There are 2 hosts visible to you in AWX.'
    assert response.data['provider'] == 'awx'
    requests_post.assert_not_called()


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_PROVIDER='openai', AI_API_KEY='api-key', AI_MODEL_NAME='gpt-4o')
def test_ai_chat_lists_visible_hosts_without_provider(post, admin_user, organization):
    source_inv = Inventory.objects.create(name='source-inv', organization=organization)
    source_host = source_inv.hosts.create(name='web01')
    source_inv.hosts.create(name='db01', enabled=False)

    constructed = Inventory.objects.create(name='constructed-inv', kind='constructed', organization=organization)
    Host.objects.create(name='constructed-only', inventory=constructed, instance_id=str(source_host.pk))

    with mock.patch('awx.api.views.ai.requests.post') as requests_post:
        response = post(
            reverse('api:ai_chat'),
            data={'messages': [{'role': 'user', 'content': 'Can you list all the hosts?'}]},
            user=admin_user,
            expect=200,
        )

    content = response.data['message']['content']
    assert content.startswith('There are 2 hosts visible to you in AWX:')
    assert '- db01 ' in content
    assert '- web01 ' in content
    assert 'inventory: source-inv' in content
    assert 'enabled: no' in content
    assert 'constructed-only' not in content
    assert response.data['provider'] == 'awx'
    requests_post.assert_not_called()


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_PROVIDER='openai', AI_API_KEY='api-key', AI_MODEL_NAME='gpt-4o')
def test_ai_chat_lists_visible_hosts_scoped_to_inventory_without_provider(post, admin_user, organization):
    source_inv = Inventory.objects.create(name='source-inv', organization=organization)
    source_inv.hosts.create(name='web01')
    other_inv = Inventory.objects.create(name='other-inv', organization=organization)
    other_inv.hosts.create(name='db01')

    with mock.patch('awx.api.views.ai.requests.post') as requests_post:
        response = post(
            reverse('api:ai_chat'),
            data={'messages': [{'role': 'user', 'content': 'Can you list hosts in inventory source-inv?'}]},
            user=admin_user,
            expect=200,
        )

    content = response.data['message']['content']
    assert content.startswith('There are 1 host visible to you in AWX matching inventory "source-inv":')
    assert '- web01 ' in content
    assert 'inventory: source-inv' in content
    assert 'db01' not in content
    assert response.data['provider'] == 'awx'
    requests_post.assert_not_called()


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_PROVIDER='openai', AI_API_KEY='api-key', AI_MODEL_NAME='gpt-4o')
def test_ai_chat_counts_visible_hosts_scoped_to_inventory_without_provider(post, admin_user, organization):
    source_inv = Inventory.objects.create(name='source-inv', organization=organization)
    source_inv.hosts.create(name='web01')
    source_inv.hosts.create(name='web02')
    other_inv = Inventory.objects.create(name='other-inv', organization=organization)
    other_inv.hosts.create(name='db01')

    with mock.patch('awx.api.views.ai.requests.post') as requests_post:
        response = post(
            reverse('api:ai_chat'),
            data={'messages': [{'role': 'user', 'content': 'How many hosts are in source-inv?'}]},
            user=admin_user,
            expect=200,
        )

    assert response.data['message']['content'] == 'There are 2 hosts visible to you in AWX matching inventory "source-inv".'
    assert response.data['provider'] == 'awx'
    requests_post.assert_not_called()


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_PROVIDER='openai', AI_API_KEY='api-key', AI_MODEL_NAME='gpt-4o')
def test_ai_chat_lists_visible_cloud_provider_states_scoped_to_org_without_provider(post, org_admin, organization):
    other_org = Organization.objects.create(name='AI Other Cloud Org')
    own_state = CloudProviderState.objects.create(
        provider_id='proxmox',
        organization=organization,
        provider_data={'nodes': [{'node': 'own-pve'}]},
    )
    foreign_state = CloudProviderState.objects.create(
        provider_id='digitalocean',
        organization=other_org,
        provider_data={'regions': [{'slug': 'fra1'}]},
    )

    with mock.patch('awx.api.views.ai.requests.post') as requests_post:
        response = post(
            reverse('api:ai_chat'),
            data={'messages': [{'role': 'user', 'content': f'List cloud provider states in organization {organization.name}'}]},
            user=org_admin,
            expect=200,
        )

    content = response.data['message']['content']
    assert content.startswith(f'There are 1 cloud provider state visible to you in AWX matching organization "{organization.name}":')
    assert f'id: {own_state.pk}' in content
    assert 'provider: proxmox' in content
    assert f'id: {foreign_state.pk}' not in content
    assert 'digitalocean' not in content
    assert 'own-pve' not in content
    assert response.data['provider'] == 'awx'
    requests_post.assert_not_called()


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_PROVIDER='openai', AI_API_KEY='api-key', AI_MODEL_NAME='gpt-4o')
def test_ai_chat_counts_pulled_digitalocean_images_scoped_to_org_without_provider(post, org_admin, organization):
    other_org = Organization.objects.create(name='AI Other DO Org')
    CloudProviderState.objects.create(
        provider_id='digitalocean',
        organization=organization,
        provider_data={
            'images': [
                {'id': 101, 'name': 'Ubuntu 22.04 x64', 'distribution': 'Ubuntu', 'type': 'snapshot', 'status': 'available'},
                {'id': 202, 'name': 'CentOS Stream 9 x64', 'distribution': 'CentOS', 'type': 'snapshot', 'status': 'available'},
            ]
        },
    )
    CloudProviderState.objects.create(
        provider_id='digitalocean',
        organization=other_org,
        provider_data={'images': [{'id': 303, 'name': 'Foreign Fedora'}]},
    )

    with mock.patch('awx.api.views.ai.requests.post') as requests_post:
        response = post(
            reverse('api:ai_chat'),
            data={'messages': [{'role': 'user', 'content': f'How many DigitalOcean images are in organization {organization.name}?'}]},
            user=org_admin,
            expect=200,
        )

    assert response.data['message']['content'] == f'There are 2 pulled DigitalOcean images visible to you in AWX matching organization "{organization.name}".'
    assert response.data['provider'] == 'awx'
    requests_post.assert_not_called()


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_PROVIDER='openai', AI_API_KEY='api-key', AI_MODEL_NAME='gpt-4o')
def test_ai_chat_lists_pulled_proxmox_vms_scoped_to_connection_without_provider(post, org_admin, organization):
    scoped_connection = CloudProviderConnection.objects.create(
        provider_id='proxmox',
        name='Prod Proxmox',
        status='connected',
        organization=organization,
    )
    other_connection = CloudProviderConnection.objects.create(
        provider_id='proxmox',
        name='Other Proxmox',
        status='connected',
        organization=organization,
    )
    CloudProviderState.objects.create(
        provider_id='proxmox',
        organization=organization,
        provider_data={
            str(scoped_connection.pk): {
                'nodes': [{'node': 'pve-a', 'status': 'online'}],
                'vms': [{'vmid': 101, 'name': 'web-01', 'status': 'running', 'node': 'pve-a'}],
            },
            str(other_connection.pk): {
                'nodes': [{'node': 'pve-b', 'status': 'online'}],
                'vms': [{'vmid': 202, 'name': 'db-01', 'status': 'running', 'node': 'pve-b'}],
            },
        },
    )

    with mock.patch('awx.api.views.ai.requests.post') as requests_post:
        response = post(
            reverse('api:ai_chat'),
            data={'messages': [{'role': 'user', 'content': 'List Proxmox VMs for Prod Proxmox'}]},
            user=org_admin,
            expect=200,
        )

    content = response.data['message']['content']
    assert content.startswith('There are 1 pulled Proxmox VE VM visible to you in AWX matching connection "Prod Proxmox":')
    assert 'vm_web-01' in content
    assert 'status: running' in content
    assert 'proxmox node: pve-a' in content
    assert 'db-01' not in content
    assert response.data['provider'] == 'awx'
    requests_post.assert_not_called()


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_PROVIDER='openai', AI_API_KEY='api-key', AI_MODEL_NAME='gpt-4o')
def test_ai_chat_lists_visible_job_templates_scoped_to_project_without_provider(post, admin_user, organization):
    inventory = Inventory.objects.create(name='AI Scope Inventory', organization=organization)
    scoped_project = Project.objects.create(name='AI Scoped Project', organization=organization)
    other_project = Project.objects.create(name='AI Other Project', organization=organization)
    JobTemplate.objects.create(name='AI Scoped Template', project=scoped_project, playbook='scoped.yml', inventory=inventory)
    JobTemplate.objects.create(name='AI Other Template', project=other_project, playbook='other.yml', inventory=inventory)

    with mock.patch('awx.api.views.ai.requests.post') as requests_post:
        response = post(
            reverse('api:ai_chat'),
            data={'messages': [{'role': 'user', 'content': 'List job templates in project AI Scoped Project'}]},
            user=admin_user,
            expect=200,
        )

    content = response.data['message']['content']
    assert content.startswith('There are 1 job template visible to you in AWX matching project "AI Scoped Project":')
    assert 'AI Scoped Template' in content
    assert 'AI Other Template' not in content
    assert response.data['provider'] == 'awx'
    requests_post.assert_not_called()


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_PROVIDER='openai', AI_API_KEY='api-key', AI_MODEL_NAME='gpt-4o')
def test_ai_chat_lists_visible_jobs_scoped_to_template_and_status_without_provider(post, admin_user, organization):
    inventory = Inventory.objects.create(name='AI Jobs Inventory', organization=organization)
    project = Project.objects.create(name='AI Jobs Project', organization=organization)
    scoped_template = JobTemplate.objects.create(name='AI Scoped Deploy Template', project=project, playbook='deploy.yml', inventory=inventory)
    other_template = JobTemplate.objects.create(name='AI Other Deploy Template', project=project, playbook='other.yml', inventory=inventory)
    failed_job = scoped_template.create_unified_job(_eager_fields={'status': 'failed'})
    successful_job = scoped_template.create_unified_job(_eager_fields={'status': 'successful'})
    other_failed_job = other_template.create_unified_job(_eager_fields={'status': 'failed'})

    with mock.patch('awx.api.views.ai.requests.post') as requests_post:
        response = post(
            reverse('api:ai_chat'),
            data={'messages': [{'role': 'user', 'content': 'List failed jobs for AI Scoped Deploy Template'}]},
            user=admin_user,
            expect=200,
        )

    content = response.data['message']['content']
    assert content.startswith('There are 1 job visible to you in AWX matching job template "AI Scoped Deploy Template", status "failed":')
    assert f'id: {failed_job.pk}' in content
    assert f'id: {successful_job.pk}' not in content
    assert f'id: {other_failed_job.pk}' not in content
    assert response.data['provider'] == 'awx'
    requests_post.assert_not_called()


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_PROVIDER='openai', AI_API_KEY='api-key', AI_MODEL_NAME='gpt-4o')
def test_ai_chat_lists_visible_schedules_scoped_to_template_without_provider(post, admin_user, organization):
    inventory = Inventory.objects.create(name='AI Schedule Inventory', organization=organization)
    project = Project.objects.create(name='AI Schedule Project', organization=organization)
    scoped_template = JobTemplate.objects.create(name='AI Scoped Schedule Template', project=project, playbook='schedule.yml', inventory=inventory)
    other_template = JobTemplate.objects.create(name='AI Other Schedule Template', project=project, playbook='other.yml', inventory=inventory)
    Schedule.objects.create(
        name='AI Scoped Nightly',
        unified_job_template=scoped_template,
        rrule='DTSTART:20300308T050000Z RRULE:FREQ=DAILY;INTERVAL=1;COUNT=1',
    )
    Schedule.objects.create(
        name='AI Other Nightly',
        unified_job_template=other_template,
        rrule='DTSTART:20300308T050000Z RRULE:FREQ=DAILY;INTERVAL=1;COUNT=1',
    )

    with mock.patch('awx.api.views.ai.requests.post') as requests_post:
        response = post(
            reverse('api:ai_chat'),
            data={'messages': [{'role': 'user', 'content': 'List schedules for AI Scoped Schedule Template'}]},
            user=admin_user,
            expect=200,
        )

    content = response.data['message']['content']
    assert content.startswith('There are 1 schedule visible to you in AWX matching template "AI Scoped Schedule Template":')
    assert 'AI Scoped Nightly' in content
    assert 'AI Other Nightly' not in content
    assert response.data['provider'] == 'awx'
    requests_post.assert_not_called()


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_PROVIDER='openai', AI_API_KEY='api-key', AI_MODEL_NAME='gpt-4o')
def test_ai_chat_lists_visible_workflow_jobs_scoped_to_workflow_template_without_provider(post, admin_user, organization):
    scoped_template = WorkflowJobTemplate.objects.create(name='AI Scoped Workflow JT', organization=organization)
    other_template = WorkflowJobTemplate.objects.create(name='AI Other Workflow JT', organization=organization)
    scoped_job = scoped_template.create_unified_job(_eager_fields={'status': 'failed'})
    other_job = other_template.create_unified_job(_eager_fields={'status': 'failed'})

    with mock.patch('awx.api.views.ai.requests.post') as requests_post:
        response = post(
            reverse('api:ai_chat'),
            data={'messages': [{'role': 'user', 'content': 'List failed workflow jobs for AI Scoped Workflow JT'}]},
            user=admin_user,
            expect=200,
        )

    content = response.data['message']['content']
    assert content.startswith('There are 1 workflow job visible to you in AWX matching workflow job template "AI Scoped Workflow JT", status "failed":')
    assert f'id: {scoped_job.pk}' in content
    assert f'id: {other_job.pk}' not in content
    assert response.data['provider'] == 'awx'
    requests_post.assert_not_called()


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_PROVIDER='openai', AI_API_KEY='api-key', AI_MODEL_NAME='gpt-4o')
def test_ai_chat_counts_visible_project_updates_scoped_to_project_without_provider(post, admin_user, organization):
    scoped_project = Project.objects.create(name='AI Update Project', organization=organization)
    other_project = Project.objects.create(name='AI Other Update Project', organization=organization)
    ProjectUpdate.objects.create(name='AI Scoped Update 1', project=scoped_project, organization=organization, status='successful')
    ProjectUpdate.objects.create(name='AI Scoped Update 2', project=scoped_project, organization=organization, status='failed')
    ProjectUpdate.objects.create(name='AI Other Update', project=other_project, organization=organization, status='failed')

    with mock.patch('awx.api.views.ai.requests.post') as requests_post:
        response = post(
            reverse('api:ai_chat'),
            data={'messages': [{'role': 'user', 'content': 'How many project updates for AI Update Project?'}]},
            user=admin_user,
            expect=200,
        )

    assert response.data['message']['content'] == 'There are 2 project updates visible to you in AWX matching project "AI Update Project".'
    assert response.data['provider'] == 'awx'
    requests_post.assert_not_called()


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_PROVIDER='openai', AI_API_KEY='api-key', AI_MODEL_NAME='gpt-4o')
def test_ai_chat_lists_visible_workflow_approvals_scoped_to_status_without_provider(post, admin_user, organization):
    pending_template = WorkflowApprovalTemplate.objects.create(name='AI Pending Approval Template', organization=organization)
    other_template = WorkflowApprovalTemplate.objects.create(name='AI Other Approval Template', organization=organization)
    pending_approval = WorkflowApproval.objects.create(
        name='AI Pending Approval',
        workflow_approval_template=pending_template,
        organization=organization,
        status='pending',
    )
    WorkflowApproval.objects.create(
        name='AI Successful Approval',
        workflow_approval_template=other_template,
        organization=organization,
        status='successful',
        approved_or_denied_by=admin_user,
    )

    with mock.patch('awx.api.views.ai.requests.post') as requests_post:
        response = post(
            reverse('api:ai_chat'),
            data={'messages': [{'role': 'user', 'content': 'List pending workflow approvals'}]},
            user=admin_user,
            expect=200,
        )

    content = response.data['message']['content']
    assert content.startswith('There are 1 workflow approval visible to you in AWX matching status "pending":')
    assert 'AI Pending Approval' in content
    assert f'id: {pending_approval.pk}' in content
    assert 'AI Successful Approval' not in content
    assert response.data['provider'] == 'awx'
    requests_post.assert_not_called()


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_PROVIDER='openai', AI_API_KEY='api-key', AI_MODEL_NAME='gpt-4o')
def test_ai_chat_lists_visible_notification_templates_without_provider(post, admin_user, organization):
    NotificationTemplate.objects.create(
        name='AI Webhook Notification Template',
        organization=organization,
        notification_type='webhook',
        notification_configuration={'url': 'http://localhost', 'username': '', 'password': '', 'headers': {}},
    )

    with mock.patch('awx.api.views.ai.requests.post') as requests_post:
        response = post(
            reverse('api:ai_chat'),
            data={'messages': [{'role': 'user', 'content': 'List notification templates'}]},
            user=admin_user,
            expect=200,
        )

    content = response.data['message']['content']
    assert content.startswith('There are 1 notification template visible to you in AWX:')
    assert 'AI Webhook Notification Template' in content
    assert 'notification type: webhook' in content
    assert response.data['provider'] == 'awx'
    requests_post.assert_not_called()


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_PROVIDER='openai', AI_API_KEY='api-key', AI_MODEL_NAME='gpt-4o')
def test_ai_chat_lists_visible_notifications_scoped_to_template_and_status_without_provider(post, admin_user, organization):
    scoped_template = NotificationTemplate.objects.create(
        name='AI Scoped Notification Template',
        organization=organization,
        notification_type='webhook',
        notification_configuration={'url': 'http://localhost', 'username': '', 'password': '', 'headers': {}},
    )
    other_template = NotificationTemplate.objects.create(
        name='AI Other Notification Template',
        organization=organization,
        notification_type='webhook',
        notification_configuration={'url': 'http://localhost', 'username': '', 'password': '', 'headers': {}},
    )
    scoped_notification = Notification.objects.create(
        notification_template=scoped_template,
        status='successful',
        notification_type='webhook',
        subject='AI scoped notification sent',
    )
    other_notification = Notification.objects.create(
        notification_template=other_template,
        status='failed',
        notification_type='webhook',
        subject='AI other notification failed',
    )

    with mock.patch('awx.api.views.ai.requests.post') as requests_post:
        response = post(
            reverse('api:ai_chat'),
            data={'messages': [{'role': 'user', 'content': 'List successful notifications for AI Scoped Notification Template'}]},
            user=admin_user,
            expect=200,
        )

    content = response.data['message']['content']
    assert content.startswith(
        'There are 1 notification visible to you in AWX matching notification template "AI Scoped Notification Template", status "successful":'
    )
    assert f'id: {scoped_notification.pk}' in content
    assert 'AI scoped notification sent' in content
    assert f'id: {other_notification.pk}' not in content
    assert 'AI other notification failed' not in content
    assert response.data['provider'] == 'awx'
    requests_post.assert_not_called()


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_PROVIDER='openai', AI_API_KEY='api-key', AI_MODEL_NAME='gpt-4o')
def test_ai_chat_lists_visible_activity_stream_scoped_to_actor_and_operation_without_provider(post, admin_user):
    update_event = ActivityStream.objects.create(actor=admin_user, operation='update', object1='project', object2='AI Activity Project')
    delete_event = ActivityStream.objects.create(actor=admin_user, operation='delete', object1='project', object2='AI Deleted Project')

    with mock.patch('awx.api.views.ai.requests.post') as requests_post:
        response = post(
            reverse('api:ai_chat'),
            data={'messages': [{'role': 'user', 'content': f'List update activity stream events by {admin_user.username}'}]},
            user=admin_user,
            expect=200,
        )

    content = response.data['message']['content']
    assert content.startswith(f'There are 1 activity stream event visible to you in AWX matching actor "{admin_user.username}", operation "update":')
    assert f'id: {update_event.pk}' in content
    assert 'AI Activity Project' in content
    assert f'id: {delete_event.pk}' not in content
    assert 'AI Deleted Project' not in content
    assert response.data['provider'] == 'awx'
    requests_post.assert_not_called()


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_PROVIDER='openai', AI_API_KEY='api-key', AI_MODEL_NAME='gpt-4o', EDA_SERVER_URL='https://eda.example')
def test_ai_chat_answers_eda_status_without_provider(post, admin_user):
    with mock.patch('awx.api.views.ai.requests.post') as requests_post:
        response = post(
            reverse('api:ai_chat'),
            data={'messages': [{'role': 'user', 'content': 'What is EDA controller status?'}]},
            user=admin_user,
            expect=200,
        )

    assert response.data['message']['content'] == 'EDA Controller is configured in AWX. URL: https://eda.example.'
    assert response.data['provider'] == 'awx'
    requests_post.assert_not_called()


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_PROVIDER='openai', AI_API_KEY='api-key', AI_MODEL_NAME='gpt-4o', EDA_SERVER_URL='https://eda.example')
def test_ai_chat_counts_eda_activations_without_provider(post, admin_user):
    client = mock.Mock()
    client.list_activations.return_value = {'count': 2, 'results': [{'id': 101, 'name': 'Deploy EDA', 'status': 'running'}]}

    with mock.patch('awx.api.views.ai.EDAControllerClient', return_value=client), mock.patch('awx.api.views.ai.requests.post') as requests_post:
        response = post(
            reverse('api:ai_chat'),
            data={'messages': [{'role': 'user', 'content': 'How many EDA activations do we have?'}]},
            user=admin_user,
            expect=200,
        )

    assert response.data['message']['content'] == 'There are 2 EDA activations visible through AWX EDA Controller.'
    assert response.data['provider'] == 'awx'
    client.list_activations.assert_called_once_with(page=1, page_size=1)
    requests_post.assert_not_called()


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_PROVIDER='openai', AI_API_KEY='api-key', AI_MODEL_NAME='gpt-4o', EDA_SERVER_URL='https://eda.example')
def test_ai_chat_lists_eda_activations_without_provider(post, admin_user):
    client = mock.Mock()
    client.list_activations.return_value = {
        'count': 2,
        'results': [
            {'id': 101, 'name': 'Deploy EDA', 'status': 'running', 'rulebook': 'deploy.yml', 'event_source': 'webhook'},
            {'id': 102, 'name': 'Audit EDA', 'status': 'disabled', 'rulebook': 'audit.yml'},
        ],
    }

    with mock.patch('awx.api.views.ai.EDAControllerClient', return_value=client), mock.patch('awx.api.views.ai.requests.post') as requests_post:
        response = post(
            reverse('api:ai_chat'),
            data={'messages': [{'role': 'user', 'content': 'List EDA activations'}]},
            user=admin_user,
            expect=200,
        )

    content = response.data['message']['content']
    assert content.startswith('There are 2 EDA activations visible through AWX EDA Controller:')
    assert '- Deploy EDA (id: 101, status: running, rulebook: deploy.yml, event source: webhook)' in content
    assert '- Audit EDA (id: 102, status: disabled, rulebook: audit.yml)' in content
    assert response.data['provider'] == 'awx'
    client.list_activations.assert_called_once_with(page=1, page_size=200)
    requests_post.assert_not_called()


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_PROVIDER='openai', AI_API_KEY='api-key', AI_MODEL_NAME='gpt-4o', EDA_SERVER_URL='')
def test_ai_chat_answers_eda_activations_unconfigured_without_provider(post, admin_user):
    with mock.patch('awx.api.views.ai.EDAControllerClient') as client, mock.patch('awx.api.views.ai.requests.post') as requests_post:
        response = post(
            reverse('api:ai_chat'),
            data={'messages': [{'role': 'user', 'content': 'List EDA activations'}]},
            user=admin_user,
            expect=200,
        )

    assert response.data['message']['content'] == 'EDA Controller is not configured in AWX, so there are no live EDA activations available through AWX.'
    assert response.data['provider'] == 'awx'
    client.assert_not_called()
    requests_post.assert_not_called()


@pytest.mark.django_db
@override_settings(
    AI_ENABLED=True,
    AI_PROVIDER='openai',
    AI_API_KEY='api-key',
    AI_MODEL_NAME='gpt-4o',
    OPA_HOST='opa.example.com',
    OPA_PORT=8181,
    OPA_SSL=True,
    OPA_POLICY_BUNDLE='package awx\nallow := true',
)
def test_ai_chat_answers_opa_status_without_provider(post, admin_user):
    with mock.patch('awx.api.views.ai.requests.post') as requests_post:
        response = post(
            reverse('api:ai_chat'),
            data={'messages': [{'role': 'user', 'content': 'What is OPA guardrail status?'}]},
            user=admin_user,
            expect=200,
        )

    content = response.data['message']['content']
    assert content.startswith('OPA guardrails are enabled in AWX. Server URL: https://opa.example.com:8181.')
    assert 'Managed policy bundle: configured (2 lines' in content
    assert 'Registered policy paths: job_launch, inventory_access, credential_use, ai_action.' in content
    assert response.data['provider'] == 'awx'
    requests_post.assert_not_called()


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_PROVIDER='openai', AI_API_KEY='api-key', AI_MODEL_NAME='gpt-4o')
def test_ai_chat_lists_opa_policy_paths_without_provider(post, admin_user):
    with mock.patch('awx.api.views.ai.requests.post') as requests_post:
        response = post(
            reverse('api:ai_chat'),
            data={'messages': [{'role': 'user', 'content': 'List OPA policy paths'}]},
            user=admin_user,
            expect=200,
        )

    content = response.data['message']['content']
    assert content.startswith('There are 4 OPA policy paths registered in AWX:')
    assert '- job_launch (path: awx/job_launch/allow' in content
    assert '- ai_action (path: awx/ai_action/allow' in content
    assert response.data['provider'] == 'awx'
    requests_post.assert_not_called()


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_PROVIDER='openai', AI_API_KEY='api-key', AI_MODEL_NAME='gpt-4o')
def test_ai_chat_lists_opa_guardrail_audit_without_provider(post, admin_user):
    entry = ActivityStream.objects.create(
        actor=admin_user,
        operation='create',
        object1='ai_resource_action',
        object2='apply',
        changes=json.dumps(
            {
                'mode': 'apply',
                'plan_name': 'Rename inventory',
                'operation_count': 1,
                'operations': [
                    {
                        'id': 'rename-inventory',
                        'operation': 'update',
                        'resource_type': 'inventory',
                        'valid': False,
                        'errors': {'opa': ['This AI operation was denied by an OPA policy guardrail.']},
                    }
                ],
            }
        ),
    )
    entry.user.add(admin_user)

    with mock.patch('awx.api.views.ai.requests.post') as requests_post:
        response = post(
            reverse('api:ai_chat'),
            data={'messages': [{'role': 'user', 'content': 'List OPA guardrail decision history'}]},
            user=admin_user,
            expect=200,
        )

    content = response.data['message']['content']
    assert content.startswith('There are 1 recent OPA guardrail audit events visible to you in AWX:')
    assert f'id: {entry.pk}' in content
    assert 'status: denied' in content
    assert 'plan: Rename inventory' in content
    assert 'denials: update inventory: This AI operation was denied by an OPA policy guardrail.' in content
    assert response.data['provider'] == 'awx'
    requests_post.assert_not_called()


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_PROVIDER='openai', AI_API_KEY='api-key', AI_MODEL_NAME='gpt-4o')
def test_ai_chat_counts_opa_denials_without_provider(post, admin_user):
    allowed = ActivityStream.objects.create(
        actor=admin_user,
        operation='create',
        object1='ai_resource_action',
        object2='preview',
        changes=json.dumps({'mode': 'preview', 'operation_count': 1, 'operations': [{'operation': 'create', 'resource_type': 'inventory'}]}),
    )
    denied = ActivityStream.objects.create(
        actor=admin_user,
        operation='create',
        object1='ai_resource_action',
        object2='apply',
        changes=json.dumps(
            {
                'mode': 'apply',
                'operation_count': 1,
                'operations': [{'operation': 'delete', 'resource_type': 'inventory', 'errors': {'opa': ['blocked']}}],
            }
        ),
    )
    allowed.user.add(admin_user)
    denied.user.add(admin_user)

    with mock.patch('awx.api.views.ai.requests.post') as requests_post:
        response = post(
            reverse('api:ai_chat'),
            data={'messages': [{'role': 'user', 'content': 'How many OPA denials do we have?'}]},
            user=admin_user,
            expect=200,
        )

    assert response.data['message']['content'] == 'There are 1 recent denied OPA guardrail audit events visible to you in AWX.'
    assert response.data['provider'] == 'awx'
    requests_post.assert_not_called()


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_PROVIDER='openai', AI_API_KEY='api-key', AI_MODEL_NAME='gpt-4o')
def test_ai_chat_provider_prompt_includes_visible_awx_resource_rows(post, admin_user, organization):
    inventory = Inventory.objects.create(name='source-inv', organization=organization)
    inventory.hosts.create(name='web01')

    with mock.patch('awx.api.views.ai._call_ai_provider', return_value='OK') as call_provider:
        response = post(
            reverse('api:ai_chat'),
            data={'messages': [{'role': 'user', 'content': 'Summarize the current AWX instance.'}]},
            user=admin_user,
            expect=200,
        )

    assert response.data['message']['content'] == 'OK'
    system_prompt = call_provider.call_args.args[4]
    assert '"hosts"' in system_prompt
    assert '"inventories"' in system_prompt
    assert 'web01' in system_prompt
    assert 'source-inv' in system_prompt
    assert 'Credential secrets, passwords, private keys, tokens, and variable values are intentionally excluded.' in system_prompt


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_PROVIDER='openai', AI_API_KEY='api-key', AI_MODEL_NAME='gpt-4o')
def test_ai_chat_how_to_host_questions_still_use_provider(post, admin_user):
    with mock.patch('awx.api.views.ai._call_ai_provider', return_value='Use Resources > Hosts.') as call_provider:
        response = post(
            reverse('api:ai_chat'),
            data={'messages': [{'role': 'user', 'content': 'Show me how to add a host.'}]},
            user=admin_user,
            expect=200,
        )

    assert response.data['message']['content'] == 'Use Resources > Hosts.'
    call_provider.assert_called_once()


@pytest.mark.django_db
def test_ai_resource_action_preview_validates_inventory_without_saving(post, admin_user, organization):
    before_count = Inventory.objects.count()

    response = post(
        reverse('api:ai_resource_actions'),
        data={
            'mode': 'preview',
            'plan': {
                'name': 'Create test inventory',
                'operations': [
                    {
                        'id': 'create-inventory',
                        'operation': 'create',
                        'resource_type': 'inventory',
                        'data': {'name': 'AI Preview Inventory', 'organization': organization.pk},
                    }
                ],
            },
        },
        user=admin_user,
        expect=200,
    )

    assert response.data['mode'] == 'preview'
    assert response.data['can_apply'] is True
    assert response.data['operations'][0]['valid'] is True
    assert response.data['operations'][0]['validated_data']['organization'] == organization.pk
    assert Inventory.objects.count() == before_count

    audit_entry = ActivityStream.objects.get(pk=response.data['audit']['activity_stream_id'])
    changes = _activity_changes(audit_entry)
    assert audit_entry.actor == admin_user
    assert audit_entry.object1 == 'ai_resource_action'
    assert changes['source'] == 'ai_resource_action'
    assert changes['mode'] == 'preview'
    assert changes['operation_count'] == 1


@pytest.mark.django_db
def test_ai_resource_action_preview_smart_inventory_includes_matching_hosts_and_groups(post, admin_user, organization):
    inventory = Inventory.objects.create(name='AI Source Inventory', organization=organization)
    web_host = inventory.hosts.create(name='web01')
    inventory.hosts.create(name='db01')
    web_group = inventory.groups.create(name='webservers')
    web_group.hosts.add(web_host)

    response = post(
        reverse('api:ai_resource_actions'),
        data={
            'mode': 'preview',
            'plan': {
                'name': 'Create smart inventory',
                'operations': [
                    {
                        'id': 'create-smart-inventory',
                        'operation': 'create',
                        'resource_type': 'smart_inventory',
                        'data': {
                            'name': 'AI Smart Web Inventory',
                            'organization': organization.pk,
                            'host_filter': 'name__icontains=web',
                        },
                    }
                ],
            },
        },
        user=admin_user,
        expect=200,
    )

    operation = response.data['operations'][0]
    assert operation['valid'] is True
    assert operation['data']['kind'] == 'smart'
    assert operation['preview']['type'] == 'smart_inventory'
    assert operation['preview']['matched_hosts_count'] == 1
    assert operation['preview']['matched_hosts'][0]['name'] == 'web01'
    assert operation['preview']['matched_groups_count'] == 1
    assert operation['preview']['matched_groups'][0]['name'] == 'webservers'
    assert not Inventory.objects.filter(name='AI Smart Web Inventory').exists()


@pytest.mark.django_db
def test_ai_resource_action_apply_constructed_inventory_saves_inputs_and_source_vars(post, admin_user, organization):
    inventory = Inventory.objects.create(name='AI Constructed Source', organization=organization)
    web_host = inventory.hosts.create(name='web01')
    web_group = inventory.groups.create(name='webservers')
    web_group.hosts.add(web_host)
    source_vars = '\n'.join(
        [
            'plugin: constructed',
            'strict: false',
            'compose:',
            '  ansible_host: public_ip',
            'secret_token: should-not-leak',
        ]
    )

    response = post(
        reverse('api:ai_resource_actions'),
        data={
            'mode': 'apply',
            'plan': {
                'name': 'Create constructed inventory',
                'operations': [
                    {
                        'id': 'create-constructed-inventory',
                        'operation': 'create',
                        'resource_type': 'constructed_inventory',
                        'data': {
                            'name': 'AI Constructed Inventory',
                            'organization': organization.pk,
                            'input_inventories': [inventory.pk],
                            'source_vars': source_vars,
                            'limit': 'web*',
                        },
                    }
                ],
            },
        },
        user=admin_user,
        expect=201,
    )

    constructed_inventory = Inventory.objects.get(name='AI Constructed Inventory')
    assert constructed_inventory.kind == 'constructed'
    assert list(constructed_inventory.input_inventories.values_list('pk', flat=True)) == [inventory.pk]
    constructed_source = constructed_inventory.inventory_sources.first()
    assert constructed_source.source == 'constructed'
    assert constructed_source.source_vars == source_vars
    assert constructed_source.limit == 'web*'

    operation = response.data['operations'][0]
    assert operation['valid'] is True
    assert operation['input_inventory_ids'] == [inventory.pk]
    assert operation['preview']['type'] == 'constructed_inventory'
    assert operation['preview']['input_inventories'][0]['name'] == 'AI Constructed Source'
    assert operation['preview']['source_hosts_count'] == 1
    assert operation['preview']['source_hosts'][0]['name'] == 'web01'
    assert operation['preview']['source_groups_count'] == 1
    assert operation['preview']['source_groups'][0]['name'] == 'webservers'
    assert operation['preview']['source_vars']['secret_token'] == '$encrypted$'
    assert 'compose' in operation['preview']['source_vars_keys']


@pytest.mark.django_db
def test_ai_resource_action_apply_creates_inventory_and_audits_relation(post, admin_user, organization):
    response = post(
        reverse('api:ai_resource_actions'),
        data={
            'mode': 'apply',
            'plan': {
                'name': 'Create applied inventory',
                'operations': [
                    {
                        'id': 'create-inventory',
                        'operation': 'create',
                        'resource_type': 'inventory',
                        'data': {'name': 'AI Applied Inventory', 'organization': organization.pk},
                    }
                ],
            },
        },
        user=admin_user,
        expect=201,
    )

    inventory = Inventory.objects.get(name='AI Applied Inventory')
    assert inventory.organization == organization
    assert response.data['operations'][0]['object_id'] == inventory.pk
    assert response.data['operations'][0]['object']['name'] == 'AI Applied Inventory'

    audit_entry = ActivityStream.objects.get(pk=response.data['audit']['activity_stream_id'])
    changes = _activity_changes(audit_entry)
    assert changes['mode'] == 'apply'
    assert changes['operations'][0]['object_id'] == inventory.pk
    assert inventory in audit_entry.inventory.all()


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_PROVIDER='openai', AI_API_KEY='api-key', AI_MODEL_NAME='gpt-4o')
def test_ai_resource_action_generated_apply_audits_prompt_and_returns_rollback_plan(post, admin_user, organization):
    generated_plan = {
        'name': 'Generated applied inventory',
        'operations': [
            {
                'id': 'generated-inventory',
                'operation': 'create',
                'resource_type': 'inventory',
                'data': {'name': 'AI Generated Applied Inventory', 'organization': organization.pk},
            }
        ],
    }

    with mock.patch('awx.api.views.ai._call_ai_provider', return_value=json.dumps(generated_plan)):
        response = post(
            reverse('api:ai_resource_actions'),
            data={'mode': 'apply', 'prompt': 'Create a disposable inventory for rollback testing.'},
            user=admin_user,
            expect=201,
        )

    inventory = Inventory.objects.get(name='AI Generated Applied Inventory')
    rollback_plan = response.data['rollback_plan']
    assert rollback_plan['operations'][0]['operation'] == 'delete'
    assert rollback_plan['operations'][0]['resource_type'] == 'inventory'
    assert rollback_plan['operations'][0]['object_id'] == inventory.pk

    audit_entry = ActivityStream.objects.get(pk=response.data['audit']['activity_stream_id'])
    changes = _activity_changes(audit_entry)
    assert changes['provider'] == 'openai'
    assert changes['model'] == 'gpt-4o'
    assert changes['prompt_summary'] == 'Create a disposable inventory for rollback testing.'
    assert changes['rollback_available'] is True
    assert changes['rollback_plan']['operations'][0]['object_id'] == inventory.pk

    rollback_response = post(
        reverse('api:ai_resource_actions'),
        data={'mode': 'apply', 'plan': rollback_plan},
        user=admin_user,
        expect=201,
    )

    assert rollback_response.data['can_apply'] is True
    assert not Inventory.objects.filter(pk=inventory.pk).exists()


@pytest.mark.django_db
def test_ai_resource_action_apply_marks_destructive_human_approval_for_opa(post, admin_user, organization):
    inventory = Inventory.objects.create(name='AI OPA Source', organization=organization)
    policy_inputs = []

    def allow_when_human_approved(policy_path, input_data):
        policy_inputs.append(input_data)
        assert policy_path == 'awx/ai_action/allow'
        return input_data['human_approved']

    plan = {
        'name': 'Rename inventory',
        'operations': [
            {
                'id': 'rename-inventory',
                'operation': 'update',
                'resource_type': 'inventory',
                'object_id': inventory.pk,
                'data': {'name': 'AI OPA Renamed'},
            }
        ],
    }

    with mock.patch('awx.api.views.ai.check_opa_policy', side_effect=allow_when_human_approved):
        denied = post(
            reverse('api:ai_resource_actions'),
            data={'mode': 'apply', 'human_approved': False, 'plan': plan},
            user=admin_user,
            expect=400,
        )
        allowed = post(reverse('api:ai_resource_actions'), data={'mode': 'apply', 'plan': plan}, user=admin_user, expect=201)

    inventory.refresh_from_db()
    assert denied.data['operations'][0]['errors']['opa']
    assert allowed.data['can_apply'] is True
    assert inventory.name == 'AI OPA Renamed'
    assert policy_inputs[0]['source'] == 'api'
    assert policy_inputs[0]['mode'] == 'apply'
    assert policy_inputs[0]['destructive'] is True
    assert policy_inputs[0]['human_approved'] is False
    assert policy_inputs[1]['human_approved'] is True


@pytest.mark.django_db
def test_ai_resource_action_apply_creates_inventory_source_and_audits_relation(post, admin_user, organization):
    inventory = Inventory.objects.create(name='AI Source Inventory', organization=organization)

    response = post(
        reverse('api:ai_resource_actions'),
        data={
            'mode': 'apply',
            'plan': {
                'name': 'Create inventory source',
                'operations': [
                    {
                        'id': 'create-inventory-source',
                        'operation': 'create',
                        'resource_type': 'inventory_source',
                        'data': {
                            'name': 'AI EC2 Source',
                            'inventory': inventory.pk,
                            'source': 'ec2',
                            'update_on_launch': False,
                        },
                    }
                ],
            },
        },
        user=admin_user,
        expect=201,
    )

    inventory_source = InventorySource.objects.get(name='AI EC2 Source')
    assert inventory_source.inventory == inventory
    assert inventory_source.source == 'ec2'
    assert response.data['operations'][0]['object_id'] == inventory_source.pk
    assert response.data['operations'][0]['object']['name'] == 'AI EC2 Source'

    audit_entry = ActivityStream.objects.get(pk=response.data['audit']['activity_stream_id'])
    changes = _activity_changes(audit_entry)
    assert changes['mode'] == 'apply'
    assert changes['operations'][0]['resource_type'] == 'inventory_source'
    assert inventory_source in audit_entry.inventory_source.all()


@pytest.mark.django_db
def test_ai_resource_action_preview_inventory_group_host_refs_without_saving(post, admin_user, organization):
    response = post(
        reverse('api:ai_resource_actions'),
        data={
            'mode': 'preview',
            'plan': {
                'name': 'Preview inventory tree',
                'operations': [
                    {
                        'id': 'create-inventory',
                        'operation': 'create',
                        'resource_type': 'inventory',
                        'data': {'name': 'AI Preview Tree', 'organization': organization.pk},
                    },
                    {
                        'id': 'create-group',
                        'operation': 'create',
                        'resource_type': 'group',
                        'data': {'name': 'web', 'inventory_ref': 'create-inventory'},
                    },
                    {
                        'id': 'create-host',
                        'operation': 'create',
                        'resource_type': 'host',
                        'data': {'name': 'web01', 'inventory_ref': 'create-inventory', 'group_ref': 'create-group'},
                    },
                ],
            },
        },
        user=admin_user,
        expect=200,
    )

    assert response.data['can_apply'] is True
    assert [operation['resource_type'] for operation in response.data['operations']] == ['inventory', 'group', 'host']
    assert response.data['operations'][2]['group_ids']
    assert not Inventory.objects.filter(name='AI Preview Tree').exists()
    assert not Group.objects.filter(name='web').exists()
    assert not Host.objects.filter(name='web01').exists()


@pytest.mark.django_db
def test_ai_resource_action_apply_creates_inventory_group_host_with_refs_and_audits(post, admin_user, organization):
    response = post(
        reverse('api:ai_resource_actions'),
        data={
            'mode': 'apply',
            'plan': {
                'name': 'Create inventory tree',
                'operations': [
                    {
                        'id': 'create-inventory',
                        'operation': 'create',
                        'resource_type': 'inventory',
                        'data': {'name': 'AI Managed Tree', 'organization': organization.pk},
                    },
                    {
                        'id': 'create-group',
                        'operation': 'create',
                        'resource_type': 'group',
                        'data': {'name': 'web', 'inventory_ref': 'create-inventory'},
                    },
                    {
                        'id': 'create-host',
                        'operation': 'create',
                        'resource_type': 'host',
                        'data': {
                            'name': 'web01',
                            'inventory_ref': 'create-inventory',
                            'group_ref': 'create-group',
                            'variables': '{"ansible_host": "10.0.0.10"}',
                        },
                    },
                ],
            },
        },
        user=admin_user,
        expect=201,
    )

    inventory = Inventory.objects.get(name='AI Managed Tree')
    group = Group.objects.get(name='web', inventory=inventory)
    host = Host.objects.get(name='web01', inventory=inventory)
    assert host.groups.filter(pk=group.pk).exists()
    assert host.variables_dict['ansible_host'] == '10.0.0.10'
    assert response.data['operations'][1]['object_id'] == group.pk
    assert response.data['operations'][2]['object_id'] == host.pk
    assert response.data['operations'][2]['group_ids'] == [group.pk]

    audit_entry = ActivityStream.objects.get(pk=response.data['audit']['activity_stream_id'])
    changes = _activity_changes(audit_entry)
    assert changes['operations'][2]['resource_type'] == 'host'
    assert changes['operations'][2]['group_ids'] == [group.pk]
    assert inventory in audit_entry.inventory.all()
    assert group in audit_entry.group.all()
    assert host in audit_entry.host.all()


@pytest.mark.django_db
def test_ai_resource_action_preview_project_file_without_saving(post, admin_user, organization, tmp_path):
    project_dir = tmp_path / 'ai-content'
    project_dir.mkdir()
    project = Project.objects.create(name='AI Content Project', organization=organization, scm_type='', local_path='ai-content')

    with override_settings(PROJECTS_ROOT=str(tmp_path)):
        response = post(
            reverse('api:ai_resource_actions'),
            data={
                'mode': 'preview',
                'plan': {
                    'name': 'Preview project file',
                    'operations': [
                        {
                            'id': 'write-playbook',
                            'operation': 'create',
                            'resource_type': 'project_file',
                            'data': {
                                'project': project.pk,
                                'path': 'playbooks/site.yml',
                                'content': '---\n- hosts: all\n  gather_facts: false\n',
                            },
                        }
                    ],
                },
            },
            user=admin_user,
            expect=200,
        )

    operation = response.data['operations'][0]
    assert operation['valid'] is True
    assert operation['resource_type'] == 'project_file'
    assert operation['project_id'] == project.pk
    assert operation['path'] == 'playbooks/site.yml'
    assert operation['preview']['will_create'] is True
    assert not (project_dir / 'playbooks' / 'site.yml').exists()


@pytest.mark.django_db
def test_ai_resource_action_apply_writes_project_file_then_creates_job_template(post, admin_user, organization, tmp_path):
    project_dir = tmp_path / 'ai-content'
    project_dir.mkdir()
    project = Project.objects.create(name='AI Content Project', organization=organization, scm_type='', local_path='ai-content')
    inventory = Inventory.objects.create(name='AI Content Inventory', organization=organization)
    playbook_content = '\n'.join(
        [
            '---',
            '- name: AI generated playbook',
            '  hosts: all',
            '  gather_facts: false',
            '  tasks:',
            '    - name: Show generated message',
            '      debug:',
            '        msg: hello from AI',
            '',
        ]
    )

    with override_settings(PROJECTS_ROOT=str(tmp_path)):
        response = post(
            reverse('api:ai_resource_actions'),
            data={
                'mode': 'apply',
                'plan': {
                    'name': 'Author playbook and template',
                    'operations': [
                        {
                            'id': 'write-playbook',
                            'operation': 'create',
                            'resource_type': 'project_file',
                            'data': {'project': project.pk, 'path': 'playbooks/site.yml', 'content': playbook_content},
                        },
                        {
                            'id': 'create-template',
                            'operation': 'create',
                            'resource_type': 'job_template',
                            'data': {
                                'name': 'AI Generated Template',
                                'project': project.pk,
                                'playbook': 'playbooks/site.yml',
                                'inventory': inventory.pk,
                            },
                        },
                    ],
                },
            },
            user=admin_user,
            expect=201,
        )

    playbook_path = project_dir / 'playbooks' / 'site.yml'
    assert playbook_path.read_text() == playbook_content
    job_template = JobTemplate.objects.get(name='AI Generated Template')
    assert job_template.project == project
    assert job_template.playbook == 'playbooks/site.yml'
    assert response.data['operations'][0]['resource_type'] == 'project_file'
    assert response.data['operations'][1]['object_id'] == job_template.pk

    audit_entry = ActivityStream.objects.get(pk=response.data['audit']['activity_stream_id'])
    changes = _activity_changes(audit_entry)
    assert changes['operations'][0]['resource_type'] == 'project_file'
    assert changes['operations'][0]['path'] == 'playbooks/site.yml'
    assert project in audit_entry.project.all()
    assert job_template in audit_entry.job_template.all()


@pytest.mark.django_db
def test_ai_resource_action_apply_rejects_project_file_path_traversal(post, admin_user, organization, tmp_path):
    project_dir = tmp_path / 'ai-content'
    project_dir.mkdir()
    project = Project.objects.create(name='AI Content Project', organization=organization, scm_type='', local_path='ai-content')

    with override_settings(PROJECTS_ROOT=str(tmp_path)):
        response = post(
            reverse('api:ai_resource_actions'),
            data={
                'mode': 'apply',
                'plan': {
                    'operations': [
                        {
                            'id': 'escape-project',
                            'operation': 'create',
                            'resource_type': 'project_file',
                            'data': {'project': project.pk, 'path': '../outside.yml', 'content': '---\n'},
                        }
                    ],
                },
            },
            user=admin_user,
            expect=400,
        )

    assert response.data['operations'][0]['valid'] is False
    assert 'path' in response.data['operations'][0]['errors']
    assert not (tmp_path / 'outside.yml').exists()


@pytest.mark.django_db
def test_ai_resource_action_apply_rolls_back_project_file_when_later_operation_fails(post, admin_user, organization, tmp_path):
    project_dir = tmp_path / 'ai-content'
    project_dir.mkdir()
    project = Project.objects.create(name='AI Content Project', organization=organization, scm_type='', local_path='ai-content')

    with override_settings(PROJECTS_ROOT=str(tmp_path)):
        response = post(
            reverse('api:ai_resource_actions'),
            data={
                'mode': 'apply',
                'plan': {
                    'operations': [
                        {
                            'id': 'write-playbook',
                            'operation': 'create',
                            'resource_type': 'project_file',
                            'data': {'project': project.pk, 'path': 'playbooks/bad.yml', 'content': '---\n- hosts: all\n'},
                        },
                        {
                            'id': 'create-invalid-template',
                            'operation': 'create',
                            'resource_type': 'job_template',
                            'data': {'name': 'Invalid AI Template', 'project': project.pk, 'playbook': 'playbooks/bad.yml', 'inventory': 999999},
                        },
                    ],
                },
            },
            user=admin_user,
            expect=400,
        )

    assert response.data['can_apply'] is False
    assert response.data['operations'][0]['valid'] is True
    assert response.data['operations'][1]['valid'] is False
    assert not (project_dir / 'playbooks' / 'bad.yml').exists()
    assert not JobTemplate.objects.filter(name='Invalid AI Template').exists()


@pytest.mark.django_db
def test_ai_resource_action_preview_new_project_workspace_refs_without_persisting(post, admin_user, organization, tmp_path):
    inventory = Inventory.objects.create(name='AI Ref Inventory', organization=organization)

    with override_settings(PROJECTS_ROOT=str(tmp_path)):
        response = post(
            reverse('api:ai_resource_actions'),
            data={
                'mode': 'preview',
                'plan': {
                    'name': 'Preview new project content',
                    'operations': [
                        {
                            'id': 'create-project',
                            'operation': 'create',
                            'resource_type': 'project',
                            'data': {
                                'name': 'AI New Content Project',
                                'organization': organization.pk,
                                'scm_type': '',
                                'create_local_path': True,
                                'local_path': 'ai-new-content',
                            },
                        },
                        {
                            'id': 'write-playbook',
                            'operation': 'create',
                            'resource_type': 'project_file',
                            'data': {
                                'project_ref': 'create-project',
                                'path': 'site.yml',
                                'content': '---\n- hosts: all\n  gather_facts: false\n',
                            },
                        },
                        {
                            'id': 'create-template',
                            'operation': 'create',
                            'resource_type': 'job_template',
                            'data': {
                                'name': 'AI Ref Template',
                                'project_ref': 'create-project',
                                'playbook': 'site.yml',
                                'inventory': inventory.pk,
                            },
                        },
                    ],
                },
            },
            user=admin_user,
            expect=200,
        )

    assert response.data['can_apply'] is True
    assert [operation['valid'] for operation in response.data['operations']] == [True, True, True]
    assert not Project.objects.filter(name='AI New Content Project').exists()
    assert not JobTemplate.objects.filter(name='AI Ref Template').exists()
    assert not (tmp_path / 'ai-new-content').exists()


@pytest.mark.django_db
def test_ai_resource_action_apply_creates_project_workspace_file_and_template_with_refs(post, admin_user, organization, tmp_path):
    inventory = Inventory.objects.create(name='AI Ref Inventory', organization=organization)
    playbook_content = '---\n- hosts: all\n  gather_facts: false\n'

    with override_settings(PROJECTS_ROOT=str(tmp_path)):
        response = post(
            reverse('api:ai_resource_actions'),
            data={
                'mode': 'apply',
                'plan': {
                    'name': 'Create new project content',
                    'operations': [
                        {
                            'id': 'create-project',
                            'operation': 'create',
                            'resource_type': 'project',
                            'data': {
                                'name': 'AI New Content Project',
                                'organization': organization.pk,
                                'scm_type': '',
                                'create_local_path': True,
                                'local_path': 'ai-new-content',
                            },
                        },
                        {
                            'id': 'write-playbook',
                            'operation': 'create',
                            'resource_type': 'project_file',
                            'data': {'project_ref': 'create-project', 'path': 'site.yml', 'content': playbook_content},
                        },
                        {
                            'id': 'create-template',
                            'operation': 'create',
                            'resource_type': 'job_template',
                            'data': {
                                'name': 'AI Ref Template',
                                'project_ref': 'create-project',
                                'playbook': 'site.yml',
                                'inventory': inventory.pk,
                            },
                        },
                    ],
                },
            },
            user=admin_user,
            expect=201,
        )

    project = Project.objects.get(name='AI New Content Project')
    job_template = JobTemplate.objects.get(name='AI Ref Template')
    assert project.local_path == 'ai-new-content'
    assert project.scm_type == ''
    assert (tmp_path / 'ai-new-content' / 'site.yml').read_text() == playbook_content
    assert job_template.project == project
    assert job_template.playbook == 'site.yml'
    assert response.data['operations'][0]['object_id'] == project.pk
    assert response.data['operations'][1]['project_id'] == project.pk
    assert response.data['operations'][2]['object_id'] == job_template.pk

    audit_entry = ActivityStream.objects.get(pk=response.data['audit']['activity_stream_id'])
    assert project in audit_entry.project.all()
    assert job_template in audit_entry.job_template.all()


@pytest.mark.django_db
def test_ai_resource_action_apply_rolls_back_new_project_workspace_refs_on_later_failure(post, admin_user, organization, tmp_path):
    with override_settings(PROJECTS_ROOT=str(tmp_path)):
        response = post(
            reverse('api:ai_resource_actions'),
            data={
                'mode': 'apply',
                'plan': {
                    'operations': [
                        {
                            'id': 'create-project',
                            'operation': 'create',
                            'resource_type': 'project',
                            'data': {
                                'name': 'AI Failed Content Project',
                                'organization': organization.pk,
                                'scm_type': '',
                                'create_local_path': True,
                                'local_path': 'ai-failed-content',
                            },
                        },
                        {
                            'id': 'write-playbook',
                            'operation': 'create',
                            'resource_type': 'project_file',
                            'data': {'project_ref': 'create-project', 'path': 'bad.yml', 'content': '---\n- hosts: all\n'},
                        },
                        {
                            'id': 'create-invalid-template',
                            'operation': 'create',
                            'resource_type': 'job_template',
                            'data': {'name': 'Invalid AI Ref Template', 'project_ref': 'create-project', 'playbook': 'bad.yml', 'inventory': 999999},
                        },
                    ],
                },
            },
            user=admin_user,
            expect=400,
        )

    assert response.data['can_apply'] is False
    assert response.data['operations'][2]['valid'] is False
    assert not Project.objects.filter(name='AI Failed Content Project').exists()
    assert not JobTemplate.objects.filter(name='Invalid AI Ref Template').exists()
    assert not (tmp_path / 'ai-failed-content').exists()


@pytest.mark.django_db
def test_ai_resource_action_apply_rejects_unsafe_project_workspace_path(post, admin_user, organization, tmp_path):
    with override_settings(PROJECTS_ROOT=str(tmp_path)):
        response = post(
            reverse('api:ai_resource_actions'),
            data={
                'mode': 'apply',
                'plan': {
                    'operations': [
                        {
                            'id': 'create-project',
                            'operation': 'create',
                            'resource_type': 'project',
                            'data': {
                                'name': 'AI Unsafe Project',
                                'organization': organization.pk,
                                'scm_type': '',
                                'create_local_path': True,
                                'local_path': '../unsafe',
                            },
                        }
                    ],
                },
            },
            user=admin_user,
            expect=400,
        )

    assert response.data['operations'][0]['valid'] is False
    assert 'local_path' in response.data['operations'][0]['errors']
    assert not (tmp_path / 'unsafe').exists()


@pytest.mark.django_db
def test_ai_resource_action_apply_creates_schedule_and_audits_relation(post, admin_user, project, inventory):
    job_template = JobTemplate.objects.create(name='AI Schedule JT', project=project, playbook='helloworld.yml', inventory=inventory)

    response = post(
        reverse('api:ai_resource_actions'),
        data={
            'mode': 'apply',
            'plan': {
                'name': 'Create schedule',
                'operations': [
                    {
                        'id': 'create-schedule',
                        'operation': 'create',
                        'resource_type': 'schedule',
                        'data': {
                            'name': 'AI Daily Schedule',
                            'rrule': 'DTSTART:20300308T050000Z RRULE:FREQ=DAILY;INTERVAL=1;COUNT=1',
                            'unified_job_template': job_template.pk,
                            'enabled': True,
                        },
                    }
                ],
            },
        },
        user=admin_user,
        expect=201,
    )

    schedule = Schedule.objects.get(name='AI Daily Schedule')
    assert schedule.unified_job_template == job_template
    assert schedule.enabled is True
    assert response.data['operations'][0]['object_id'] == schedule.pk
    assert response.data['operations'][0]['object']['name'] == 'AI Daily Schedule'

    audit_entry = ActivityStream.objects.get(pk=response.data['audit']['activity_stream_id'])
    changes = _activity_changes(audit_entry)
    assert changes['mode'] == 'apply'
    assert changes['operations'][0]['resource_type'] == 'schedule'
    assert schedule in audit_entry.schedule.all()


@pytest.mark.django_db
def test_ai_resource_action_apply_attaches_job_template_credential_and_audits_relation(post, admin_user, job_template, machine_credential):
    response = post(
        reverse('api:ai_resource_actions'),
        data={
            'mode': 'apply',
            'plan': {
                'name': 'Attach credential',
                'operations': [
                    {
                        'id': 'attach-credential',
                        'operation': 'attach',
                        'resource_type': 'credential_reference',
                        'data': {
                            'target_resource_type': 'job_template',
                            'target_id': job_template.pk,
                            'credential': machine_credential.pk,
                        },
                    }
                ],
            },
        },
        user=admin_user,
        expect=201,
    )

    assert list(job_template.credentials.values_list('pk', flat=True)) == [machine_credential.pk]
    assert response.data['operations'][0]['target_resource_type'] == 'job_template'
    assert response.data['operations'][0]['target_id'] == job_template.pk
    assert response.data['operations'][0]['credential_id'] == machine_credential.pk
    assert response.data['operations'][0]['credential']['kind'] == 'ssh'

    audit_entry = ActivityStream.objects.get(pk=response.data['audit']['activity_stream_id'])
    changes = _activity_changes(audit_entry)
    assert changes['operations'][0]['resource_type'] == 'credential_reference'
    assert changes['operations'][0]['operation'] == 'attach'
    assert job_template in audit_entry.job_template.all()
    assert machine_credential in audit_entry.credential.all()


@pytest.mark.django_db
def test_ai_resource_action_apply_detaches_job_template_credential(post, admin_user, job_template, machine_credential):
    job_template.credentials.add(machine_credential)

    response = post(
        reverse('api:ai_resource_actions'),
        data={
            'mode': 'apply',
            'plan': {
                'name': 'Detach credential',
                'operations': [
                    {
                        'id': 'detach-credential',
                        'operation': 'detach',
                        'resource_type': 'credential_reference',
                        'data': {
                            'target_resource_type': 'job_template',
                            'target_id': job_template.pk,
                            'credential': machine_credential.pk,
                        },
                    }
                ],
            },
        },
        user=admin_user,
        expect=201,
    )

    assert not job_template.credentials.filter(pk=machine_credential.pk).exists()
    assert response.data['operations'][0]['target_id'] == job_template.pk
    assert response.data['operations'][0]['credential_id'] == machine_credential.pk


@pytest.mark.django_db
def test_ai_resource_action_apply_attaches_inventory_source_credential(post, admin_user, organization, inventory):
    credential_type = CredentialType.defaults['aws']()
    credential_type.save()
    credential = Credential.objects.create(credential_type=credential_type, name='AI AWS Credential', organization=organization)
    inventory_source = InventorySource.objects.create(name='AI EC2 Inventory Source', source='ec2', inventory=inventory)

    response = post(
        reverse('api:ai_resource_actions'),
        data={
            'mode': 'apply',
            'plan': {
                'name': 'Attach inventory source credential',
                'operations': [
                    {
                        'id': 'attach-inventory-source-credential',
                        'operation': 'attach',
                        'resource_type': 'credential_reference',
                        'data': {
                            'target_resource_type': 'inventory_source',
                            'target_id': inventory_source.pk,
                            'credential': credential.pk,
                        },
                    }
                ],
            },
        },
        user=admin_user,
        expect=201,
    )

    assert list(inventory_source.credentials.values_list('pk', flat=True)) == [credential.pk]
    assert response.data['operations'][0]['target_resource_type'] == 'inventory_source'
    assert response.data['operations'][0]['credential']['kind'] == 'cloud'

    audit_entry = ActivityStream.objects.get(pk=response.data['audit']['activity_stream_id'])
    assert inventory_source in audit_entry.inventory_source.all()
    assert credential in audit_entry.credential.all()


@pytest.mark.django_db
def test_ai_resource_action_apply_attaches_schedule_prompt_credential(post, admin_user, project, inventory, machine_credential):
    job_template = JobTemplate.objects.create(
        name='AI Schedule Prompt JT',
        project=project,
        playbook='helloworld.yml',
        inventory=inventory,
        ask_credential_on_launch=True,
    )
    schedule = Schedule.objects.create(
        name='AI Prompted Schedule',
        unified_job_template=job_template,
        rrule='DTSTART:20300308T050000Z RRULE:FREQ=DAILY;INTERVAL=1;COUNT=1',
    )

    response = post(
        reverse('api:ai_resource_actions'),
        data={
            'mode': 'apply',
            'plan': {
                'name': 'Attach schedule credential prompt',
                'operations': [
                    {
                        'id': 'attach-schedule-credential',
                        'operation': 'attach',
                        'resource_type': 'credential_reference',
                        'data': {
                            'target_resource_type': 'schedule',
                            'target_id': schedule.pk,
                            'credential': machine_credential.pk,
                        },
                    }
                ],
            },
        },
        user=admin_user,
        expect=201,
    )

    assert list(schedule.credentials.values_list('pk', flat=True)) == [machine_credential.pk]
    assert response.data['operations'][0]['target_resource_type'] == 'schedule'
    assert response.data['operations'][0]['target_id'] == schedule.pk

    audit_entry = ActivityStream.objects.get(pk=response.data['audit']['activity_stream_id'])
    changes = _activity_changes(audit_entry)
    assert changes['operations'][0]['resource_type'] == 'credential_reference'
    assert schedule in audit_entry.schedule.all()
    assert machine_credential in audit_entry.credential.all()


@pytest.mark.django_db
def test_ai_resource_action_apply_attaches_workflow_node_prompt_credential(post, admin_user, workflow_job_template, job_template, machine_credential):
    job_template.ask_credential_on_launch = True
    job_template.save(update_fields=['ask_credential_on_launch'])
    node = WorkflowJobTemplateNode.objects.create(workflow_job_template=workflow_job_template, unified_job_template=job_template)

    response = post(
        reverse('api:ai_resource_actions'),
        data={
            'mode': 'apply',
            'plan': {
                'name': 'Attach node credential prompt',
                'operations': [
                    {
                        'id': 'attach-node-credential',
                        'operation': 'attach',
                        'resource_type': 'credential_reference',
                        'data': {
                            'target_resource_type': 'workflow_job_template_node',
                            'target_id': node.pk,
                            'credential': machine_credential.pk,
                        },
                    }
                ],
            },
        },
        user=admin_user,
        expect=201,
    )

    assert list(node.credentials.values_list('pk', flat=True)) == [machine_credential.pk]
    assert response.data['operations'][0]['target_resource_type'] == 'workflow_job_template_node'
    assert response.data['operations'][0]['target_id'] == node.pk

    audit_entry = ActivityStream.objects.get(pk=response.data['audit']['activity_stream_id'])
    assert node in audit_entry.workflow_job_template_node.all()
    assert machine_credential in audit_entry.credential.all()


@pytest.mark.django_db
def test_ai_resource_action_apply_rejects_schedule_credential_when_template_not_prompted(post, admin_user, project, inventory, machine_credential):
    job_template = JobTemplate.objects.create(name='AI Schedule No Prompt JT', project=project, playbook='helloworld.yml', inventory=inventory)
    schedule = Schedule.objects.create(
        name='AI No Prompt Schedule',
        unified_job_template=job_template,
        rrule='DTSTART:20300308T050000Z RRULE:FREQ=DAILY;INTERVAL=1;COUNT=1',
    )

    response = post(
        reverse('api:ai_resource_actions'),
        data={
            'mode': 'apply',
            'plan': {
                'operations': [
                    {
                        'id': 'attach-schedule-credential-blocked',
                        'operation': 'attach',
                        'resource_type': 'credential_reference',
                        'data': {
                            'target_resource_type': 'schedule',
                            'target_id': schedule.pk,
                            'credential': machine_credential.pk,
                        },
                    }
                ],
            },
        },
        user=admin_user,
        expect=400,
    )

    assert response.data['operations'][0]['valid'] is False
    assert 'not configured to accept credentials on launch' in response.data['operations'][0]['errors']['msg']
    assert not schedule.credentials.filter(pk=machine_credential.pk).exists()


@pytest.mark.django_db
def test_ai_resource_action_apply_rejects_credential_reference_without_use_permission(post, rando, job_template, machine_credential):
    job_template.admin_role.members.add(rando)

    response = post(
        reverse('api:ai_resource_actions'),
        data={
            'mode': 'apply',
            'plan': {
                'operations': [
                    {
                        'id': 'attach-forbidden-credential',
                        'operation': 'attach',
                        'resource_type': 'credential_reference',
                        'data': {
                            'target_resource_type': 'job_template',
                            'target_id': job_template.pk,
                            'credential': machine_credential.pk,
                        },
                    }
                ]
            },
        },
        user=rando,
        expect=400,
    )

    assert response.data['operations'][0]['valid'] is False
    assert 'permission' in response.data['operations'][0]['errors']
    assert not job_template.credentials.filter(pk=machine_credential.pk).exists()


@pytest.mark.django_db
def test_ai_resource_action_apply_rejects_missing_credential_reference_without_audit_relation_crash(post, admin_user, job_template):
    response = post(
        reverse('api:ai_resource_actions'),
        data={
            'mode': 'apply',
            'plan': {
                'operations': [
                    {
                        'id': 'missing-credential',
                        'operation': 'attach',
                        'resource_type': 'credential_reference',
                        'data': {
                            'target_resource_type': 'job_template',
                            'target_id': job_template.pk,
                            'credential': 999999,
                        },
                    }
                ]
            },
        },
        user=admin_user,
        expect=400,
    )

    assert response.data['operations'][0]['valid'] is False
    assert 'credential' in response.data['operations'][0]['errors']
    audit_entry = ActivityStream.objects.get(pk=response.data['audit']['activity_stream_id'])
    changes = _activity_changes(audit_entry)
    assert changes['is_error'] is True
    assert audit_entry.credential.count() == 0


@pytest.mark.django_db
def test_ai_resource_action_apply_attaches_role_assignment_to_user_and_audits(post, admin_user, job_template, rando):
    response = post(
        reverse('api:ai_resource_actions'),
        data={
            'mode': 'apply',
            'plan': {
                'name': 'Grant execute access',
                'operations': [
                    {
                        'id': 'grant-execute',
                        'operation': 'attach',
                        'resource_type': 'role_assignment',
                        'data': {
                            'target_resource_type': 'job_template',
                            'target_id': job_template.pk,
                            'role': 'execute',
                            'user': rando.pk,
                        },
                    }
                ],
            },
        },
        user=admin_user,
        expect=201,
    )

    assert rando in job_template.execute_role
    assert response.data['operations'][0]['target_resource_type'] == 'job_template'
    assert response.data['operations'][0]['target_id'] == job_template.pk
    assert response.data['operations'][0]['role_field'] == 'execute_role'
    assert response.data['operations'][0]['role_id'] == job_template.execute_role.pk
    assert response.data['operations'][0]['actor_type'] == 'user'
    assert response.data['operations'][0]['actor_id'] == rando.pk

    audit_entry = ActivityStream.objects.get(pk=response.data['audit']['activity_stream_id'])
    changes = _activity_changes(audit_entry)
    assert changes['operations'][0]['resource_type'] == 'role_assignment'
    assert changes['operations'][0]['operation'] == 'attach'
    assert job_template in audit_entry.job_template.all()
    assert job_template.execute_role in audit_entry.role.all()
    assert rando in audit_entry.user.all()


@pytest.mark.django_db
def test_ai_resource_action_apply_detaches_role_assignment_from_user(post, admin_user, job_template, rando):
    job_template.execute_role.members.add(rando)

    response = post(
        reverse('api:ai_resource_actions'),
        data={
            'mode': 'apply',
            'plan': {
                'name': 'Revoke execute access',
                'operations': [
                    {
                        'id': 'revoke-execute',
                        'operation': 'detach',
                        'resource_type': 'role_assignment',
                        'data': {
                            'target_resource_type': 'job_template',
                            'target_id': job_template.pk,
                            'role_field': 'execute_role',
                            'user_id': rando.pk,
                        },
                    }
                ],
            },
        },
        user=admin_user,
        expect=201,
    )

    assert rando not in job_template.execute_role
    assert response.data['operations'][0]['role_field'] == 'execute_role'
    assert response.data['operations'][0]['actor_id'] == rando.pk


@pytest.mark.django_db
def test_ai_resource_action_apply_attaches_role_assignment_to_team(post, admin_user, project, team):
    team.organization = project.organization
    team.save(update_fields=['organization'])

    response = post(
        reverse('api:ai_resource_actions'),
        data={
            'mode': 'apply',
            'plan': {
                'name': 'Grant project use access',
                'operations': [
                    {
                        'id': 'grant-project-use',
                        'operation': 'attach',
                        'resource_type': 'role_assignment',
                        'data': {
                            'target_resource_type': 'project',
                            'target_id': project.pk,
                            'role': 'use',
                            'team': team.pk,
                        },
                    }
                ],
            },
        },
        user=admin_user,
        expect=201,
    )

    assert project.use_role in team.member_role.children.all()
    assert response.data['operations'][0]['actor_type'] == 'team'
    assert response.data['operations'][0]['role_field'] == 'use_role'

    audit_entry = ActivityStream.objects.get(pk=response.data['audit']['activity_stream_id'])
    assert project in audit_entry.project.all()
    assert project.use_role in audit_entry.role.all()
    assert team in audit_entry.team.all()


@pytest.mark.django_db
def test_ai_resource_action_apply_rejects_role_assignment_without_target_admin(post, rando, job_template):
    job_template.read_role.members.add(rando)

    response = post(
        reverse('api:ai_resource_actions'),
        data={
            'mode': 'apply',
            'plan': {
                'operations': [
                    {
                        'id': 'grant-self-execute',
                        'operation': 'attach',
                        'resource_type': 'role_assignment',
                        'data': {
                            'target_resource_type': 'job_template',
                            'target_id': job_template.pk,
                            'role': 'execute',
                            'user': rando.pk,
                        },
                    }
                ]
            },
        },
        user=rando,
        expect=400,
    )

    assert response.data['operations'][0]['valid'] is False
    assert 'permission' in response.data['operations'][0]['errors']
    assert rando not in job_template.execute_role


@pytest.mark.django_db
def test_ai_resource_action_preview_survey_spec_without_saving(post, admin_user, job_template):
    response = post(
        reverse('api:ai_resource_actions'),
        data={
            'mode': 'preview',
            'plan': {
                'name': 'Add deploy survey',
                'operations': [
                    {
                        'id': 'preview-survey',
                        'operation': 'update',
                        'resource_type': 'survey_spec',
                        'data': {
                            'target_resource_type': 'job_template',
                            'target_id': job_template.pk,
                            'survey_spec': {
                                'name': 'Deploy survey',
                                'description': 'Parameters collected before launch.',
                                'spec': [
                                    {
                                        'variable': 'environment',
                                        'question_name': 'Environment',
                                        'type': 'multiplechoice',
                                        'required': True,
                                        'choices': ['dev', 'prod'],
                                        'default': 'dev',
                                    }
                                ],
                            },
                        },
                    }
                ],
            },
        },
        user=admin_user,
        expect=200,
    )

    operation = response.data['operations'][0]
    assert operation['valid'] is True
    assert operation['resource_type'] == 'survey_spec'
    assert operation['target_resource_type'] == 'job_template'
    assert operation['target_id'] == job_template.pk
    assert operation['question_count'] == 1
    assert operation['validated_data']['survey_spec']['spec'][0]['choices'] == 'dev\nprod'
    assert operation['preview']['question_count'] == 1

    job_template.refresh_from_db()
    assert job_template.survey_spec == {}
    assert job_template.survey_enabled is False


@pytest.mark.django_db
def test_ai_resource_action_preview_survey_spec_redacts_password_default(post, admin_user, job_template):
    response = post(
        reverse('api:ai_resource_actions'),
        data={
            'mode': 'preview',
            'plan': {
                'operations': [
                    {
                        'id': 'preview-password-survey',
                        'operation': 'update',
                        'resource_type': 'survey_spec',
                        'data': {
                            'target_resource_type': 'job_template',
                            'target_id': job_template.pk,
                            'questions': [
                                {
                                    'variable': 'vault_password',
                                    'question_name': 'Vault password',
                                    'type': 'password',
                                    'default': 'super-secret',
                                }
                            ],
                        },
                    }
                ],
            },
        },
        user=admin_user,
        expect=200,
    )

    operation = response.data['operations'][0]
    assert operation['valid'] is True
    assert operation['validated_data']['survey_spec']['spec'][0]['default'] == '$encrypted$'
    assert response.data['plan']['operations'][0]['data']['questions'][0]['default'] == '$encrypted$'
    job_template.refresh_from_db()
    assert job_template.survey_spec == {}


@pytest.mark.django_db
def test_ai_resource_action_apply_merges_workflow_survey_question_and_audits(post, admin_user, organization, survey_spec_factory):
    workflow = WorkflowJobTemplate.objects.create(
        name='AI Workflow Survey',
        organization=organization,
        survey_enabled=True,
        survey_spec=survey_spec_factory('environment'),
    )

    response = post(
        reverse('api:ai_resource_actions'),
        data={
            'mode': 'apply',
            'plan': {
                'name': 'Merge workflow survey',
                'operations': [
                    {
                        'id': 'merge-workflow-survey',
                        'operation': 'update',
                        'resource_type': 'survey_spec',
                        'data': {
                            'target_resource_type': 'workflow_job_template',
                            'target_id': workflow.pk,
                            'merge': True,
                            'questions': [
                                {
                                    'variable': 'change_ticket',
                                    'question_name': 'Change ticket',
                                    'question_description': 'Ticket approving this launch.',
                                    'type': 'text',
                                    'required': True,
                                }
                            ],
                        },
                    }
                ],
            },
        },
        user=admin_user,
        expect=201,
    )

    workflow.refresh_from_db()
    variables = [question['variable'] for question in workflow.survey_spec['spec']]
    assert variables == ['environment', 'change_ticket']
    assert workflow.survey_enabled is True
    assert response.data['operations'][0]['question_count'] == 2
    assert response.data['operations'][0]['object_id'] == workflow.pk

    audit_entry = ActivityStream.objects.get(pk=response.data['audit']['activity_stream_id'])
    changes = _activity_changes(audit_entry)
    assert changes['operations'][0]['resource_type'] == 'survey_spec'
    assert changes['operations'][0]['question_count'] == 2
    assert workflow in audit_entry.workflow_job_template.all()


@pytest.mark.django_db
def test_ai_resource_action_apply_updates_terraform_survey_spec(post, admin_user, terraform_job_template):
    response = post(
        reverse('api:ai_resource_actions'),
        data={
            'mode': 'apply',
            'plan': {
                'name': 'Terraform survey',
                'operations': [
                    {
                        'id': 'terraform-survey',
                        'operation': 'create',
                        'resource_type': 'survey_spec',
                        'data': {
                            'target_resource_type': 'terraform_job_template',
                            'target_id': terraform_job_template.pk,
                            'questions': [
                                {
                                    'variable': 'vm_name',
                                    'question_name': 'VM name',
                                    'type': 'text',
                                    'required': True,
                                    'min': 3,
                                    'max': 64,
                                }
                            ],
                        },
                    }
                ],
            },
        },
        user=admin_user,
        expect=201,
    )

    terraform_job_template.refresh_from_db()
    assert terraform_job_template.survey_enabled is True
    assert terraform_job_template.survey_spec['spec'][0]['variable'] == 'vm_name'
    assert response.data['operations'][0]['target_resource_type'] == 'terraform_job_template'

    audit_entry = ActivityStream.objects.get(pk=response.data['audit']['activity_stream_id'])
    assert terraform_job_template in audit_entry.terraform_job_template.all()


@pytest.mark.django_db
def test_ai_resource_action_apply_rejects_survey_spec_without_admin(post, rando, job_template):
    job_template.read_role.members.add(rando)

    response = post(
        reverse('api:ai_resource_actions'),
        data={
            'mode': 'apply',
            'plan': {
                'operations': [
                    {
                        'id': 'forbidden-survey',
                        'operation': 'update',
                        'resource_type': 'survey_spec',
                        'data': {
                            'target_resource_type': 'job_template',
                            'target_id': job_template.pk,
                            'questions': [{'variable': 'environment', 'question_name': 'Environment', 'type': 'text'}],
                        },
                    }
                ]
            },
        },
        user=rando,
        expect=400,
    )

    assert response.data['operations'][0]['valid'] is False
    assert 'permission' in response.data['operations'][0]['errors']
    job_template.refresh_from_db()
    assert job_template.survey_spec == {}


@pytest.mark.django_db
def test_ai_resource_action_apply_rejects_rbac_failure(post, rando, organization):
    response = post(
        reverse('api:ai_resource_actions'),
        data={
            'mode': 'apply',
            'plan': {
                'operations': [
                    {
                        'id': 'create-inventory',
                        'operation': 'create',
                        'resource_type': 'inventory',
                        'data': {'name': 'Forbidden AI Inventory', 'organization': organization.pk},
                    }
                ]
            },
        },
        user=rando,
        expect=400,
    )

    assert response.data['can_apply'] is False
    assert response.data['operations'][0]['valid'] is False
    assert 'permission' in response.data['operations'][0]['errors']
    assert not Inventory.objects.filter(name='Forbidden AI Inventory').exists()

    audit_entry = ActivityStream.objects.get(pk=response.data['audit']['activity_stream_id'])
    changes = _activity_changes(audit_entry)
    assert audit_entry.actor == rando
    assert changes['is_error'] is True


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_PROVIDER='openai', AI_API_KEY='api-key', AI_MODEL_NAME='gpt-4o')
def test_ai_resource_action_prompt_generates_typed_plan(post, admin_user, organization):
    inventory = Inventory.objects.create(name='AI Prompt Source Inventory', organization=organization)
    inventory.hosts.create(name='web01')
    generated_plan = {
        'name': 'Generated inventory',
        'operations': [
            {
                'id': 'generated-inventory',
                'operation': 'create',
                'resource_type': 'smart_inventory',
                'data': {
                    'name': 'AI Generated Smart Inventory',
                    'organization': organization.pk,
                    'host_filter': 'name__icontains=web',
                },
            }
        ],
    }

    with mock.patch('awx.api.views.ai._call_ai_provider', return_value=json.dumps(generated_plan)) as call_provider:
        response = post(
            reverse('api:ai_resource_actions'),
            data={'mode': 'preview', 'prompt': 'Create a smart inventory for web hosts.'},
            user=admin_user,
            expect=200,
        )

    assert response.data['generated'] is True
    assert response.data['can_apply'] is True
    assert response.data['operations'][0]['resource_type'] == 'smart_inventory'
    assert response.data['operations'][0]['data']['kind'] == 'smart'
    assert response.data['operations'][0]['preview']['matched_hosts_count'] == 1
    system_prompt = call_provider.call_args.args[4]
    assert 'For smart_inventory' in system_prompt
    assert 'For constructed_inventory' in system_prompt
    assert '"hosts"' in system_prompt
    call_provider.assert_called_once()


@pytest.mark.django_db
@override_settings(AI_OPENAI_CODEX_CLIENT_ID='client-id', AI_OPENAI_CODEX_SCOPE='openid api.responses.write')
def test_openai_codex_device_code_start_requires_system_admin(post, admin_user, rando):
    post(reverse('api:ai_openai_codex_device_code_start'), data={}, user=rando, expect=403)

    payload = {
        'device_auth_id': 'device-123',
        'user_code': 'ABCD-EFGH',
        'expires_in': 900,
        'interval': 5,
    }
    with mock.patch('awx.api.views.ai.requests.post', return_value=FakeJSONResponse(payload)) as requests_post:
        response = post(reverse('api:ai_openai_codex_device_code_start'), data={}, user=admin_user, expect=200)

    assert response.data['device_code'] == 'device-123'
    assert response.data['user_code'] == 'ABCD-EFGH'
    assert response.data['verification_uri'] == 'https://auth.openai.com/codex/device'
    assert requests_post.call_args.args[0] == 'https://auth.openai.com/api/accounts/deviceauth/usercode'


@pytest.mark.django_db
@override_settings(AI_OPENAI_CODEX_ACCESS_TOKEN='oauth-token', AI_OPENAI_CODEX_AVAILABLE_MODELS=[])
def test_openai_codex_model_refresh_falls_back_to_curated_catalog(get, post, admin_user):
    settings_response = get(reverse('api:ai_openai_codex_models'), user=admin_user, expect=200)
    assert settings_response.data['models'][0] == 'gpt-5.2'
    assert settings_response.data['source'] == 'curated'

    with mock.patch('awx.api.views.ai.requests.get', return_value=FakeJSONResponse({'error': 'Unauthorized'}, status_code=401)) as requests_get:
        response = post(reverse('api:ai_openai_codex_models_refresh'), data={}, user=admin_user, expect=200)

    assert response.data['source'] == 'curated'
    assert response.data['models'] == [
        'gpt-5.2',
        'gpt-5.2-codex',
        'gpt-5.3-codex',
        'gpt-5.1-codex-max',
        'gpt-5.1-codex',
        'gpt-5.1-codex-mini',
    ]
    assert requests_get.call_args.args[0] == 'https://api.openai.com/v1/models'


@pytest.mark.django_db
@override_settings(AI_OPENAI_CODEX_ACCESS_TOKEN='oauth-token', AI_OPENAI_CODEX_AVAILABLE_MODELS=[])
def test_openai_codex_model_refresh_saves_live_chat_models(post, admin_user):
    payload = {'data': [{'id': 'gpt-5.2'}, {'id': 'o3-mini'}, {'id': 'text-embedding-3-large'}, {'id': 'whisper-1'}]}
    with mock.patch('awx.api.views.ai.requests.get', return_value=FakeJSONResponse(payload)) as requests_get:
        response = post(reverse('api:ai_openai_codex_models_refresh'), data={}, user=admin_user, expect=200)

    assert response.data['source'] == 'live'
    assert response.data['models'] == ['gpt-5.2', 'o3-mini']
    assert requests_get.call_args.kwargs['headers']['Authorization'] == 'Bearer oauth-token'
    assert Setting.objects.get(key='AI_OPENAI_CODEX_AVAILABLE_MODELS').value == ['gpt-5.2', 'o3-mini']


@pytest.mark.django_db
@override_settings(AI_OPENAI_CODEX_AVAILABLE_MODELS=['gpt-5.2', 'gpt-5.3-codex'])
def test_openai_codex_default_model_requires_system_admin_and_saves_setting(post, admin_user, rando):
    post(reverse('api:ai_openai_codex_models_default'), data={'model': 'gpt-5.3-codex'}, user=rando, expect=403)

    response = post(reverse('api:ai_openai_codex_models_default'), data={'model': 'gpt-5.3-codex'}, user=admin_user, expect=200)

    assert response.data['default_model'] == 'gpt-5.3-codex'
    assert Setting.objects.get(key='AI_MODEL_NAME').value == 'gpt-5.3-codex'
