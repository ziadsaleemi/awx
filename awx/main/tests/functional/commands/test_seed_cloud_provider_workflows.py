import pytest
from django.core.management import call_command
from django.test import override_settings

from awx.main.management.commands.seed_cloud_provider_workflows import (
    _CATALOG_ITEM_NAME,
    _PROJECT_LOCAL_PATH,
    _PROJECT_NAME,
)
from awx.main.models import Group, Inventory, Organization, Project, WorkflowJobTemplate, WorkflowJobTemplateNode
from awx.main.models.catalog import CatalogItem
from awx.main.models.terraform import TerraformJobTemplate

PROVIDER_TEMPLATE_NAMES = [
    'Provision Azure VM',
    'Deprovision Azure VM',
    'Provision DigitalOcean Droplet',
    'Deprovision DigitalOcean Droplet',
]

PROVIDER_WORKFLOW_NAMES = [
    'Azure VM Provision Workflow',
    'Azure VM Deprovision Workflow',
    'DigitalOcean VM Provision Workflow',
    'DigitalOcean VM Deprovision Workflow',
]


def _survey_variables(obj):
    return [question['variable'] for question in obj.survey_spec['spec']]


@pytest.mark.django_db
def test_seed_cloud_provider_workflows_creates_wired_objects(tmp_path):
    with override_settings(PROJECTS_ROOT=str(tmp_path)):
        call_command('seed_cloud_provider_workflows', '--org', 'Cloud Org')

    assert (tmp_path / _PROJECT_LOCAL_PATH / 'azure-vm' / 'main.tf').exists()
    assert (tmp_path / _PROJECT_LOCAL_PATH / 'digitalocean-droplet' / 'main.tf').exists()

    org = Organization.objects.get(name='Cloud Org')
    project = Project.objects.get(name=_PROJECT_NAME, organization=org)
    assert project.scm_type == ''
    assert project.local_path == _PROJECT_LOCAL_PATH

    azure_inventory = Inventory.objects.get(name='Azure VMs', organization=org)
    do_inventory = Inventory.objects.get(name='DigitalOcean VMs', organization=org)
    assert Group.objects.filter(name='azure_vms', inventory=azure_inventory).exists()
    assert Group.objects.filter(name='digitalocean_vms', inventory=do_inventory).exists()

    azure_apply = TerraformJobTemplate.objects.get(name='Provision Azure VM', organization=org)
    assert azure_apply.project == project
    assert azure_apply.terraform_dir == 'azure-vm'
    assert azure_apply.terraform_operation == 'apply'
    assert azure_apply.target_inventory == azure_inventory
    assert azure_apply.target_group == 'azure_vms'
    assert azure_apply.ask_variables_on_launch is True
    assert azure_apply.survey_enabled is True
    assert _survey_variables(azure_apply) == [
        'vm_name',
        'resource_group_name',
        'vnet_name',
        'subnet_name',
        'vm_size',
        'admin_username',
    ]

    azure_destroy = TerraformJobTemplate.objects.get(name='Deprovision Azure VM', organization=org)
    assert azure_destroy.terraform_operation == 'destroy'
    assert azure_destroy.terraform_dir == 'azure-vm'
    assert _survey_variables(azure_destroy) == [
        'vm_name',
        'resource_group_name',
        'vnet_name',
        'subnet_name',
    ]

    do_apply = TerraformJobTemplate.objects.get(name='Provision DigitalOcean Droplet', organization=org)
    assert do_apply.project == project
    assert do_apply.terraform_dir == 'digitalocean-droplet'
    assert do_apply.terraform_operation == 'apply'
    assert do_apply.target_inventory == do_inventory
    assert do_apply.target_group == 'digitalocean_vms'
    assert do_apply.survey_enabled is True
    assert _survey_variables(do_apply) == [
        'droplet_name',
        'do_region',
        'do_droplet_size',
        'do_image',
        'do_ssh_key_name',
    ]

    do_destroy = TerraformJobTemplate.objects.get(name='Deprovision DigitalOcean Droplet', organization=org)
    assert do_destroy.terraform_operation == 'destroy'
    assert do_destroy.terraform_dir == 'digitalocean-droplet'
    assert _survey_variables(do_destroy) == ['droplet_name']

    workflow_targets = {
        'Azure VM Provision Workflow': azure_apply,
        'Azure VM Deprovision Workflow': azure_destroy,
        'DigitalOcean VM Provision Workflow': do_apply,
        'DigitalOcean VM Deprovision Workflow': do_destroy,
    }
    for workflow_name, target_template in workflow_targets.items():
        workflow = WorkflowJobTemplate.objects.get(name=workflow_name, organization=org)
        assert workflow.ask_variables_on_launch is True
        assert workflow.survey_enabled is True
        assert (
            WorkflowJobTemplateNode.objects.filter(
                workflow_job_template=workflow,
                unified_job_template=target_template,
            ).count()
            == 1
        )

    catalog_item = CatalogItem.objects.get(name=_CATALOG_ITEM_NAME, organization=org)
    azure_provision_wf = WorkflowJobTemplate.objects.get(name='Azure VM Provision Workflow', organization=org)
    azure_deprovision_wf = WorkflowJobTemplate.objects.get(name='Azure VM Deprovision Workflow', organization=org)
    do_provision_wf = WorkflowJobTemplate.objects.get(name='DigitalOcean VM Provision Workflow', organization=org)
    do_deprovision_wf = WorkflowJobTemplate.objects.get(name='DigitalOcean VM Deprovision Workflow', organization=org)
    assert catalog_item.available_providers == ['azure', 'digitalocean']
    assert catalog_item.provider_workflows == {
        'azure': azure_provision_wf.pk,
        'digitalocean': do_provision_wf.pk,
    }
    assert catalog_item.provider_deprovision_workflows == {
        'azure': azure_deprovision_wf.pk,
        'digitalocean': do_deprovision_wf.pk,
    }
    assert catalog_item.cloud_backends == {
        'azure': azure_apply.pk,
        'digitalocean': do_apply.pk,
    }
    assert catalog_item.provider_field_configs['azure']['dynamic_field_sources'] == {
        'vm_size': 'vm_sizes.name',
    }
    assert catalog_item.provider_field_configs['digitalocean']['dynamic_field_sources'] == {
        'do_region': 'regions.slug',
        'do_droplet_size': 'droplet_sizes.slug',
        'do_image': 'droplet_images.slug',
    }


@pytest.mark.django_db
def test_seed_cloud_provider_workflows_is_idempotent(tmp_path):
    with override_settings(PROJECTS_ROOT=str(tmp_path)):
        call_command('seed_cloud_provider_workflows', '--org', 'Cloud Org')
        call_command('seed_cloud_provider_workflows', '--org', 'Cloud Org')

    org = Organization.objects.get(name='Cloud Org')
    assert TerraformJobTemplate.objects.filter(organization=org, name__in=PROVIDER_TEMPLATE_NAMES).count() == 4
    assert WorkflowJobTemplate.objects.filter(organization=org, name__in=PROVIDER_WORKFLOW_NAMES).count() == 4
    assert CatalogItem.objects.filter(organization=org, name=_CATALOG_ITEM_NAME).count() == 1

    for workflow_name in PROVIDER_WORKFLOW_NAMES:
        workflow = WorkflowJobTemplate.objects.get(name=workflow_name, organization=org)
        assert workflow.workflow_job_template_nodes.count() == 1
