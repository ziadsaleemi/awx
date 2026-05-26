import pytest

from awx.api.versioning import reverse
from awx.main.models import CatalogDeployment, CatalogItem, WorkflowJob, WorkflowJobTemplate


@pytest.mark.django_db
def test_catalog_item_deploy_survey_merges_live_workflow_survey(get, admin_user, workflow_job_template, organization):
    workflow_job_template.survey_enabled = True
    workflow_job_template.survey_spec = {
        'name': 'Catalog Provision Survey',
        'description': 'Provision options',
        'spec': [
            {
                'question_name': 'Hostname',
                'question_description': 'Desired hostname',
                'required': True,
                'type': 'text',
                'variable': 'vm_hostname',
                'default': 'catalog-vm',
            }
        ],
    }
    workflow_job_template.save(update_fields=['survey_enabled', 'survey_spec'])

    item = CatalogItem.objects.create(
        name='RHEL VM',
        organization=organization,
        provision_workflow=workflow_job_template,
        extra_vars_schema={
            'type': 'object',
            'properties': {
                'environment': {'type': 'string', 'enum': ['dev', 'test', 'prod']},
            },
        },
    )

    response = get(reverse('api:catalog_item_deploy_survey', kwargs={'pk': item.pk}), admin_user, expect=200)
    schema = response.data['schema']

    assert 'environment' in schema['properties']
    assert 'vm_hostname' in schema['properties']
    assert schema['properties']['vm_hostname']['default'] == 'catalog-vm'
    assert 'vm_hostname' in schema['required']


@pytest.mark.django_db
def test_catalog_item_deploy_survey_requires_use_permission(get, workflow_job_template, organization, rando):
    item = CatalogItem.objects.create(
        name='Ubuntu VM',
        organization=organization,
        provision_workflow=workflow_job_template,
    )

    get(reverse('api:catalog_item_deploy_survey', kwargs={'pk': item.pk}), rando, expect=403)


@pytest.mark.django_db
def test_catalog_deployment_retry_relaunches_failed_deployment(post, admin_user, organization, workflow_job_template):
    item = CatalogItem.objects.create(
        name='Oracle VM',
        organization=organization,
        provision_workflow=workflow_job_template,
        override_workflow_limit=True,
    )
    owner = admin_user

    deployment = CatalogDeployment.objects.create(
        name='oracle-dev-01',
        catalog_item=item,
        owner=owner,
        status='failed',
        extra_vars={'region': 'us-east-1'},
    )

    response = post(reverse('api:catalog_deployment_retry', kwargs={'pk': deployment.pk}), {}, owner, expect=200)

    deployment.refresh_from_db()
    assert response.data['status'] == 'provisioning'
    assert deployment.status == 'provisioning'
    assert deployment.provision_job_id is not None
    assert deployment.extra_vars['terraform_override_limit'] is True


@pytest.mark.django_db
def test_catalog_deployment_retry_rejects_non_failed_deployments(post, admin_user, organization, workflow_job_template):
    item = CatalogItem.objects.create(
        name='CentOS VM',
        organization=organization,
        provision_workflow=workflow_job_template,
    )

    deployment = CatalogDeployment.objects.create(
        name='centos-dev-01',
        catalog_item=item,
        owner=admin_user,
        status='active',
        extra_vars={},
    )

    post(reverse('api:catalog_deployment_retry', kwargs={'pk': deployment.pk}), {}, admin_user, expect=400)


@pytest.mark.django_db
def test_catalog_deployment_retry_resumes_from_last_failed_workflow(post, mocker, admin_user, organization, workflow_job_template):
    item = CatalogItem.objects.create(
        name='Resume VM',
        organization=organization,
        provision_workflow=workflow_job_template,
    )

    failed_workflow_job = workflow_job_template.create_unified_job()
    failed_workflow_job.status = 'failed'
    failed_workflow_job.save(update_fields=['status'])

    resumed_workflow_job = workflow_job_template.create_unified_job()
    resume_mock = mocker.patch.object(WorkflowJob, 'create_resume_workflow_job', return_value=resumed_workflow_job)
    signal_start_mock = mocker.patch.object(resumed_workflow_job, 'signal_start', return_value=None)

    deployment = CatalogDeployment.objects.create(
        name='resume-vm-01',
        catalog_item=item,
        owner=admin_user,
        status='failed',
        provision_job=failed_workflow_job,
        last_failed_workflow_job=failed_workflow_job,
        extra_vars={'region': 'us-east-1'},
    )

    post(reverse('api:catalog_deployment_retry', kwargs={'pk': deployment.pk}), {}, admin_user, expect=200)

    deployment.refresh_from_db()
    resume_mock.assert_called_once()
    signal_start_mock.assert_called_once_with()
    assert deployment.provision_job_id == resumed_workflow_job.id
    assert deployment.last_failed_workflow_job_id is None
    assert deployment.provisioning_history
    assert deployment.provisioning_history[-1]['details']['mode'] == 'resume'


@pytest.mark.django_db
def test_catalog_deprovision_passes_saved_vars(post, mocker, admin_user, organization, workflow_job_template):
    deprovision_workflow = workflow_job_template
    deprovision_workflow.name = 'Deprovision WF'
    deprovision_workflow.save(update_fields=['name'])

    item = CatalogItem.objects.create(
        name='Destroy VM',
        organization=organization,
        deprovision_workflow=deprovision_workflow,
    )

    deployment = CatalogDeployment.objects.create(
        name='destroy-vm-01',
        catalog_item=item,
        owner=admin_user,
        status='active',
        extra_vars={'vm_name': 'test-vm', 'vm_id': '1234'},
    )

    launched_job = deprovision_workflow.create_unified_job()
    captured_kwargs = {}

    def fake_create_unified_job(**kwargs):
        captured_kwargs.update(kwargs)
        return launched_job

    mocker.patch.object(WorkflowJobTemplate, 'create_unified_job', side_effect=fake_create_unified_job)
    mocker.patch.object(launched_job, 'signal_start', return_value=None)

    post(reverse('api:catalog_deployment_deprovision', kwargs={'pk': deployment.pk}), {}, admin_user, expect=200)

    deployment.refresh_from_db()
    assert captured_kwargs.get('extra_vars', {}).get('vm_name') == 'test-vm'
    assert captured_kwargs.get('extra_vars', {}).get('vm_id') == '1234'
    assert deployment.last_deprovision_vars.get('vm_name') == 'test-vm'
    assert deployment.provisioning_history
    assert deployment.provisioning_history[-1]['action'] == 'deprovision'
