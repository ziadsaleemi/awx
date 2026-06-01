import base64
import json
from unittest import mock

import pytest
from django.test import override_settings

from awx.api.versioning import reverse
from awx.conf.models import Setting
from awx.main.models import ActivityStream, Credential, CredentialType, Host, Inventory, InventorySource, JobTemplate, Schedule


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
