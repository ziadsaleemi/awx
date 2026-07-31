import json

import pytest

from awx.api.versioning import reverse
from awx.main.models.terraform import TerraformStateRevision


@pytest.mark.django_db
def test_terraform_launch_accepts_saved_survey_defaults(post, admin_user, terraform_job_template):
    terraform_job_template.ask_variables_on_launch = True
    terraform_job_template.survey_enabled = True
    terraform_job_template.survey_spec = {
        'name': 'Terraform survey',
        'description': '',
        'spec': [
            {
                'question_name': 'VM name',
                'variable': 'vm_name',
                'type': 'text',
                'required': True,
                'default': '',
            },
            {
                'question_name': 'CPU',
                'variable': 'cpu',
                'type': 'integer',
                'required': True,
                'default': '2',
            },
        ],
    }
    terraform_job_template.extra_vars = json.dumps({'vm_name': 'awx-demo-vsphere'})
    terraform_job_template.save()

    response = post(
        reverse('api:terraform_job_template_launch', kwargs={'pk': terraform_job_template.pk}),
        {},
        admin_user,
        expect=201,
    )

    assert response.data['id']


@pytest.mark.django_db
def test_managed_git_state_rejects_manual_project(
    patch,
    admin_user,
    manual_project,
    terraform_job_template,
):
    terraform_job_template.project = manual_project
    terraform_job_template.save(update_fields=['project'])

    response = patch(
        reverse(
            'api:terraform_job_template_detail',
            kwargs={'pk': terraform_job_template.pk},
        ),
        {'state_backend': 'git'},
        admin_user,
        expect=400,
    )

    assert 'state_project' in response.data


@pytest.mark.django_db
def test_managed_git_state_accepts_simple_state_key_placeholder(
    patch,
    admin_user,
    project,
    terraform_job_template,
):
    terraform_job_template.project = project
    terraform_job_template.save(update_fields=['project'])

    response = patch(
        reverse(
            'api:terraform_job_template_detail',
            kwargs={'pk': terraform_job_template.pk},
        ),
        {
            'state_backend': 'git',
            'state_project': project.pk,
            'state_key': 'organizations/{organization_id}/templates/{template_id}/{environment}',
        },
        admin_user,
        expect=200,
    )

    assert response.data['state_backend'] == 'git'
    assert response.data['state_key'].endswith('/{environment}')


@pytest.mark.django_db
def test_job_template_list_remains_valid_with_terraform_state_prefetch(get, admin_user):
    response = get(
        reverse('api:job_template_list'),
        admin_user,
        expect=200,
    )

    assert 'results' in response.data


@pytest.mark.django_db
def test_state_revision_endpoint_redacts_unexpected_values(
    get,
    admin_user,
    project,
    terraform_job_template,
):
    terraform_job_template.project = project
    terraform_job_template.save(update_fields=['project'])
    TerraformStateRevision.objects.create(
        terraform_job_template=terraform_job_template,
        state_project=project,
        state_key='production/web',
        state_branch='capstan-terraform-state',
        state_path='.capstan/terraform-state/example.tfstate.enc',
        git_commit='a' * 40,
        checksum='b' * 64,
        serial=3,
        lineage='lineage-1',
        terraform_version='1.12.2',
        resource_count=1,
        output_count=1,
        operation='apply',
        job_status='successful',
        summary={
            'format_version': 4,
            'serial': 3,
            'lineage': 'lineage-1',
            'terraform_version': '1.12.2',
            'resource_count': 1,
            'output_count': 1,
            'unexpected_secret': 'do-not-return',
            'resources': [
                {
                    'mode': 'managed',
                    'type': 'test_resource',
                    'name': 'example',
                    'provider': 'test',
                    'instance_count': 1,
                    'attributes': {'password': 'do-not-return'},
                }
            ],
            'outputs': [
                {
                    'name': 'password',
                    'sensitive': True,
                    'type': 'string',
                    'value': 'do-not-return',
                }
            ],
        },
    )

    response = get(
        reverse(
            'api:terraform_job_template_state_revisions_list',
            kwargs={'pk': terraform_job_template.pk},
        ),
        admin_user,
        expect=200,
    )

    assert response.data['count'] == 1
    summary = response.data['results'][0]['summary']
    assert 'do-not-return' not in str(summary)
    assert 'attributes' not in summary['resources'][0]
    assert 'value' not in summary['outputs'][0]
