import pytest
import requests
from django.test import override_settings

from awx.api.versioning import reverse
from awx.main.models import Project


def galaxy_response(mocker, payload):
    response = mocker.Mock()
    response.content = b'{}'
    response.raise_for_status.return_value = None
    response.json.return_value = payload
    return response


@pytest.mark.django_db
@override_settings(MODULE_GALAXY_NG_ENABLED=False, GALAXY_NG_SERVER_URL='https://hub.example.test')
def test_galaxy_ng_status_reports_module_disabled(get, admin_user):
    response = get(reverse('api:galaxy_ng_status'), user=admin_user, expect=200)

    assert response.data['enabled'] is False
    assert response.data['configured'] is False
    assert response.data['status'] == 'disabled'
    assert response.data['server_url'] == ''
    assert response.data['settings_url'].endswith('/api/v2/settings/galaxy-ng/')


@pytest.mark.django_db
@override_settings(MODULE_GALAXY_NG_ENABLED=True, GALAXY_NG_SERVER_URL='')
def test_galaxy_ng_status_reports_not_configured(get, admin_user):
    response = get(reverse('api:galaxy_ng_status'), user=admin_user, expect=200)

    assert response.data['enabled'] is True
    assert response.data['configured'] is False
    assert response.data['status'] == 'not_configured'
    assert response.data['counts'] == {
        'namespaces': 0,
        'collections': 0,
        'repositories': 0,
        'remotes': 0,
        'remote_registries': 0,
        'signature_keys': 0,
        'collection_approvals': 0,
        'tasks': 0,
    }


@pytest.mark.django_db
@override_settings(
    MODULE_GALAXY_NG_ENABLED=True,
    GALAXY_NG_SERVER_URL='https://hub.example.test',
    GALAXY_NG_AUTH_TOKEN='hub-token',
    GALAXY_NG_VERIFY_SSL=False,
    GALAXY_NG_REQUEST_TIMEOUT=3,
)
def test_galaxy_ng_status_reads_live_counts(get, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.galaxy_ng.requests.get',
        side_effect=[
            galaxy_response(mocker, {'database_connection': {'connected': True}}),
            galaxy_response(mocker, {'count': 2, 'results': []}),
            galaxy_response(mocker, {'count': 5, 'results': []}),
            galaxy_response(mocker, {'count': 3, 'results': []}),
            galaxy_response(mocker, {'count': 4, 'results': []}),
            galaxy_response(mocker, {'count': 6, 'results': []}),
            galaxy_response(mocker, {'count': 1, 'results': []}),
            galaxy_response(mocker, {'count': 7, 'results': []}),
            galaxy_response(mocker, {'count': 8, 'results': []}),
        ],
    )

    response = get(reverse('api:galaxy_ng_status'), user=admin_user, expect=200)

    assert response.data['enabled'] is True
    assert response.data['configured'] is True
    assert response.data['status'] == 'configured'
    assert response.data['server_url'] == 'https://hub.example.test'
    assert response.data['api_root_url'] == 'https://hub.example.test/api/galaxy/'
    assert response.data['content_url'] == 'https://hub.example.test/pulp/content/'
    assert response.data['ui_url'] == 'https://hub.example.test/ui/'
    assert response.data['auth_configured'] is True
    assert response.data['verify_ssl'] is False
    assert response.data['request_timeout'] == 3
    assert response.data['counts'] == {
        'namespaces': 2,
        'collections': 5,
        'repositories': 3,
        'remotes': 4,
        'remote_registries': 6,
        'signature_keys': 1,
        'collection_approvals': 7,
        'tasks': 8,
    }
    assert response.data['controller_error'] == ''
    assert request_mock.call_count == 9
    first_call = request_mock.call_args_list[0]
    assert first_call.args[0] == 'https://hub.example.test/api/galaxy/pulp/api/v3/status/'
    assert first_call.kwargs['headers']['Authorization'] == 'Bearer hub-token'
    assert first_call.kwargs['verify'] is False
    assert first_call.kwargs['timeout'] == 3


@pytest.mark.django_db
@override_settings(MODULE_GALAXY_NG_ENABLED=True, GALAXY_NG_SERVER_URL='https://hub.example.test')
def test_galaxy_ng_status_fails_soft_when_controller_unreachable(get, admin_user, mocker):
    mocker.patch('awx.main.utils.galaxy_ng.requests.get', side_effect=requests.Timeout('boom'))

    response = get(reverse('api:galaxy_ng_status'), user=admin_user, expect=200)

    assert response.data['configured'] is True
    assert response.data['counts']['collections'] == 0
    assert 'boom' in response.data['controller_error']


@pytest.mark.django_db
@override_settings(MODULE_GALAXY_NG_ENABLED=False, GALAXY_NG_SERVER_URL='https://hub.example.test')
def test_galaxy_ng_resource_list_reports_module_disabled(get, admin_user):
    response = get(reverse('api:galaxy_ng_collections_list'), user=admin_user, expect=200)

    assert response.data == {
        'count': 0,
        'next': None,
        'previous': None,
        'source': 'module_disabled',
        'resource': 'collections',
        'controller_error': '',
        'detail': 'Galaxy NG module is disabled.',
        'results': [],
    }


@pytest.mark.django_db
@override_settings(MODULE_GALAXY_NG_ENABLED=True, GALAXY_NG_SERVER_URL='')
def test_galaxy_ng_resource_list_reports_not_configured(get, admin_user):
    response = get(reverse('api:galaxy_ng_namespaces_list'), user=admin_user, expect=200)

    assert response.data['count'] == 0
    assert response.data['source'] == 'not_configured'
    assert response.data['resource'] == 'namespaces'
    assert response.data['results'] == []


@pytest.mark.django_db
@override_settings(
    MODULE_GALAXY_NG_ENABLED=True,
    GALAXY_NG_SERVER_URL='https://hub.example.test',
    GALAXY_NG_AUTH_TOKEN='hub-token',
)
def test_galaxy_ng_resource_list_normalizes_pulp_payload(get, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.galaxy_ng.requests.get',
        return_value=galaxy_response(
            mocker,
            {
                'count': 2,
                'results': [
                    {'pulp_href': '/pulp/api/v3/tasks/1/', 'name': 'import-one', 'state': 'completed'},
                    {'pulp_href': '/pulp/api/v3/tasks/2/', 'name': 'import-two', 'state': 'running'},
                ],
            },
        ),
    )

    response = get(reverse('api:galaxy_ng_tasks_list') + '?page=2&page_size=10&order_by=-name&name__icontains=import', user=admin_user, expect=200)

    assert response.data['count'] == 2
    assert response.data['next'] is None
    assert response.data['previous'] is None
    assert response.data['source'] == 'galaxy_ng'
    assert response.data['resource'] == 'tasks'
    assert response.data['controller_error'] == ''
    assert response.data['results'][0]['name'] == 'import-one'
    assert isinstance(response.data['results'][0]['id'], int)
    assert request_mock.call_args.args[0] == 'https://hub.example.test/api/galaxy/pulp/api/v3/tasks/'
    assert request_mock.call_args.kwargs['params'] == {
        'limit': 10,
        'offset': 10,
        'ordering': '-name',
        'search': 'import',
    }


@pytest.mark.django_db
@override_settings(
    MODULE_GALAXY_NG_ENABLED=True,
    GALAXY_NG_SERVER_URL='https://hub.example.test',
    GALAXY_NG_AUTH_TOKEN='hub-token',
)
def test_galaxy_ng_execution_environment_images_list_uses_container_tags_endpoint(get, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.galaxy_ng.requests.get',
        return_value=galaxy_response(
            mocker,
            {
                'count': 1,
                'results': [
                    {
                        'name': 'latest',
                        'repository': '/pulp/api/v3/repositories/container/container/1/',
                        'manifest': '/pulp/api/v3/content/container/manifests/1/',
                    }
                ],
            },
        ),
    )

    response = get(reverse('api:galaxy_ng_execution_environment_images_list'), user=admin_user, expect=200)

    assert response.data['count'] == 1
    assert response.data['resource'] == 'execution-environment-images'
    assert response.data['results'][0]['name'] == 'latest'
    assert request_mock.call_args.args[0] == 'https://hub.example.test/api/galaxy/pulp/api/v3/content/container/tags/'
    assert request_mock.call_args.kwargs['headers']['Authorization'] == 'Bearer hub-token'


@pytest.mark.django_db
@override_settings(
    MODULE_GALAXY_NG_ENABLED=True,
    GALAXY_NG_SERVER_URL='https://hub.example.test',
    GALAXY_NG_AUTH_TOKEN='hub-token',
)
def test_galaxy_ng_remotes_list_uses_pulp_ansible_remotes_endpoint(get, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.galaxy_ng.requests.get',
        return_value=galaxy_response(
            mocker,
            {
                'count': 1,
                'results': [
                    {
                        'name': 'community',
                        'url': 'https://galaxy.ansible.com/api/',
                        'policy': 'immediate',
                    }
                ],
            },
        ),
    )

    response = get(reverse('api:galaxy_ng_remotes_list'), user=admin_user, expect=200)

    assert response.data['count'] == 1
    assert response.data['resource'] == 'remotes'
    assert response.data['results'][0]['name'] == 'community'
    assert request_mock.call_args.args[0] == 'https://hub.example.test/api/galaxy/pulp/api/v3/remotes/ansible/collection/'
    assert request_mock.call_args.kwargs['headers']['Authorization'] == 'Bearer hub-token'


@pytest.mark.django_db
@override_settings(
    MODULE_GALAXY_NG_ENABLED=True,
    GALAXY_NG_SERVER_URL='https://hub.example.test',
    GALAXY_NG_AUTH_TOKEN='hub-token',
)
def test_galaxy_ng_remote_registries_list_uses_ui_registry_endpoint(get, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.galaxy_ng.requests.get',
        return_value=galaxy_response(
            mocker,
            {
                'count': 1,
                'results': [
                    {
                        'name': 'quay-remote',
                        'url': 'https://quay.io',
                        'policy': 'on_demand',
                    }
                ],
            },
        ),
    )

    response = get(reverse('api:galaxy_ng_remote_registries_list'), user=admin_user, expect=200)

    assert response.data['count'] == 1
    assert response.data['resource'] == 'remote-registries'
    assert response.data['results'][0]['name'] == 'quay-remote'
    assert request_mock.call_args.args[0] == 'https://hub.example.test/api/galaxy/_ui/v1/execution-environments/registries/'
    assert request_mock.call_args.kwargs['headers']['Authorization'] == 'Bearer hub-token'


@pytest.mark.django_db
@override_settings(
    MODULE_GALAXY_NG_ENABLED=True,
    GALAXY_NG_SERVER_URL='https://hub.example.test',
    GALAXY_NG_AUTH_TOKEN='hub-token',
)
def test_galaxy_ng_collection_approvals_list_scopes_to_staging(get, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.galaxy_ng.requests.get',
        return_value=galaxy_response(
            mocker,
            {
                'count': 1,
                'results': [
                    {
                        'namespace': 'infra',
                        'name': 'network',
                        'version': '1.0.0',
                        'sign_state': 'unsigned',
                    }
                ],
            },
        ),
    )

    response = get(reverse('api:galaxy_ng_collection_approvals_list'), user=admin_user, expect=200)

    assert response.data['count'] == 1
    assert response.data['resource'] == 'collection-approvals'
    assert response.data['results'][0]['namespace'] == 'infra'
    assert request_mock.call_args.args[0] == 'https://hub.example.test/api/galaxy/_ui/v1/collection-versions/'
    assert request_mock.call_args.kwargs['params'] == {
        'limit': 20,
        'offset': 0,
        'repository': 'staging',
    }


@pytest.mark.django_db
@override_settings(
    MODULE_GALAXY_NG_ENABLED=True,
    GALAXY_NG_SERVER_URL='https://hub.example.test',
    GALAXY_NG_AUTH_TOKEN='hub-token',
)
def test_galaxy_ng_collection_approval_approve_moves_to_published(post, admin_user, mocker):
    post_mock = mocker.patch(
        'awx.main.utils.galaxy_ng.requests.post',
        return_value=galaxy_response(mocker, {'copy_task_id': 42, 'remove_task_id': 42}),
    )

    response = post(
        reverse('api:galaxy_ng_collection_approval_approve'),
        data={'namespace': 'infra', 'name': 'network', 'version': '1.0.0'},
        user=admin_user,
        expect=202,
    )

    assert response.data['source'] == 'galaxy_ng'
    assert response.data['action'] == 'approve'
    assert response.data['destination_repository'] == 'published'
    assert response.data['task'] == 42
    assert response.data['remove_task'] == 42
    assert post_mock.call_args.args[0] == 'https://hub.example.test/api/galaxy/v3/collections/infra/network/versions/1.0.0/move/staging/published/'
    assert post_mock.call_args.kwargs['json'] == {}
    assert post_mock.call_args.kwargs['headers']['Authorization'] == 'Bearer hub-token'


@pytest.mark.django_db
@override_settings(
    MODULE_GALAXY_NG_ENABLED=True,
    GALAXY_NG_SERVER_URL='https://hub.example.test',
    GALAXY_NG_AUTH_TOKEN='hub-token',
)
def test_galaxy_ng_collection_approval_reject_moves_to_rejected(post, admin_user, mocker):
    post_mock = mocker.patch(
        'awx.main.utils.galaxy_ng.requests.post',
        return_value=galaxy_response(mocker, {'copy_task_id': 'reject-task', 'remove_task_id': 'reject-task'}),
    )

    response = post(
        reverse('api:galaxy_ng_collection_approval_reject'),
        data={'namespace': 'infra', 'name': 'network', 'version': '1.0.0+build.1'},
        user=admin_user,
        expect=202,
    )

    assert response.data['source'] == 'galaxy_ng'
    assert response.data['action'] == 'reject'
    assert response.data['destination_repository'] == 'rejected'
    assert response.data['task'] == 'reject-task'
    assert post_mock.call_args.args[0] == ('https://hub.example.test/api/galaxy/v3/collections/infra/network/versions/1.0.0%2Bbuild.1/move/staging/rejected/')


@pytest.mark.django_db
@override_settings(MODULE_GALAXY_NG_ENABLED=True, GALAXY_NG_SERVER_URL='https://hub.example.test')
def test_galaxy_ng_collection_approval_requires_system_admin(post, rando):
    post(
        reverse('api:galaxy_ng_collection_approval_approve'),
        data={'namespace': 'infra', 'name': 'network', 'version': '1.0.0'},
        user=rando,
        expect=403,
    )


@pytest.mark.django_db
@override_settings(MODULE_GALAXY_NG_ENABLED=True, GALAXY_NG_SERVER_URL='https://hub.example.test')
def test_galaxy_ng_collection_approval_rejects_unsafe_version(post, admin_user):
    response = post(
        reverse('api:galaxy_ng_collection_approval_approve'),
        data={'namespace': 'infra', 'name': 'network', 'version': '../1.0.0'},
        user=admin_user,
        expect=400,
    )

    assert response.data['status'] == 'bad_request'


@pytest.mark.django_db
@override_settings(MODULE_GALAXY_NG_ENABLED=True, GALAXY_NG_SERVER_URL='https://hub.example.test')
def test_galaxy_ng_resource_list_normalizes_galaxy_v3_payload(get, admin_user, mocker):
    mocker.patch(
        'awx.main.utils.galaxy_ng.requests.get',
        return_value=galaxy_response(
            mocker,
            {
                'meta': {'count': 1},
                'data': [
                    {
                        'namespace': 'infra',
                        'name': 'network',
                        'latest_version': {'version': '1.2.3'},
                    }
                ],
            },
        ),
    )

    response = get(reverse('api:galaxy_ng_collections_list'), user=admin_user, expect=200)

    assert response.data['count'] == 1
    assert response.data['results'][0]['namespace'] == 'infra'
    assert response.data['results'][0]['name'] == 'network'
    assert isinstance(response.data['results'][0]['id'], int)


@pytest.mark.django_db
@override_settings(
    MODULE_GALAXY_NG_ENABLED=True,
    GALAXY_NG_SERVER_URL='https://hub.example.test',
    GALAXY_NG_AUTH_TOKEN='hub-token',
)
def test_galaxy_ng_repository_sync_resolves_distribution_and_launches_task(post, admin_user, mocker):
    get_mock = mocker.patch(
        'awx.main.utils.galaxy_ng.requests.get',
        return_value=galaxy_response(
            mocker,
            {
                'count': 1,
                'results': [
                    {
                        'name': 'published',
                        'base_path': 'published',
                    }
                ],
            },
        ),
    )
    post_mock = mocker.patch(
        'awx.main.utils.galaxy_ng.requests.post',
        return_value=galaxy_response(mocker, {'task': 'sync-task-1'}),
    )

    response = post(
        reverse('api:galaxy_ng_repository_sync'),
        data={'repository': 'published'},
        user=admin_user,
        expect=202,
    )

    assert response.data['source'] == 'galaxy_ng'
    assert response.data['repository'] == 'published'
    assert response.data['base_path'] == 'published'
    assert response.data['task'] == 'sync-task-1'
    assert get_mock.call_args.args[0] == 'https://hub.example.test/api/galaxy/pulp/api/v3/distributions/ansible/ansible/'
    assert get_mock.call_args.kwargs['params'] == {'base_path': 'published', 'limit': 1}
    assert post_mock.call_args.args[0] == 'https://hub.example.test/api/galaxy/content/published/v3/sync/'
    assert post_mock.call_args.kwargs['json'] == {}
    assert post_mock.call_args.kwargs['headers']['Authorization'] == 'Bearer hub-token'


@pytest.mark.django_db
@override_settings(MODULE_GALAXY_NG_ENABLED=True, GALAXY_NG_SERVER_URL='https://hub.example.test')
def test_galaxy_ng_repository_sync_requires_system_admin(post, rando):
    post(reverse('api:galaxy_ng_repository_sync'), data={'repository': 'published'}, user=rando, expect=403)


@pytest.mark.django_db
@override_settings(MODULE_GALAXY_NG_ENABLED=True, GALAXY_NG_SERVER_URL='https://hub.example.test')
def test_galaxy_ng_repository_sync_rejects_unsafe_distribution_path(post, admin_user):
    response = post(
        reverse('api:galaxy_ng_repository_sync'),
        data={'repository': '../published'},
        user=admin_user,
        expect=400,
    )

    assert response.data['status'] == 'bad_request'


@pytest.mark.django_db
def test_galaxy_ng_execution_environment_image_build_plan_handles_awx_project_source(post, admin_user, organization, tmp_path):
    project_root = tmp_path / 'ee-project'
    source_dir = project_root / 'ee'
    source_dir.mkdir(parents=True)
    (source_dir / 'execution-environment.yml').write_text('version: 3\n', encoding='utf-8')
    project = Project.objects.create(name='EE Project', organization=organization, scm_type='', local_path='ee-project')

    with override_settings(
        MODULE_GALAXY_NG_ENABLED=True,
        GALAXY_NG_SERVER_URL='http://host.docker.internal:5001',
        GALAXY_NG_VERIFY_SSL=False,
        PROJECTS_ROOT=str(tmp_path),
    ):
        response = post(
            reverse('api:galaxy_ng_execution_environment_image_build_plan'),
            data={
                'project_id': project.pk,
                'image_name': 'awx/custom-ee',
                'tag': 'v1',
                'runtime': 'podman',
                'definition_file': 'ee/execution-environment.yml',
                'context': 'ee',
            },
            user=admin_user,
            expect=200,
        )

    assert response.data['project']['project_id'] == project.pk
    assert response.data['project']['project_name'] == 'EE Project'
    assert response.data['project']['project_path'] == str(project_root)
    assert response.data['project']['definition_file'] == 'ee/execution-environment.yml'
    assert response.data['project']['context'] == 'ee'
    assert response.data['registry']['controller'] == 'host.docker.internal:5001'
    assert response.data['registry']['local'] == 'localhost:5001'
    assert response.data['registry']['insecure'] is True
    assert response.data['image']['local'] == 'awx/custom-ee:v1'
    assert response.data['image']['push'] == 'localhost:5001/awx/custom-ee:v1'
    assert response.data['image']['awx'] == 'host.docker.internal:5001/awx/custom-ee:v1'
    assert response.data['commands'][0]['command'] == (
        f'cd {project_root} && ansible-builder build --container-runtime podman -f ee/execution-environment.yml -t awx/custom-ee:v1 ee'
    )
    assert response.data['commands'][0]['working_directory'] == str(project_root)
    assert response.data['commands'][1]['command'] == 'podman login --tls-verify=false localhost:5001'
    assert response.data['commands'][3]['command'] == 'podman push --tls-verify=false localhost:5001/awx/custom-ee:v1'
    assert response.data['awx_execution_environment'] == {
        'image': 'host.docker.internal:5001/awx/custom-ee:v1',
        'pull': 'missing',
    }


@pytest.mark.django_db
@override_settings(MODULE_GALAXY_NG_ENABLED=True, GALAXY_NG_SERVER_URL='https://hub.example.test')
def test_galaxy_ng_execution_environment_image_build_plan_requires_project(post, admin_user):
    response = post(
        reverse('api:galaxy_ng_execution_environment_image_build_plan'),
        data={'image_name': 'custom-ee', 'tag': 'latest'},
        user=admin_user,
        expect=400,
    )

    assert response.data['status'] == 'bad_request'
    assert 'Project' in response.data['detail']


@pytest.mark.django_db
def test_galaxy_ng_execution_environment_image_build_plan_rejects_bad_image(post, admin_user, organization, tmp_path):
    project_root = tmp_path / 'ee-project'
    project_root.mkdir()
    (project_root / 'execution-environment.yml').write_text('version: 3\n', encoding='utf-8')
    project = Project.objects.create(name='EE Project', organization=organization, scm_type='', local_path='ee-project')

    with override_settings(MODULE_GALAXY_NG_ENABLED=True, GALAXY_NG_SERVER_URL='https://hub.example.test', PROJECTS_ROOT=str(tmp_path)):
        response = post(
            reverse('api:galaxy_ng_execution_environment_image_build_plan'),
            data={'project_id': project.pk, 'image_name': '../bad', 'tag': 'latest'},
            user=admin_user,
            expect=400,
        )

    assert response.data['status'] == 'bad_request'


@pytest.mark.django_db
def test_galaxy_ng_execution_environment_image_build_plan_rejects_unsynced_project(post, admin_user, organization, tmp_path):
    project = Project.objects.create(name='EE Project', organization=organization, scm_type='', local_path='missing-ee-project')

    with override_settings(MODULE_GALAXY_NG_ENABLED=True, GALAXY_NG_SERVER_URL='https://hub.example.test', PROJECTS_ROOT=str(tmp_path)):
        response = post(
            reverse('api:galaxy_ng_execution_environment_image_build_plan'),
            data={'project_id': project.pk, 'image_name': 'custom-ee', 'tag': 'latest'},
            user=admin_user,
            expect=400,
        )

    assert response.data['status'] == 'bad_request'
    assert 'synced' in response.data['detail']


@pytest.mark.django_db
def test_galaxy_ng_execution_environment_image_build_plan_rejects_definition_outside_project(post, admin_user, organization, tmp_path):
    project_root = tmp_path / 'ee-project'
    project_root.mkdir()
    (project_root / 'execution-environment.yml').write_text('version: 3\n', encoding='utf-8')
    project = Project.objects.create(name='EE Project', organization=organization, scm_type='', local_path='ee-project')

    with override_settings(MODULE_GALAXY_NG_ENABLED=True, GALAXY_NG_SERVER_URL='https://hub.example.test', PROJECTS_ROOT=str(tmp_path)):
        response = post(
            reverse('api:galaxy_ng_execution_environment_image_build_plan'),
            data={'project_id': project.pk, 'image_name': 'custom-ee', 'definition_file': '../execution-environment.yml'},
            user=admin_user,
            expect=400,
        )

    assert response.data['status'] == 'bad_request'
    assert 'relative to the selected AWX project' in response.data['detail']


@pytest.mark.django_db
def test_galaxy_ng_execution_environment_image_build_plan_rejects_missing_definition(post, admin_user, organization, tmp_path):
    project_root = tmp_path / 'ee-project'
    project_root.mkdir()
    project = Project.objects.create(name='EE Project', organization=organization, scm_type='', local_path='ee-project')

    with override_settings(MODULE_GALAXY_NG_ENABLED=True, GALAXY_NG_SERVER_URL='https://hub.example.test', PROJECTS_ROOT=str(tmp_path)):
        response = post(
            reverse('api:galaxy_ng_execution_environment_image_build_plan'),
            data={'project_id': project.pk, 'image_name': 'custom-ee', 'definition_file': 'execution-environment.yml'},
            user=admin_user,
            expect=400,
        )

    assert response.data['status'] == 'bad_request'
    assert 'Definition file was not found' in response.data['detail']


@pytest.mark.django_db
def test_galaxy_ng_execution_environment_image_build_plan_denies_unreadable_project(post, rando, organization, tmp_path):
    project_root = tmp_path / 'ee-project'
    project_root.mkdir()
    (project_root / 'execution-environment.yml').write_text('version: 3\n', encoding='utf-8')
    project = Project.objects.create(name='EE Project', organization=organization, scm_type='', local_path='ee-project')

    with override_settings(MODULE_GALAXY_NG_ENABLED=True, GALAXY_NG_SERVER_URL='https://hub.example.test', PROJECTS_ROOT=str(tmp_path)):
        response = post(
            reverse('api:galaxy_ng_execution_environment_image_build_plan'),
            data={'project_id': project.pk, 'image_name': 'custom-ee'},
            user=rando,
            expect=400,
        )

    assert response.data['status'] == 'bad_request'
    assert 'not found' in response.data['detail']
