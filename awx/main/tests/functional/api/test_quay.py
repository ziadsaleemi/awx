import pytest
from django.test import override_settings

from awx.api.versioning import reverse
from awx.main.models import Project


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
        f'cd {project_root} && ansible-builder build --container-runtime podman -f ee/execution-environment.yml -t quay.example.test/awx/custom-ee:v1 ee'
    )
    assert response.data['commands'][1]['command'] == ('echo "$QUAY_TOKEN" | podman login quay.example.test --username awx+robot --password-stdin')
    assert response.data['commands'][2]['command'] == 'podman push quay.example.test/awx/custom-ee:v1'
    assert response.data['awx_execution_environment'] == {
        'image': 'quay.example.test/awx/custom-ee:v1',
        'pull': 'missing',
    }


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
