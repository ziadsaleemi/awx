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
    assert response.data['api_browser_url'] == 'https://hub.example.test/api/galaxy/v3/swagger-ui/'
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
@override_settings(
    MODULE_GALAXY_NG_ENABLED=True,
    GALAXY_NG_SERVER_URL='https://hub.example.test',
    GALAXY_NG_AUTH_TOKEN='hub-token',
)
def test_galaxy_ng_status_caches_live_counts(get, admin_user, mocker):
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

    first_response = get(reverse('api:galaxy_ng_status'), user=admin_user, expect=200)
    second_response = get(reverse('api:galaxy_ng_status'), user=admin_user, expect=200)

    assert first_response.data['counts']['collections'] == 5
    assert second_response.data['counts']['collections'] == 5
    assert request_mock.call_count == 9


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

    response = get(reverse('api:galaxy_ng_tasks_list') + '?page=2&page_size=10&order_by=-name&name__icontains=import&refresh=1', user=admin_user, expect=200)

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
def test_galaxy_ng_execution_environment_images_list_hands_off_to_quay(get, admin_user, mocker):
    request_mock = mocker.patch('awx.main.utils.galaxy_ng.requests.get')

    response = get(reverse('api:galaxy_ng_execution_environment_images_list'), user=admin_user, expect=410)

    assert response.data['count'] == 0
    assert response.data['source'] == 'quay'
    assert response.data['resource'] == 'execution-environment-images'
    assert response.data['results'] == []
    assert response.data['quay_build_plan_url'].endswith('/api/v2/quay/execution-environment-images/build-plan/')
    assert request_mock.call_count == 0


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
def test_galaxy_ng_collection_import_plan_handles_awx_project_source(post, admin_user, organization, tmp_path):
    project_root = tmp_path / 'collection-project'
    source_dir = project_root / 'collections' / 'infra' / 'network'
    source_dir.mkdir(parents=True)
    (source_dir / 'galaxy.yml').write_text(
        'namespace: infra\nname: network\nversion: 1.2.3\ndescription: Network automation content\n',
        encoding='utf-8',
    )
    project = Project.objects.create(name='Collection Project', organization=organization, scm_type='', local_path='collection-project')

    with override_settings(
        MODULE_GALAXY_NG_ENABLED=True,
        GALAXY_NG_SERVER_URL='http://host.docker.internal:5001',
        GALAXY_NG_VERIFY_SSL=False,
        GALAXY_NG_AUTH_TOKEN='hub-token',
        PROJECTS_ROOT=str(tmp_path),
    ):
        response = post(
            reverse('api:galaxy_ng_collection_import_plan'),
            data={
                'project_id': project.pk,
                'collection_path': 'collections/infra/network',
                'artifact_dir': 'dist',
            },
            user=admin_user,
            expect=200,
        )

    assert response.data['source'] == 'galaxy_ng'
    assert response.data['project']['project_id'] == project.pk
    assert response.data['project']['project_name'] == 'Collection Project'
    assert response.data['project']['collection_root'] == str(source_dir)
    assert response.data['project']['artifact_path'] == str(source_dir / 'dist' / 'infra-network-1.2.3.tar.gz')
    assert response.data['hub']['api_root_url'] == 'http://host.docker.internal:5001/api/galaxy/'
    assert response.data['hub']['auth_configured'] is True
    assert response.data['collection'] == {
        'namespace': 'infra',
        'name': 'network',
        'version': '1.2.3',
        'fqcn': 'infra.network',
        'reference': 'infra.network:1.2.3',
        'artifact': str(source_dir / 'dist' / 'infra-network-1.2.3.tar.gz'),
    }
    assert response.data['commands'][0]['command'] == (f'cd {source_dir} && mkdir -p dist && ansible-galaxy collection build --output-path dist')
    assert response.data['commands'][1]['command'] == (
        f'ansible-galaxy collection publish {source_dir}/dist/infra-network-1.2.3.tar.gz '
        '--server http://host.docker.internal:5001/api/galaxy/ --api-key "$GALAXY_TOKEN" --ignore-certs'
    )
    assert response.data['commands'][2]['command'] == (
        'ansible-galaxy collection install infra.network:1.2.3 --server http://host.docker.internal:5001/api/galaxy/ --ignore-certs'
    )
    assert response.data['approval']['next_url'] == '/galaxy-ng/collection-approvals'


@pytest.mark.django_db
def test_galaxy_ng_collection_import_plan_allows_project_updater(post, rando, organization, tmp_path):
    project_root = tmp_path / 'collection-project'
    source_dir = project_root / 'collections' / 'infra' / 'network'
    source_dir.mkdir(parents=True)
    (source_dir / 'galaxy.yml').write_text(
        'namespace: infra\nname: network\nversion: 1.2.3\ndescription: Network automation content\n',
        encoding='utf-8',
    )
    project = Project.objects.create(name='Collection Project', organization=organization, scm_type='', local_path='collection-project')
    project.update_role.members.add(rando)

    with override_settings(
        MODULE_GALAXY_NG_ENABLED=True,
        GALAXY_NG_SERVER_URL='https://hub.example.test',
        GALAXY_NG_AUTH_TOKEN='hub-token',
        PROJECTS_ROOT=str(tmp_path),
    ):
        response = post(
            reverse('api:galaxy_ng_collection_import_plan'),
            data={
                'project_id': project.pk,
                'collection_path': 'collections/infra/network',
                'artifact_dir': 'dist',
            },
            user=rando,
            expect=200,
        )

    assert response.data['project']['project_id'] == project.pk
    assert response.data['collection']['reference'] == 'infra.network:1.2.3'


@pytest.mark.django_db
@override_settings(MODULE_GALAXY_NG_ENABLED=True, GALAXY_NG_SERVER_URL='https://hub.example.test')
def test_galaxy_ng_collection_import_plan_requires_hub_manage_permission(post, rando):
    post(
        reverse('api:galaxy_ng_collection_import_plan'),
        data={'project_id': 1, 'collection_path': '.', 'artifact_dir': 'dist'},
        user=rando,
        expect=403,
    )


@pytest.mark.django_db
def test_galaxy_ng_collection_import_plan_rejects_missing_galaxy_yml(post, admin_user, organization, tmp_path):
    project_root = tmp_path / 'collection-project'
    source_dir = project_root / 'collections' / 'infra' / 'network'
    source_dir.mkdir(parents=True)
    project = Project.objects.create(name='Collection Project', organization=organization, scm_type='', local_path='collection-project')

    with override_settings(MODULE_GALAXY_NG_ENABLED=True, GALAXY_NG_SERVER_URL='https://hub.example.test', PROJECTS_ROOT=str(tmp_path)):
        response = post(
            reverse('api:galaxy_ng_collection_import_plan'),
            data={'project_id': project.pk, 'collection_path': 'collections/infra/network', 'artifact_dir': 'dist'},
            user=admin_user,
            expect=400,
        )

    assert response.data['status'] == 'bad_request'
    assert 'galaxy.yml' in response.data['detail']


@pytest.mark.django_db
def test_galaxy_ng_collection_import_plan_rejects_path_traversal(post, admin_user, organization, tmp_path):
    project_root = tmp_path / 'collection-project'
    project_root.mkdir()
    project = Project.objects.create(name='Collection Project', organization=organization, scm_type='', local_path='collection-project')

    with override_settings(MODULE_GALAXY_NG_ENABLED=True, GALAXY_NG_SERVER_URL='https://hub.example.test', PROJECTS_ROOT=str(tmp_path)):
        response = post(
            reverse('api:galaxy_ng_collection_import_plan'),
            data={'project_id': project.pk, 'collection_path': '../outside', 'artifact_dir': 'dist'},
            user=admin_user,
            expect=400,
        )

    assert response.data['status'] == 'bad_request'
    assert 'relative to the selected AWX project' in response.data['detail']


@pytest.mark.django_db
@override_settings(MODULE_GALAXY_NG_ENABLED=True, GALAXY_NG_SERVER_URL='https://hub.example.test')
def test_galaxy_ng_resource_list_normalizes_galaxy_v3_payload(get, admin_user, mocker):
    request_mock = mocker.patch(
        'awx.main.utils.galaxy_ng.requests.get',
        side_effect=[
            galaxy_response(
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
            galaxy_response(
                mocker,
                {
                    'version': '1.2.3',
                    'created_at': '2026-07-04T20:09:36.612026Z',
                    'updated_at': '2026-07-04T20:09:36.626656Z',
                    'requires_ansible': '>=2.15.0',
                    'artifact': {'filename': 'infra-network-1.2.3.tar.gz', 'sha256': 'abc123', 'size': 5157},
                    'download_url': 'https://hub.example.test/api/galaxy/v3/artifacts/infra-network-1.2.3.tar.gz',
                    'namespace': {'name': 'infra'},
                    'signatures': [],
                    'metadata': {
                        'authors': ['Automation Team'],
                        'contents': [
                            {'name': 'router', 'content_type': 'module'},
                            {'name': 'switch', 'content_type': 'role'},
                            {'name': 'validate.yml', 'content_type': 'playbook'},
                        ],
                        'dependencies': {'ansible.netcommon': '>=5.0.0'},
                        'description': 'Network automation content',
                        'homepage': 'https://example.test/network',
                        'issues': 'https://example.test/network/issues',
                        'license': ['MIT'],
                        'repository': 'https://example.test/network.git',
                        'tags': ['network'],
                    },
                },
            ),
        ],
    )

    response = get(reverse('api:galaxy_ng_collections_list'), user=admin_user, expect=200)

    assert response.data['count'] == 1
    assert response.data['results'][0]['namespace'] == 'infra'
    assert response.data['results'][0]['name'] == 'network'
    assert isinstance(response.data['results'][0]['id'], int)
    assert response.data['results'][0]['version'] == '1.2.3'
    assert response.data['results'][0]['requires_ansible'] == '>=2.15.0'
    assert response.data['results'][0]['metadata']['description'] == 'Network automation content'
    assert response.data['results'][0]['contents'][2]['content_type'] == 'playbook'
    assert response.data['results'][0]['dependencies'] == {'ansible.netcommon': '>=5.0.0'}
    assert response.data['results'][0]['sign_state'] == 'unsigned'
    assert response.data['results'][0]['artifact']['filename'] == 'infra-network-1.2.3.tar.gz'
    assert response.data['results'][0]['download_url'].endswith('/infra-network-1.2.3.tar.gz')
    assert request_mock.call_args_list[1].args[0] == (
        'https://hub.example.test/api/galaxy/v3/plugin/ansible/content/published/collections/index/infra/network/versions/1.2.3/'
    )


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
@override_settings(MODULE_GALAXY_NG_ENABLED=True, GALAXY_NG_SERVER_URL='https://hub.example.test')
def test_galaxy_ng_execution_environment_image_build_plan_hands_off_to_quay(post, admin_user):
    response = post(
        reverse('api:galaxy_ng_execution_environment_image_build_plan'),
        data={'image_name': 'custom-ee', 'tag': 'latest'},
        user=admin_user,
        expect=410,
    )

    assert response.data['status'] == 'moved_to_quay'
    assert response.data['source'] == 'quay'
    assert response.data['quay_build_plan_url'].endswith('/api/v2/quay/execution-environment-images/build-plan/')
