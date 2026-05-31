import pytest

from ansible_base.rbac.models import RoleDefinition, RoleUserAssignment

from awx.api.versioning import reverse
from awx.main.access import CatalogItemAccess
from awx.main.models import ActivityStream, CatalogDeployment, CatalogItem, Organization, User, WorkflowJob, WorkflowJobTemplate
from awx.main.models.terraform import TerraformJobTemplate


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
def test_catalog_item_deploy_survey_includes_name_template_variables(get, admin_user, workflow_job_template, organization):
    item = CatalogItem.objects.create(
        name='Template vars VM',
        organization=organization,
        provision_workflow=workflow_job_template,
        name_template='{vmnam} deployment',
        extra_vars_schema={'type': 'object', 'properties': {}},
    )

    response = get(reverse('api:catalog_item_deploy_survey', kwargs={'pk': item.pk}), admin_user, expect=200)
    schema = response.data['schema']

    assert 'vmnam' in schema['properties']
    assert schema['properties']['vmnam']['type'] == 'string'
    assert 'user_org_name' not in schema['properties']


@pytest.mark.django_db
def test_catalog_item_deploy_survey_includes_dynamic_field(get, admin_user, workflow_job_template, organization):
    item = CatalogItem.objects.create(
        name='Dynamic field VM',
        organization=organization,
        provision_workflow=workflow_job_template,
        dynamic_name_field='vmnam',
        extra_vars_schema={'type': 'object', 'properties': {}},
    )

    response = get(reverse('api:catalog_item_deploy_survey', kwargs={'pk': item.pk}), admin_user, expect=200)
    schema = response.data['schema']

    assert 'vmnam' in schema['properties']
    assert schema['properties']['vmnam']['type'] == 'string'
    assert 'default' not in schema['properties']['vmnam']


@pytest.mark.django_db
def test_catalog_item_deploy_survey_includes_multiple_dynamic_fields(get, admin_user, workflow_job_template, organization):
    item = CatalogItem.objects.create(
        name='Dynamic fields VM',
        organization=organization,
        provision_workflow=workflow_job_template,
        dynamic_name_field='vmnam, environment, vmnam',
        extra_vars_schema={'type': 'object', 'properties': {}},
    )

    response = get(reverse('api:catalog_item_deploy_survey', kwargs={'pk': item.pk}), admin_user, expect=200)
    schema = response.data['schema']

    assert 'vmnam' in schema['properties']
    assert 'environment' in schema['properties']


@pytest.mark.django_db
def test_catalog_item_deploy_survey_applies_dynamic_field_template_defaults(get, admin_user, workflow_job_template, organization):
    item = CatalogItem.objects.create(
        name='Dynamic field defaults VM',
        organization=organization,
        provision_workflow=workflow_job_template,
        dynamic_name_field='vmnam, environment',
        dynamic_field_templates={'vmnam': '{vm_name}-{env}', 'environment': 'prod'},
        extra_vars_schema={'type': 'object', 'properties': {}},
    )

    response = get(reverse('api:catalog_item_deploy_survey', kwargs={'pk': item.pk}), admin_user, expect=200)
    schema = response.data['schema']

    assert schema['properties']['vmnam']['default'] == '{vm_name}-{env}'
    assert schema['properties']['environment']['default'] == 'prod'


@pytest.mark.django_db
def test_catalog_item_deploy_survey_requires_use_permission(get, workflow_job_template, organization, rando):
    item = CatalogItem.objects.create(
        name='Ubuntu VM',
        organization=organization,
        provision_workflow=workflow_job_template,
    )

    get(reverse('api:catalog_item_deploy_survey', kwargs={'pk': item.pk}), rando, expect=403)


@pytest.mark.django_db
def test_catalog_item_direct_use_role_grants_endpoint_access_and_syncs_rbac(get, workflow_job_template, organization, rando, setup_managed_roles):
    item = CatalogItem.objects.create(
        name='Direct Use Role VM',
        organization=organization,
        provision_workflow=workflow_job_template,
    )

    get(reverse('api:catalog_item_deploy_survey', kwargs={'pk': item.pk}), rando, expect=403)
    assert not CatalogItemAccess(rando).can_use(item)

    item.use_role.members.add(rando)

    get(reverse('api:catalog_item_deploy_survey', kwargs={'pk': item.pk}), rando, expect=200)
    assert CatalogItemAccess(rando).can_use(item)

    role_definition = RoleDefinition.objects.get(name='CatalogItem Use')
    assert RoleUserAssignment.objects.filter(
        user=rando,
        role_definition=role_definition,
        object_id=item.pk,
    ).exists()
    assert ActivityStream.objects.filter(
        catalog_item=item,
        role=item.use_role,
        user=rando,
        operation='associate',
    ).exists()


@pytest.mark.django_db
def test_catalog_item_list_is_scoped_to_org_admin(get, org_admin, organization):
    other_org = Organization.objects.create(name='other-org')
    own_item = CatalogItem.objects.create(name='Own Org VM', organization=organization)
    CatalogItem.objects.create(name='Other Org VM', organization=other_org)

    response = get(reverse('api:catalog_item_list'), org_admin, expect=200)

    item_ids = {item['id'] for item in response.data['results']}
    assert own_item.pk in item_ids
    assert not CatalogItem.objects.filter(pk__in=item_ids, organization=other_org).exists()


@pytest.mark.django_db
def test_default_catalog_user_signal_does_not_cross_org_boundaries(organization):
    other_org = Organization.objects.create(name='other-org')

    user = User.objects.create(username='new-multi-org-user')

    assert user not in organization.member_role
    assert user not in other_org.member_role


@pytest.mark.django_db
def test_catalog_deployment_list_is_scoped_to_org_admin(get, org_admin, organization):
    other_org = Organization.objects.create(name='other-org')
    own_item = CatalogItem.objects.create(name='Own Org VM', organization=organization)
    other_item = CatalogItem.objects.create(name='Other Org VM', organization=other_org)
    own_deployment = CatalogDeployment.objects.create(
        name='own-deployment',
        catalog_item=own_item,
        owner=org_admin,
        status='active',
    )
    CatalogDeployment.objects.create(
        name='other-deployment',
        catalog_item=other_item,
        owner=org_admin,
        status='active',
    )

    response = get(reverse('api:catalog_deployment_list'), org_admin, expect=200)

    deployment_ids = {deployment['id'] for deployment in response.data['results']}
    assert own_deployment.pk in deployment_ids
    assert not CatalogDeployment.objects.filter(pk__in=deployment_ids, catalog_item__organization=other_org).exists()


@pytest.mark.django_db
def test_catalog_item_deploy_rejects_cross_org_provider_tft(post, org_admin, organization):
    other_org = Organization.objects.create(name='other-org')
    foreign_tft = TerraformJobTemplate.objects.create(name='Other Org Terraform', organization=other_org)
    item = CatalogItem.objects.create(
        name='Isolated DigitalOcean VM',
        organization=organization,
        cloud_backends={'digitalocean': foreign_tft.pk},
    )

    response = post(
        reverse('api:catalog_item_deploy', kwargs={'pk': item.pk}),
        {'target_provider': 'digitalocean'},
        org_admin,
        expect=400,
    )

    assert 'cloud_backends' in response.data
    assert not CatalogDeployment.objects.filter(catalog_item=item).exists()


@pytest.mark.django_db
def test_catalog_item_deploy_rejects_cross_org_provider_workflow(post, org_admin, organization):
    other_org = Organization.objects.create(name='other-org')
    foreign_workflow = WorkflowJobTemplate.objects.create(name='Other Org Workflow', organization=other_org)
    item = CatalogItem.objects.create(
        name='Isolated Workflow VM',
        organization=organization,
        provider_workflows={'digitalocean': foreign_workflow.pk},
    )

    response = post(
        reverse('api:catalog_item_deploy', kwargs={'pk': item.pk}),
        {'target_provider': 'digitalocean'},
        org_admin,
        expect=400,
    )

    assert 'provider_workflows' in response.data
    assert not CatalogDeployment.objects.filter(catalog_item=item).exists()


@pytest.mark.django_db
def test_catalog_deployment_deprovision_rejects_cross_org_provider_workflow(post, org_admin, organization):
    other_org = Organization.objects.create(name='other-org')
    foreign_workflow = WorkflowJobTemplate.objects.create(name='Other Org Deprovision', organization=other_org)
    item = CatalogItem.objects.create(
        name='Isolated Deprovision VM',
        organization=organization,
        provider_deprovision_workflows={'digitalocean': foreign_workflow.pk},
    )
    deployment = CatalogDeployment.objects.create(
        name='isolated-vm',
        catalog_item=item,
        owner=org_admin,
        status='active',
        target_provider='digitalocean',
    )

    response = post(
        reverse('api:catalog_deployment_deprovision', kwargs={'pk': deployment.pk}),
        {},
        org_admin,
        expect=400,
    )

    assert 'provider_deprovision_workflows' in response.data
    deployment.refresh_from_db()
    assert deployment.status == 'active'
    assert deployment.deprovision_job_id is None


@pytest.mark.django_db
def test_catalog_deployment_retry_rejects_cross_org_tft(post, org_admin, organization):
    other_org = Organization.objects.create(name='other-org')
    foreign_tft = TerraformJobTemplate.objects.create(name='Other Org Terraform', organization=other_org)
    item = CatalogItem.objects.create(
        name='Isolated Retry VM',
        organization=organization,
        terraform_job_template=foreign_tft,
    )
    deployment = CatalogDeployment.objects.create(
        name='retry-vm',
        catalog_item=item,
        owner=org_admin,
        status='failed',
        extra_vars={},
    )

    response = post(
        reverse('api:catalog_deployment_retry', kwargs={'pk': deployment.pk}),
        {},
        org_admin,
        expect=400,
    )

    assert 'terraform_job_template' in response.data
    deployment.refresh_from_db()
    assert deployment.status == 'failed'
    assert deployment.terraform_provision_job_id is None


@pytest.mark.django_db
def test_catalog_deployment_cancel_allows_owner(post, org_auditor, organization):
    item = CatalogItem.objects.create(name='Cancelable Owner VM', organization=organization)
    deployment = CatalogDeployment.objects.create(
        name='owner-cancel-vm',
        catalog_item=item,
        owner=org_auditor,
        status='provisioning',
    )

    response = post(
        reverse('api:catalog_deployment_cancel', kwargs={'pk': deployment.pk}),
        {},
        org_auditor,
        expect=200,
    )

    deployment.refresh_from_db()
    assert response.data['status'] == 'failed'
    assert deployment.status == 'failed'
    assert deployment.provisioning_history[-1]['action'] == 'cancel'
    assert deployment.provisioning_history[-1]['details']['canceled_by'] == org_auditor.username


@pytest.mark.django_db
def test_catalog_deployment_cancel_allows_org_admin(post, org_admin, rando, organization):
    item = CatalogItem.objects.create(name='Cancelable Admin VM', organization=organization)
    deployment = CatalogDeployment.objects.create(
        name='admin-cancel-vm',
        catalog_item=item,
        owner=rando,
        status='deprovisioning',
    )

    response = post(reverse('api:catalog_deployment_cancel', kwargs={'pk': deployment.pk}), {}, org_admin, expect=200)

    deployment.refresh_from_db()
    assert response.data['status'] == 'active'
    assert deployment.status == 'active'
    assert deployment.provisioning_history[-1]['details']['canceled_by'] == org_admin.username


@pytest.mark.django_db
def test_catalog_deployment_cancel_rejects_foreign_org_admin(post, org_admin, rando):
    other_org = Organization.objects.create(name='other-org')
    foreign_item = CatalogItem.objects.create(name='Foreign Cancel VM', organization=other_org)
    deployment = CatalogDeployment.objects.create(
        name='foreign-cancel-vm',
        catalog_item=foreign_item,
        owner=rando,
        status='provisioning',
    )

    post(reverse('api:catalog_deployment_cancel', kwargs={'pk': deployment.pk}), {}, org_admin, expect=403)

    deployment.refresh_from_db()
    assert deployment.status == 'provisioning'
    assert deployment.provisioning_history == []


@pytest.mark.django_db
def test_catalog_deployment_cancel_rejects_forged_catalog_item_permission(post, org_admin, rando, organization):
    other_org = Organization.objects.create(name='other-forged-org')
    accessible_item = CatalogItem.objects.create(name='Accessible Cancel VM', organization=organization)
    inaccessible_item = CatalogItem.objects.create(name='Inaccessible Cancel VM', organization=other_org)
    deployment = CatalogDeployment.objects.create(
        name='forged-cancel-vm',
        catalog_item=inaccessible_item,
        owner=rando,
        status='provisioning',
    )

    post(
        reverse('api:catalog_deployment_cancel', kwargs={'pk': deployment.pk}),
        {'catalog_item': accessible_item.pk},
        org_admin,
        expect=403,
    )

    deployment.refresh_from_db()
    assert deployment.status == 'provisioning'
    assert deployment.provisioning_history == []


@pytest.mark.django_db
def test_catalog_item_edit_persists_organization(patch, admin_user, organization, workflow_job_template):
    item = CatalogItem.objects.create(
        name='Org VM',
        organization=organization,
        provision_workflow=workflow_job_template,
        name_template='a{user_org_name}bac+1',
    )
    new_organization = Organization.objects.create(name='Updated Org')

    patch(
        reverse('api:catalog_item_detail', kwargs={'pk': item.pk}),
        {
            'organization': new_organization.id,
            'name_template': 'a{user_org_name}bac+1',
            'dynamic_name_field': 'vmnam',
            'dynamic_field_templates': {'vmnam': '{vm_name}-{env}'},
            'deploy_disabled_fields': ['vmnam'],
            'deploy_hidden_fields': ['vmnam'],
        },
        admin_user,
        expect=200,
    )

    item.refresh_from_db()
    assert item.organization_id == new_organization.id
    assert item.name_template == 'a{user_org_name}bac+1'
    assert item.dynamic_name_field == 'vmnam'
    assert item.dynamic_field_templates == {'vmnam': '{vm_name}-{env}'}
    assert item.deploy_disabled_fields == ['vmnam']
    assert item.deploy_hidden_fields == ['vmnam']


@pytest.mark.django_db
def test_marketplace_ingest_creates_org_scoped_catalog_item(post, org_admin, organization):
    response = post(
        reverse('api:marketplace_template_ingest'),
        {
            'provider': 'digitalocean',
            'template_id': 'do-ubuntu-22-04-x64',
            'organization': organization.pk,
            'name': 'Team Ubuntu VM',
        },
        org_admin,
        expect=201,
    )

    item = CatalogItem.objects.get(pk=response.data['id'])
    assert item.name == 'Team Ubuntu VM'
    assert item.organization_id == organization.pk
    assert item.available_providers == ['digitalocean']
    assert item.cloud_backends == {'digitalocean': None}


@pytest.mark.django_db
def test_marketplace_ingest_rejects_foreign_organization(post, org_admin, organization):
    other_org = Organization.objects.create(name='other-org')

    response = post(
        reverse('api:marketplace_template_ingest'),
        {
            'provider': 'digitalocean',
            'template_id': 'do-ubuntu-22-04-x64',
            'organization': other_org.pk,
        },
        org_admin,
        expect=403,
    )

    assert 'organization' in response.data
    assert not CatalogItem.objects.filter(organization=other_org, name='Ubuntu 22.04 LTS (x64)').exists()
    assert not CatalogItem.objects.filter(organization__isnull=True, name='Ubuntu 22.04 LTS (x64)').exists()


@pytest.mark.django_db
def test_marketplace_ingest_rejects_cross_org_workflow(post, org_admin, organization):
    other_org = Organization.objects.create(name='other-org')
    foreign_workflow = WorkflowJobTemplate.objects.create(name='Other Org Marketplace Workflow', organization=other_org)

    response = post(
        reverse('api:marketplace_template_ingest'),
        {
            'provider': 'digitalocean',
            'template_id': 'do-ubuntu-22-04-x64',
            'organization': organization.pk,
            'provision_workflow': foreign_workflow.pk,
        },
        org_admin,
        expect=400,
    )

    assert 'provision_workflow' in response.data
    assert not CatalogItem.objects.filter(organization=organization, name='Ubuntu 22.04 LTS (x64)').exists()


@pytest.mark.django_db
def test_marketplace_ingest_rejects_non_admin(post, rando, organization):
    response = post(
        reverse('api:marketplace_template_ingest'),
        {
            'provider': 'digitalocean',
            'template_id': 'do-ubuntu-22-04-x64',
            'organization': organization.pk,
        },
        rando,
        expect=403,
    )

    assert 'organization' in response.data
    assert not CatalogItem.objects.filter(name='Ubuntu 22.04 LTS (x64)').exists()


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
def test_catalog_deployment_auto_generates_name(post, admin_user, organization, workflow_job_template):
    item = CatalogItem.objects.create(
        name='Auto Name VM',
        organization=organization,
        provision_workflow=workflow_job_template,
        name_template='a{user_org_name}bac+1',
    )
    item.organization.name = 'MNS'
    item.organization.save(update_fields=['name'])
    CatalogDeployment.objects.create(
        name='amnsbac1',
        catalog_item=item,
        owner=admin_user,
        status='active',
        extra_vars={},
    )

    response = post(
        reverse('api:catalog_item_deploy', kwargs={'pk': item.pk}),
        {'name': '', 'extra_vars': {}},
        admin_user,
        expect=201,
    )

    assert response.data['name'] == 'amnsbac2'
    assert CatalogDeployment.objects.filter(catalog_item=item, name='amnsbac2').exists()


@pytest.mark.django_db
def test_catalog_deployment_expands_variables_in_submitted_name(post, admin_user, organization, workflow_job_template):
    item = CatalogItem.objects.create(
        name='Dynamic Name VM',
        organization=organization,
        provision_workflow=workflow_job_template,
    )

    response = post(
        reverse('api:catalog_item_deploy', kwargs={'pk': item.pk}),
        {'name': '{vmnam} deployment', 'extra_vars': {'vmnam': 'web-01'}},
        admin_user,
        expect=201,
    )

    assert response.data['name'] == 'web01 deployment'
    assert CatalogDeployment.objects.filter(catalog_item=item, name='web01 deployment').exists()


@pytest.mark.django_db
def test_catalog_deployment_uses_dynamic_source_field_when_template_empty(post, admin_user, organization, workflow_job_template):
    item = CatalogItem.objects.create(
        name='Dynamic field deploy',
        organization=organization,
        provision_workflow=workflow_job_template,
        dynamic_name_field='vmnam',
        name_template='',
    )

    response = post(
        reverse('api:catalog_item_deploy', kwargs={'pk': item.pk}),
        {'name': '', 'extra_vars': {'vmnam': 'web-01'}},
        admin_user,
        expect=201,
    )

    deployment = CatalogDeployment.objects.get(pk=response.data['id'])
    assert response.data['name'] == 'web01 deployment'
    assert deployment.extra_vars.get('vmnam') == 'web-01'


@pytest.mark.django_db
def test_catalog_deployment_uses_first_dynamic_field_when_template_empty(post, admin_user, organization, workflow_job_template):
    item = CatalogItem.objects.create(
        name='Dynamic fields deploy',
        organization=organization,
        provision_workflow=workflow_job_template,
        dynamic_name_field='vmnam,environment',
        name_template='',
    )

    response = post(
        reverse('api:catalog_item_deploy', kwargs={'pk': item.pk}),
        {'name': '', 'extra_vars': {'vmnam': 'web-02', 'environment': 'prod'}},
        admin_user,
        expect=201,
    )

    assert response.data['name'] == 'web02 deployment'


@pytest.mark.django_db
def test_catalog_deployment_persists_effective_workflow_extra_vars(post, mocker, admin_user, organization, workflow_job_template):
    item = CatalogItem.objects.create(
        name='Persist Effective Vars',
        organization=organization,
        provision_workflow=workflow_job_template,
    )

    launched_job = workflow_job_template.create_unified_job()
    launched_job.extra_vars = '{"vm_name": "awx-apache-vm-01", ' '"proxmox_template_name": "ubuntu-24-04-cloud-template-qga", ' '"cpu": 2, "ram": 2048}'

    def fake_create_unified_job(**kwargs):
        return launched_job

    mocker.patch.object(WorkflowJobTemplate, 'create_unified_job', side_effect=fake_create_unified_job)
    mocker.patch.object(launched_job, 'signal_start', return_value=None)

    response = post(
        reverse('api:catalog_item_deploy', kwargs={'pk': item.pk}),
        {'name': '', 'extra_vars': {'cpu': 2, 'ram': 2048}},
        admin_user,
        expect=201,
    )

    deployment = CatalogDeployment.objects.get(pk=response.data['id'])
    assert deployment.extra_vars['cpu'] == 2
    assert deployment.extra_vars['ram'] == 2048
    assert deployment.extra_vars['vm_name'] == 'awx-apache-vm-01'
    assert deployment.extra_vars['proxmox_template_name'] == 'ubuntu-24-04-cloud-template-qga'


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


@pytest.mark.django_db
def test_catalog_lifecycle_runs_configure_and_validate_after_workflow_success(mocker, admin_user, organization):
    provision_workflow = WorkflowJobTemplate.objects.create(name='Provision lifecycle VM', organization=organization)
    configure_workflow = WorkflowJobTemplate.objects.create(
        name='Configure lifecycle VM',
        organization=organization,
        ask_variables_on_launch=True,
    )
    validate_workflow = WorkflowJobTemplate.objects.create(
        name='Validate lifecycle VM',
        organization=organization,
        ask_variables_on_launch=True,
    )
    item = CatalogItem.objects.create(
        name='Lifecycle VM',
        organization=organization,
        provision_workflow=provision_workflow,
        configure_workflow=configure_workflow,
        validate_workflow=validate_workflow,
    )
    provision_job = provision_workflow.create_unified_job()
    deployment = CatalogDeployment.objects.create(
        name='lifecycle-vm-01',
        catalog_item=item,
        owner=admin_user,
        status='provisioning',
        provision_job=provision_job,
        extra_vars={'vm_name': 'lifecycle-vm-01'},
    )
    deployment.append_history_entry('provision', job=provision_job, status='running')
    deployment.save(update_fields=['provisioning_history'])

    signal_start = mocker.patch.object(WorkflowJob, 'signal_start', return_value=None)

    provision_job.status = 'successful'
    provision_job.save(update_fields=['status'])

    deployment.refresh_from_db()
    assert deployment.status == 'configuring'
    assert deployment.configure_job_id is not None
    assert deployment.configure_job.extra_vars_dict['vm_name'] == 'lifecycle-vm-01'
    assert deployment.provisioning_history[-2]['action'] == 'provision'
    assert deployment.provisioning_history[-2]['status'] == 'successful'
    assert deployment.provisioning_history[-1]['action'] == 'configure'
    assert deployment.provisioning_history[-1]['details']['saved_var_keys'] == ['vm_name']
    assert signal_start.call_count == 1

    deployment.configure_job.status = 'successful'
    deployment.configure_job.save(update_fields=['status'])

    deployment.refresh_from_db()
    assert deployment.status == 'validating'
    assert deployment.validate_job_id is not None
    assert deployment.validate_job.extra_vars_dict['vm_name'] == 'lifecycle-vm-01'
    assert deployment.provisioning_history[-2]['action'] == 'configure'
    assert deployment.provisioning_history[-2]['status'] == 'successful'
    assert deployment.provisioning_history[-1]['action'] == 'validate'
    assert signal_start.call_count == 2

    deployment.validate_job.status = 'successful'
    deployment.validate_job.save(update_fields=['status'])

    deployment.refresh_from_db()
    assert deployment.status == 'active'
    assert deployment.provisioning_history[-1]['action'] == 'validate'
    assert deployment.provisioning_history[-1]['status'] == 'successful'


@pytest.mark.django_db
def test_catalog_lifecycle_runs_configure_after_terraform_success(mocker, admin_user, organization):
    terraform_template = TerraformJobTemplate.objects.create(name='Terraform lifecycle VM', organization=organization)
    configure_workflow = WorkflowJobTemplate.objects.create(
        name='Configure terraform VM',
        organization=organization,
        ask_variables_on_launch=True,
    )
    item = CatalogItem.objects.create(
        name='Terraform lifecycle catalog item',
        organization=organization,
        terraform_job_template=terraform_template,
        configure_workflow=configure_workflow,
    )
    terraform_job = terraform_template.create_unified_job()
    deployment = CatalogDeployment.objects.create(
        name='terraform-lifecycle-vm-01',
        catalog_item=item,
        owner=admin_user,
        status='provisioning',
        terraform_provision_job=terraform_job,
        extra_vars={'vm_name': 'terraform-lifecycle-vm-01'},
    )
    deployment.append_history_entry('provision', job=terraform_job, status='running')
    deployment.save(update_fields=['provisioning_history'])

    signal_start = mocker.patch.object(WorkflowJob, 'signal_start', return_value=None)

    terraform_job.status = 'successful'
    terraform_job.save(update_fields=['status'])

    deployment.refresh_from_db()
    assert deployment.status == 'configuring'
    assert deployment.configure_job_id is not None
    assert deployment.configure_job.extra_vars_dict['vm_name'] == 'terraform-lifecycle-vm-01'
    assert deployment.provisioning_history[-2]['action'] == 'provision'
    assert deployment.provisioning_history[-2]['status'] == 'successful'
    assert deployment.provisioning_history[-1]['action'] == 'configure'
    assert signal_start.call_count == 1
