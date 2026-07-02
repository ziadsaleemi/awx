import pytest
from django.test import override_settings

from awx.api.versioning import reverse
from awx.main.models import Project, QuayImageBuildJob, QuayImageBuildTemplate, Schedule


def quay_response(mocker, payload):
    response = mocker.Mock()
    response.content = b'{}'
    response.raise_for_status.return_value = None
    response.json.return_value = payload
    return response


@pytest.mark.django_db
@override_settings(MODULE_QUAY_ENABLED=False, QUAY_REGISTRY_URL='https://quay.example.test')
def test_quay_status_reports_module_disabled(get, admin_user):
    response = get(reverse('api:quay_status'), user=admin_user, expect=200)

    assert response.data['enabled'] is False
    assert response.data['configured'] is False
    assert response.data['status'] == 'disabled'
    assert response.data['server_url'] == ''
    assert response.data['settings_url'].endswith('/api/v2/settings/quay/')


@pytest.mark.django_db
@override_settings(MODULE_QUAY_ENABLED=True, QUAY_REGISTRY_URL='https://quay.example.test', QUAY_NAMESPACE='')
def test_quay_status_reports_missing_namespace(get, admin_user):
    response = get(reverse('api:quay_status'), user=admin_user, expect=200)

    assert response.data['enabled'] is True
    assert response.data['configured'] is True
    assert response.data['namespace'] == ''
    assert response.data['controller_error'] == 'Project Quay namespace is not configured.'


@pytest.mark.django_db
@override_settings(
    MODULE_QUAY_ENABLED=True,
    QUAY_REGISTRY_URL='https://quay.example.test',
    QUAY_NAMESPACE='awx',
    QUAY_API_TOKEN='quay-token',
    QUAY_PUSH_USERNAME='awx+robot',
    QUAY_PUSH_TOKEN='push-token',
)
def test_quay_status_reads_repository_count(get, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.quay.requests.get',
        return_value=quay_response(mocker, {'repositories': [{'name': 'custom-ee'}, {'name': 'job-ee'}]}),
    )

    response = get(reverse('api:quay_status'), user=admin_user, expect=200)

    assert response.data['enabled'] is True
    assert response.data['configured'] is True
    assert response.data['registry'] == 'quay.example.test'
    assert response.data['namespace'] == 'awx'
    assert response.data['auth_configured'] is True
    assert response.data['push_configured'] is True
    assert response.data['can_manage'] is True
    assert response.data['management_configured'] is True
    assert response.data['management_required_scopes'] == ['repo:read', 'repo:create', 'repo:write', 'repo:admin', 'user:admin', 'org:admin']
    assert response.data['counts']['repositories'] == 2
    assert request_mock.call_args.args[0] == 'https://quay.example.test/api/v1/repository'
    assert request_mock.call_args.kwargs['params']['namespace'] == 'awx'
    assert request_mock.call_args.kwargs['headers']['Authorization'] == 'Bearer quay-token'


@pytest.mark.django_db
@override_settings(
    MODULE_QUAY_ENABLED=True,
    QUAY_REGISTRY_URL='https://quay.example.test',
    QUAY_NAMESPACE='awx',
    QUAY_API_TOKEN='quay-token',
)
def test_quay_status_caches_live_repository_count(get, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.quay.requests.get',
        return_value=quay_response(mocker, {'repositories': [{'name': 'custom-ee'}]}),
    )

    first_response = get(reverse('api:quay_status'), user=admin_user, expect=200)
    second_response = get(reverse('api:quay_status'), user=admin_user, expect=200)

    assert first_response.data['counts']['repositories'] == 1
    assert second_response.data['counts']['repositories'] == 1
    assert request_mock.call_count == 1

    get(reverse('api:quay_status') + '?refresh=1', user=admin_user, expect=200)

    assert request_mock.call_count == 2


@pytest.mark.django_db
@override_settings(
    MODULE_QUAY_ENABLED=True,
    QUAY_REGISTRY_URL='https://quay.example.test',
    QUAY_NAMESPACE='awx',
    QUAY_API_TOKEN='quay-token',
)
def test_quay_api_token_plan_returns_scopes_and_commands(get, admin_user):
    response = get(reverse('api:quay_api_token_plan'), user=admin_user, expect=200)

    assert response.data['source'] == 'quay'
    assert response.data['configured'] is True
    assert response.data['auth_configured'] is True
    assert response.data['token_setting'] == 'QUAY_API_TOKEN'
    assert response.data['required_scopes'] == ['repo:read', 'repo:create', 'repo:write', 'repo:admin', 'user:admin', 'org:admin']
    assert response.data['oauth_application']['create_url'] == 'https://quay.example.test/api/v1/organization/awx/applications'
    assert response.data['app_specific_token']['create_url'] == 'https://quay.example.test/api/v1/user/apptoken'
    assert response.data['validation_commands'][0]['command'] == (
        'curl -fsS -H "Authorization: Bearer $QUAY_API_TOKEN" ' "'https://quay.example.test/api/v1/repository?namespace=awx&limit=1'"
    )
    assert response.data['settings_url'].endswith('/api/v2/settings/quay/')


@pytest.mark.django_db
def test_quay_api_token_plan_requires_quay_management_permission(get, rando):
    response = get(reverse('api:quay_api_token_plan'), user=rando, expect=403)

    assert response.status_code == 403


@pytest.mark.django_db
@override_settings(
    MODULE_QUAY_ENABLED=True,
    QUAY_REGISTRY_URL='https://quay.example.test',
    QUAY_NAMESPACE='awx',
    QUAY_API_TOKEN='quay-token',
)
def test_quay_repositories_list_normalizes_repository_payload(get, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.quay.requests.get',
        return_value=quay_response(
            mocker,
            {
                'repositories': [
                    {
                        'name': 'custom-ee',
                        'namespace': 'awx',
                        'description': 'AWX custom execution environment',
                    }
                ]
            },
        ),
    )

    response = get(reverse('api:quay_repositories_list') + '?search=custom', user=admin_user, expect=200)

    assert response.data['source'] == 'quay'
    assert response.data['resource'] == 'repositories'
    assert response.data['namespace'] == 'awx'
    assert response.data['results'][0]['name'] == 'custom-ee'
    assert request_mock.call_args.args[0] == 'https://quay.example.test/api/v1/repository'
    assert request_mock.call_args.kwargs['params']['query'] == 'custom'


@pytest.mark.django_db
@override_settings(
    MODULE_QUAY_ENABLED=True,
    QUAY_REGISTRY_URL='https://quay.example.test',
    QUAY_NAMESPACE='awx',
    QUAY_API_TOKEN='quay-token',
)
def test_quay_repository_create_calls_quay_api(post, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.quay.requests.post',
        return_value=quay_response(mocker, {'name': 'custom-ee'}),
    )

    response = post(
        reverse('api:quay_repository_create'),
        data={
            'repository': 'custom-ee',
            'description': 'AWX custom execution environment',
            'visibility': 'private',
        },
        user=admin_user,
        expect=201,
    )

    assert response.data['source'] == 'quay'
    assert response.data['action'] == 'create'
    assert response.data['repository_path'] == 'awx/custom-ee'
    assert request_mock.call_args.args[0] == 'https://quay.example.test/api/v1/repository'
    assert request_mock.call_args.kwargs['json'] == {
        'namespace': 'awx',
        'repository': 'custom-ee',
        'visibility': 'private',
        'description': 'AWX custom execution environment',
        'repo_kind': 'image',
    }


@pytest.mark.django_db
@override_settings(
    MODULE_QUAY_ENABLED=True,
    QUAY_REGISTRY_URL='https://quay.example.test',
    QUAY_NAMESPACE='awx',
    QUAY_API_TOKEN='quay-token',
)
def test_quay_repository_update_calls_quay_api(post, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.quay.requests.put',
        return_value=quay_response(mocker, {'name': 'custom-ee'}),
    )

    response = post(
        reverse('api:quay_repository_update'),
        data={'repository': 'custom-ee', 'description': 'Updated description'},
        user=admin_user,
        expect=200,
    )

    assert response.data['action'] == 'update'
    assert request_mock.call_args.args[0] == 'https://quay.example.test/api/v1/repository/awx/custom-ee'
    assert request_mock.call_args.kwargs['json'] == {'description': 'Updated description'}


@pytest.mark.django_db
@override_settings(
    MODULE_QUAY_ENABLED=True,
    QUAY_REGISTRY_URL='https://quay.example.test',
    QUAY_NAMESPACE='awx',
    QUAY_API_TOKEN='quay-token',
)
def test_quay_repository_change_visibility_calls_quay_api(post, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.quay.requests.post',
        return_value=quay_response(mocker, {'visibility': 'public'}),
    )

    response = post(
        reverse('api:quay_repository_change_visibility'),
        data={'repository': 'custom-ee', 'visibility': 'public'},
        user=admin_user,
        expect=200,
    )

    assert response.data['action'] == 'change_visibility'
    assert response.data['visibility'] == 'public'
    assert request_mock.call_args.args[0] == 'https://quay.example.test/api/v1/repository/awx/custom-ee/changevisibility'
    assert request_mock.call_args.kwargs['json'] == {'visibility': 'public'}


@pytest.mark.django_db
@override_settings(
    MODULE_QUAY_ENABLED=True,
    QUAY_REGISTRY_URL='https://quay.example.test',
    QUAY_NAMESPACE='awx',
    QUAY_API_TOKEN='quay-token',
)
def test_quay_repository_delete_calls_quay_api(post, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.quay.requests.delete',
        return_value=quay_response(mocker, {}),
    )

    response = post(
        reverse('api:quay_repository_delete'),
        data={'repository': 'custom-ee'},
        user=admin_user,
        expect=200,
    )

    assert response.data['action'] == 'delete'
    assert request_mock.call_args.args[0] == 'https://quay.example.test/api/v1/repository/awx/custom-ee'


@pytest.mark.django_db
def test_quay_repository_management_requires_quay_permission(post, rando):
    response = post(
        reverse('api:quay_repository_create'),
        data={'repository': 'custom-ee'},
        user=rando,
        expect=403,
    )

    assert response.status_code == 403


@pytest.mark.django_db
def test_quay_repository_create_rejects_namespace_in_repository_name(post, admin_user):
    with override_settings(MODULE_QUAY_ENABLED=True, QUAY_REGISTRY_URL='https://quay.example.test', QUAY_NAMESPACE='awx'):
        response = post(
            reverse('api:quay_repository_create'),
            data={'repository': 'awx/custom-ee'},
            user=admin_user,
            expect=400,
        )

    assert response.data['status'] == 'bad_request'


@pytest.mark.django_db
@override_settings(
    MODULE_QUAY_ENABLED=True,
    QUAY_REGISTRY_URL='https://quay.example.test',
    QUAY_NAMESPACE='awx',
    QUAY_API_TOKEN='quay-token',
)
def test_quay_tags_list_requires_repository(get, admin_user):
    response = get(reverse('api:quay_tags_list'), user=admin_user, expect=400)

    assert response.data['status'] == 'bad_request'


@pytest.mark.django_db
@override_settings(
    MODULE_QUAY_ENABLED=True,
    QUAY_REGISTRY_URL='https://quay.example.test',
    QUAY_NAMESPACE='awx',
    QUAY_API_TOKEN='quay-token',
)
def test_quay_tags_list_normalizes_tags_payload(get, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.quay.requests.get',
        return_value=quay_response(
            mocker,
            {
                'tags': [
                    {
                        'name': 'v1',
                        'manifest_digest': 'sha256:abc',
                        'size': 42,
                    }
                ]
            },
        ),
    )

    response = get(reverse('api:quay_tags_list') + '?repository=custom-ee', user=admin_user, expect=200)

    assert response.data['source'] == 'quay'
    assert response.data['resource'] == 'tags'
    assert response.data['repository'] == 'custom-ee'
    assert response.data['results'][0]['name'] == 'v1'
    assert request_mock.call_args.args[0] == 'https://quay.example.test/api/v1/repository/awx/custom-ee/tag/'


@pytest.mark.django_db
@override_settings(
    MODULE_QUAY_ENABLED=True,
    QUAY_REGISTRY_URL='https://quay.example.test',
    QUAY_NAMESPACE='awx',
    QUAY_API_TOKEN='quay-token',
)
def test_quay_tag_delete_calls_quay_api(post, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.quay.requests.delete',
        return_value=quay_response(mocker, {}),
    )

    response = post(
        reverse('api:quay_tag_delete'),
        data={'repository': 'custom-ee', 'tag': 'v1'},
        user=admin_user,
        expect=200,
    )

    assert response.data['action'] == 'delete_tag'
    assert response.data['tag'] == 'v1'
    assert request_mock.call_args.args[0] == 'https://quay.example.test/api/v1/repository/awx/custom-ee/tag/v1'


@pytest.mark.django_db
@override_settings(
    MODULE_QUAY_ENABLED=True,
    QUAY_REGISTRY_URL='https://quay.example.test',
    QUAY_NAMESPACE='awx',
    QUAY_API_TOKEN='quay-token',
)
def test_quay_repository_permissions_lists_user_and_team_permissions(get, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.quay.requests.get',
        side_effect=[
            quay_response(mocker, {'permissions': [{'username': 'awx+builder', 'role': 'write'}]}),
            quay_response(mocker, {'qa-team': {'role': 'read'}}),
        ],
    )

    response = get(reverse('api:quay_repository_permissions') + '?repository=custom-ee', user=admin_user, expect=200)

    assert response.data['resource'] == 'repository_permissions'
    assert response.data['users'][0]['username'] == 'awx+builder'
    assert response.data['teams'][0]['teamname'] == 'qa-team'
    assert response.data['teams'][0]['role'] == 'read'
    assert request_mock.call_args_list[0].args[0] == 'https://quay.example.test/api/v1/repository/awx/custom-ee/permissions/user/'
    assert request_mock.call_args_list[1].args[0] == 'https://quay.example.test/api/v1/repository/awx/custom-ee/permissions/team/'


@pytest.mark.django_db
@override_settings(
    MODULE_QUAY_ENABLED=True,
    QUAY_REGISTRY_URL='https://quay.example.test',
    QUAY_NAMESPACE='awx',
    QUAY_API_TOKEN='quay-token',
)
def test_quay_repository_permission_set_and_delete_calls_quay_api(post, admin_user, mocker):
    put_mock = mocker.patch('awx.main.utils.quay.requests.put', return_value=quay_response(mocker, {'role': 'write'}))
    delete_mock = mocker.patch('awx.main.utils.quay.requests.delete', return_value=quay_response(mocker, {}))

    response = post(
        reverse('api:quay_repository_user_permission_set'),
        data={'repository': 'custom-ee', 'username': 'awx+builder', 'role': 'write'},
        user=admin_user,
        expect=200,
    )

    assert response.data['action'] == 'set_user_permission'
    assert put_mock.call_args.args[0] == 'https://quay.example.test/api/v1/repository/awx/custom-ee/permissions/user/awx+builder'
    assert put_mock.call_args.kwargs['json'] == {'role': 'write'}

    response = post(
        reverse('api:quay_repository_team_permission_delete'),
        data={'repository': 'custom-ee', 'teamname': 'qa-team'},
        user=admin_user,
        expect=200,
    )

    assert response.data['action'] == 'delete_team_permission'
    assert delete_mock.call_args.args[0] == 'https://quay.example.test/api/v1/repository/awx/custom-ee/permissions/team/qa-team'


@pytest.mark.django_db
@override_settings(
    MODULE_QUAY_ENABLED=True,
    QUAY_REGISTRY_URL='https://quay.example.test',
    QUAY_NAMESPACE='awx',
    QUAY_API_TOKEN='quay-token',
)
def test_quay_robots_list_uses_organization_endpoint(get, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.quay.requests.get',
        return_value=quay_response(mocker, {'robots': [{'name': 'awx+builder', 'shortname': 'builder'}]}),
    )

    response = get(reverse('api:quay_robots_list') + '?namespace_kind=organization', user=admin_user, expect=200)

    assert response.data['resource'] == 'robots'
    assert response.data['namespace_kind'] == 'organization'
    assert response.data['results'][0]['shortname'] == 'builder'
    assert request_mock.call_args.args[0] == 'https://quay.example.test/api/v1/organization/awx/robots'
    assert request_mock.call_args.kwargs['params']['permissions'] is True


@pytest.mark.django_db
@override_settings(
    MODULE_QUAY_ENABLED=True,
    QUAY_REGISTRY_URL='https://quay.example.test',
    QUAY_NAMESPACE='awx',
    QUAY_API_TOKEN='quay-token',
)
def test_quay_robot_create_delete_and_regenerate_call_quay_api(post, admin_user, mocker):
    put_mock = mocker.patch('awx.main.utils.quay.requests.put', return_value=quay_response(mocker, {'name': 'awx+builder'}))
    delete_mock = mocker.patch('awx.main.utils.quay.requests.delete', return_value=quay_response(mocker, {}))
    post_mock = mocker.patch('awx.main.utils.quay.requests.post', return_value=quay_response(mocker, {'token': 'new-token'}))

    response = post(
        reverse('api:quay_robot_create'),
        data={'namespace_kind': 'organization', 'robot': 'builder', 'description': 'AWX image builder'},
        user=admin_user,
        expect=201,
    )

    assert response.data['action'] == 'create_robot'
    assert put_mock.call_args.args[0] == 'https://quay.example.test/api/v1/organization/awx/robots/builder'
    assert put_mock.call_args.kwargs['json'] == {'description': 'AWX image builder'}

    response = post(
        reverse('api:quay_robot_delete'),
        data={'namespace_kind': 'user', 'robot': 'builder'},
        user=admin_user,
        expect=200,
    )

    assert response.data['action'] == 'delete_robot'
    assert delete_mock.call_args.args[0] == 'https://quay.example.test/api/v1/user/robots/builder'

    response = post(
        reverse('api:quay_robot_regenerate_token'),
        data={'namespace_kind': 'organization', 'robot': 'builder'},
        user=admin_user,
        expect=200,
    )

    assert response.data['action'] == 'regenerate_robot_token'
    assert post_mock.call_args.args[0] == 'https://quay.example.test/api/v1/organization/awx/robots/builder/regenerate'


@pytest.mark.django_db
def test_quay_execution_environment_image_build_plan_handles_awx_project_source(post, admin_user, organization, tmp_path):
    project_root = tmp_path / 'ee-project'
    source_dir = project_root / 'ee'
    source_dir.mkdir(parents=True)
    (source_dir / 'execution-environment.yml').write_text('version: 3\n', encoding='utf-8')
    project = Project.objects.create(name='EE Project', organization=organization, scm_type='', local_path='ee-project')

    with override_settings(
        MODULE_QUAY_ENABLED=True,
        QUAY_REGISTRY_URL='https://quay.example.test',
        QUAY_NAMESPACE='awx',
        QUAY_PUSH_USERNAME='awx+robot',
        QUAY_PUSH_TOKEN='push-token',
        PROJECTS_ROOT=str(tmp_path),
    ):
        response = post(
            reverse('api:quay_execution_environment_image_build_plan'),
            data={
                'project_id': project.pk,
                'image_name': 'custom-ee',
                'tag': 'v1',
                'runtime': 'podman',
                'definition_file': 'ee/execution-environment.yml',
                'context': 'ee',
            },
            user=admin_user,
            expect=200,
        )

    assert response.data['source'] == 'quay'
    assert response.data['project']['project_id'] == project.pk
    assert response.data['project']['project_path'] == str(project_root)
    assert response.data['registry']['registry'] == 'quay.example.test'
    assert response.data['registry']['namespace'] == 'awx'
    assert response.data['image']['repository_path'] == 'awx/custom-ee'
    assert response.data['image']['awx'] == 'quay.example.test/awx/custom-ee:v1'
    assert response.data['commands'][0]['command'] == (
        f'cd {project_root} && ansible-builder build --container-runtime podman -f ee/execution-environment.yml -t quay.example.test/awx/custom-ee:v1 -c ee'
    )
    assert response.data['commands'][1]['command'] == ('echo "$QUAY_TOKEN" | podman login quay.example.test --username awx+robot --password-stdin')
    assert response.data['commands'][2]['command'] == 'podman push quay.example.test/awx/custom-ee:v1'
    assert response.data['awx_execution_environment'] == {
        'image': 'quay.example.test/awx/custom-ee:v1',
        'pull': 'missing',
    }


@pytest.mark.django_db
def test_quay_execution_environment_image_build_create_queues_dispatcher_task(post, get, admin_user, organization, tmp_path, mocker):
    project_root = tmp_path / 'ee-project'
    source_dir = project_root / 'ee'
    source_dir.mkdir(parents=True)
    (source_dir / 'execution-environment.yml').write_text('version: 3\n', encoding='utf-8')
    project = Project.objects.create(name='EE Project', organization=organization, scm_type='', local_path='ee-project', scm_revision='abc123')
    task_delay = mocker.patch('awx.api.views.quay.run_quay_image_build.delay')
    on_commit = mocker.patch('awx.api.views.quay.transaction.on_commit', side_effect=lambda callback, *args, **kwargs: callback())

    with override_settings(
        MODULE_QUAY_ENABLED=True,
        QUAY_REGISTRY_URL='https://quay.example.test',
        QUAY_NAMESPACE='awx',
        QUAY_PUSH_USERNAME='awx+robot',
        QUAY_PUSH_TOKEN='push-token',
        PROJECTS_ROOT=str(tmp_path),
    ):
        response = post(
            reverse('api:quay_image_builds'),
            data={
                'project_id': project.pk,
                'repository': 'custom-ee',
                'tag': 'v1',
                'runtime': 'podman',
                'definition_file': 'ee/execution-environment.yml',
                'context': 'ee',
            },
            user=admin_user,
            expect=202,
        )
        list_response = get(reverse('api:quay_image_builds') + '?repository=custom-ee', user=admin_user, expect=200)

    assert response.data['status'] == 'pending'
    assert response.data['progress'] == 0
    assert response.data['image'] == 'quay.example.test/awx/custom-ee:v1'
    assert response.data['project']['name'] == 'EE Project'
    assert response.data['project']['scm_revision'] == 'abc123'
    assert response.data['command_summary'][0]['label'] == 'Build execution environment'
    assert on_commit.called is True
    assert task_delay.call_args.args == (response.data['id'],)
    assert list_response.data['count'] == 1
    assert list_response.data['results'][0]['log'] == ''
    assert list_response.data['results'][0]['repository_path'] == 'awx/custom-ee'


@pytest.mark.django_db
def test_quay_execution_environment_image_build_template_crud_and_launch(post, get, patch, delete, admin_user, organization, tmp_path, mocker):
    project_root = tmp_path / 'ee-project'
    source_dir = project_root / 'ee'
    source_dir.mkdir(parents=True)
    (source_dir / 'execution-environment.yml').write_text('version: 3\n', encoding='utf-8')
    project = Project.objects.create(name='EE Project', organization=organization, scm_type='', local_path='ee-project', scm_revision='abc123')
    signal_start = mocker.patch.object(QuayImageBuildJob, 'signal_start', autospec=True)
    mocker.patch('awx.api.views.quay.transaction.on_commit', side_effect=lambda callback, *args, **kwargs: callback())

    with override_settings(
        MODULE_QUAY_ENABLED=True,
        QUAY_REGISTRY_URL='https://quay.example.test',
        QUAY_NAMESPACE='awx',
        QUAY_PUSH_USERNAME='awx+robot',
        QUAY_PUSH_TOKEN='push-token',
        PROJECTS_ROOT=str(tmp_path),
    ):
        create_response = post(
            reverse('api:quay_image_build_templates'),
            data={
                'name': 'Platform EE',
                'description': 'Reusable platform execution environment.',
                'project_id': project.pk,
                'repository': 'platform-ee',
                'tag': 'v1',
                'runtime': 'podman',
                'definition_file': 'ee/execution-environment.yml',
                'context': 'ee',
            },
            user=admin_user,
            expect=201,
        )
        list_response = get(reverse('api:quay_image_build_templates'), user=admin_user, expect=200)
        QuayImageBuildTemplate.objects.create(
            name='Utility EE',
            project=project,
            namespace='awx',
            repository='utility-ee',
            tag='latest',
            runtime='podman',
            definition_file='ee/execution-environment.yml',
            context_path='ee',
        )
        filtered_response = get(reverse('api:quay_image_build_templates') + '?search=platform&order_by=-name', user=admin_user, expect=200)
        ordered_response = get(reverse('api:quay_image_build_templates') + '?order_by=-name', user=admin_user, expect=200)
        update_response = patch(
            create_response.data['url'],
            data={
                'name': 'Platform EE',
                'project_id': project.pk,
                'repository': 'platform-ee',
                'tag': 'v2',
                'runtime': 'podman',
                'definition_file': 'ee/execution-environment.yml',
                'context': 'ee',
            },
            user=admin_user,
            expect=200,
        )
        launch_response = post(create_response.data['launch_url'], data={}, user=admin_user, expect=202)
        build_list_response = get(reverse('api:quay_image_builds') + f'?template={create_response.data["id"]}', user=admin_user, expect=200)
        template = QuayImageBuildTemplate.objects.get(pk=create_response.data['id'])
        Schedule.objects.create(
            name='Nightly EE build',
            unified_job_template=template,
            rrule='DTSTART;TZID=America/New_York:20260702T120000 RRULE:FREQ=DAILY;INTERVAL=1',
        )
        jobs_response = get(reverse('api:quay_image_build_template_jobs_list', kwargs={'pk': create_response.data['id']}), user=admin_user, expect=200)
        schedules_response = get(
            reverse('api:quay_image_build_template_schedules_list', kwargs={'pk': create_response.data['id']}), user=admin_user, expect=200
        )
        object_roles_response = get(
            reverse('api:quay_image_build_template_object_roles', kwargs={'pk': create_response.data['id']}), user=admin_user, expect=200
        )
        notifications_started_response = get(
            reverse('api:quay_image_build_template_notification_templates_started', kwargs={'pk': create_response.data['id']}),
            user=admin_user,
            expect=200,
        )
        native_job = QuayImageBuildJob.objects.get(pk=launch_response.data['unified_job']['id'])
        delete_response = delete(create_response.data['url'], user=admin_user, expect=204)

    assert create_response.data['name'] == 'Platform EE'
    assert create_response.data['project']['id'] == project.pk
    assert create_response.data['project']['organization']['name'] == organization.name
    assert create_response.data['image'] == 'quay.example.test/awx/platform-ee:v1'
    assert create_response.data['launch_url'].endswith(f'/api/v2/quay/execution-environment-images/templates/{create_response.data["id"]}/launch/')
    assert list_response.data['count'] == 1
    assert list_response.data['results'][0]['name'] == 'Platform EE'
    assert filtered_response.data['count'] == 1
    assert filtered_response.data['results'][0]['name'] == 'Platform EE'
    assert ordered_response.data['results'][0]['name'] == 'Utility EE'
    assert update_response.data['image'] == 'quay.example.test/awx/platform-ee:v2'
    assert launch_response.data['template']['id'] == create_response.data['id']
    assert launch_response.data['image'] == 'quay.example.test/awx/platform-ee:v2'
    assert launch_response.data['unified_job']['id'] == native_job.pk
    assert native_job.quay_image_build_template_id == create_response.data['id']
    assert signal_start.call_args.args[0] == native_job
    assert build_list_response.data['count'] == 1
    assert build_list_response.data['results'][0]['unified_job']['id'] == native_job.pk
    assert jobs_response.data['count'] == 1
    assert jobs_response.data['results'][0]['id'] == native_job.pk
    assert schedules_response.data['count'] == 1
    assert schedules_response.data['results'][0]['name'] == 'Nightly EE build'
    assert object_roles_response.data['count'] >= 3
    assert notifications_started_response.data['count'] == 0
    assert delete_response.status_code == 204


@pytest.mark.django_db
def test_quay_execution_environment_image_build_template_requires_unique_name(post, admin_user, organization, tmp_path):
    project_root = tmp_path / 'ee-project'
    source_dir = project_root / 'ee'
    source_dir.mkdir(parents=True)
    (source_dir / 'execution-environment.yml').write_text('version: 3\n', encoding='utf-8')
    project = Project.objects.create(name='EE Project', organization=organization, scm_type='', local_path='ee-project')
    QuayImageBuildTemplate.objects.create(
        name='Platform EE',
        project=project,
        namespace='awx',
        repository='platform-ee',
        tag='v1',
        runtime='podman',
        definition_file='ee/execution-environment.yml',
        context_path='ee',
    )

    with override_settings(
        MODULE_QUAY_ENABLED=True,
        QUAY_REGISTRY_URL='https://quay.example.test',
        QUAY_NAMESPACE='awx',
        PROJECTS_ROOT=str(tmp_path),
    ):
        response = post(
            reverse('api:quay_image_build_templates'),
            data={
                'name': 'Platform EE',
                'project_id': project.pk,
                'repository': 'platform-ee',
                'definition_file': 'ee/execution-environment.yml',
                'context': 'ee',
            },
            user=admin_user,
            expect=400,
        )

    assert response.data['status'] == 'bad_request'
    assert response.data['detail'] == 'A Project Quay image build template with this name already exists.'


@pytest.mark.django_db
def test_quay_execution_environment_image_build_requires_push_credentials(post, admin_user, organization, tmp_path):
    project_root = tmp_path / 'ee-project'
    source_dir = project_root / 'ee'
    source_dir.mkdir(parents=True)
    (source_dir / 'execution-environment.yml').write_text('version: 3\n', encoding='utf-8')
    project = Project.objects.create(name='EE Project', organization=organization, scm_type='', local_path='ee-project')

    with override_settings(
        MODULE_QUAY_ENABLED=True,
        QUAY_REGISTRY_URL='https://quay.example.test',
        QUAY_NAMESPACE='awx',
        PROJECTS_ROOT=str(tmp_path),
    ):
        response = post(
            reverse('api:quay_image_builds'),
            data={
                'project_id': project.pk,
                'repository': 'custom-ee',
                'definition_file': 'ee/execution-environment.yml',
                'context': 'ee',
            },
            user=admin_user,
            expect=400,
        )

    assert response.data['status'] == 'bad_request'
    assert response.data['detail'] == 'Project Quay push credentials are required before AWX can launch an image build.'


@pytest.mark.django_db
def test_quay_execution_environment_image_build_plan_requires_quay_management_permission(post, rando):
    response = post(
        reverse('api:quay_execution_environment_image_build_plan'),
        data={'project_id': 1, 'image_name': 'custom-ee'},
        user=rando,
        expect=403,
    )

    assert response.status_code == 403


@pytest.mark.django_db
def test_quay_execution_environment_image_build_plan_allows_project_updater(post, rando, organization, tmp_path):
    project_root = tmp_path / 'ee-project'
    source_dir = project_root / 'ee'
    source_dir.mkdir(parents=True)
    (source_dir / 'execution-environment.yml').write_text('version: 3\n', encoding='utf-8')
    project = Project.objects.create(name='EE Project', organization=organization, scm_type='', local_path='ee-project')
    project.update_role.members.add(rando)

    with override_settings(
        MODULE_QUAY_ENABLED=True,
        QUAY_REGISTRY_URL='https://quay.example.test',
        QUAY_NAMESPACE='awx',
        PROJECTS_ROOT=str(tmp_path),
    ):
        response = post(
            reverse('api:quay_execution_environment_image_build_plan'),
            data={
                'project_id': project.pk,
                'image_name': 'custom-ee',
                'definition_file': 'ee/execution-environment.yml',
                'context': 'ee',
            },
            user=rando,
            expect=200,
        )

    assert response.data['project']['project_id'] == project.pk
    assert response.data['image']['awx'] == 'quay.example.test/awx/custom-ee:latest'
