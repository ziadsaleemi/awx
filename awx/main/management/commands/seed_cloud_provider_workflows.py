# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

"""
Seed Azure and DigitalOcean Terraform workflows used by the catalog.

The command is safe to re-run. It creates or updates:

* a manual project backed by the bundled awx/terraform_examples tree
* provider inventories and groups
* Azure and DigitalOcean TerraformJobTemplates for apply and destroy
* matching WorkflowJobTemplates with surveys
* one multi-cloud CatalogItem wired through provider_workflows and
  provider_deprovision_workflows
"""

import os
import shutil

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from awx.main.models import Group, Inventory, Organization, Project, WorkflowJobTemplate, WorkflowJobTemplateNode
from awx.main.models.catalog import CatalogItem
from awx.main.models.terraform import TerraformJobTemplate

_SOURCE_TERRAFORM_EXAMPLES_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'terraform_examples'))
_PROJECT_LOCAL_PATH = 'awx-cloud-terraform-examples'
_PROJECT_NAME = 'AWX Cloud Terraform Examples'
_CATALOG_ITEM_NAME = 'Linux VM on Azure or DigitalOcean'


def _question(variable, label, description='', required=True, default='', question_type='text', choices=''):
    question = {
        'variable': variable,
        'question_name': label,
        'question_description': description,
        'required': required,
        'type': question_type,
        'choices': choices,
    }
    if default != '':
        question['default'] = default
    return question


def _survey(name, description, questions):
    return {
        'name': name,
        'description': description,
        'spec': [dict(question, index=index) for index, question in enumerate(questions)],
    }


AZURE_PROVISION_SURVEY = _survey(
    'Provision Azure VM',
    'Collect Azure VM provisioning values.',
    [
        _question('vm_name', 'VM name', 'Name to assign to the Azure VM.'),
        _question('resource_group_name', 'Resource group name', 'Existing Azure resource group.'),
        _question('vnet_name', 'Virtual network name', 'Existing Azure virtual network.'),
        _question('subnet_name', 'Subnet name', 'Existing subnet in the virtual network.'),
        _question('vm_size', 'VM size', 'Azure VM size SKU.', default='Standard_B2ms'),
        _question('admin_username', 'Admin username', 'Admin user created on the VM.', default='azureuser'),
    ],
)

AZURE_DEPROVISION_SURVEY = _survey(
    'Deprovision Azure VM',
    'Collect values Terraform needs to destroy the Azure VM state.',
    [
        _question('vm_name', 'VM name', 'Name of the Azure VM to destroy.'),
        _question('resource_group_name', 'Resource group name', 'Azure resource group that contains the VM.'),
        _question('vnet_name', 'Virtual network name', 'Virtual network used by the VM.'),
        _question('subnet_name', 'Subnet name', 'Subnet used by the VM.'),
    ],
)

DIGITALOCEAN_PROVISION_SURVEY = _survey(
    'Provision DigitalOcean Droplet',
    'Collect DigitalOcean droplet provisioning values.',
    [
        _question('droplet_name', 'Droplet name', 'Name to assign to the DigitalOcean Droplet.'),
        _question('do_region', 'Region', 'DigitalOcean region slug.', default='nyc3'),
        _question('do_droplet_size', 'Droplet size', 'DigitalOcean droplet size slug.', default='s-1vcpu-1gb'),
        _question('do_image', 'Image', 'DigitalOcean image slug or snapshot ID.', default='ubuntu-22-04-x64'),
        _question('do_ssh_key_name', 'SSH key name', 'Existing DigitalOcean SSH key name to attach.', required=False),
    ],
)

DIGITALOCEAN_DEPROVISION_SURVEY = _survey(
    'Deprovision DigitalOcean Droplet',
    'Collect values Terraform needs to destroy the DigitalOcean droplet state.',
    [
        _question('droplet_name', 'Droplet name', 'Name of the DigitalOcean Droplet to destroy.'),
    ],
)


class Command(BaseCommand):
    help = 'Seed Azure and DigitalOcean Terraform workflows with surveys and catalog provider wiring.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--org',
            default='Default',
            help='Name of the AWX organization to use or create (default: Default).',
        )
        parser.add_argument(
            '--project-local-path',
            default=_PROJECT_LOCAL_PATH,
            help=f'Manual project local path under PROJECTS_ROOT (default: {_PROJECT_LOCAL_PATH}).',
        )
        parser.add_argument(
            '--skip-project-copy',
            action='store_true',
            help='Do not copy bundled Terraform examples into PROJECTS_ROOT.',
        )

    def handle(self, *args, **options):
        with transaction.atomic():
            self._seed(
                org_name=options['org'],
                project_local_path=options['project_local_path'],
                copy_project_files=not options['skip_project_copy'],
            )

    def _seed(self, org_name, project_local_path, copy_project_files):
        self.stdout.write(self.style.MIGRATE_HEADING('=== Seeding cloud provider workflows ==='))

        if copy_project_files:
            self._copy_project_files(project_local_path)

        org, created = Organization.objects.get_or_create(name=org_name)
        self._log('Organization', org.name, created)

        project, created = Project.objects.update_or_create(
            name=_PROJECT_NAME,
            organization=org,
            defaults={
                'scm_type': '',
                'local_path': project_local_path,
                'description': 'Bundled Terraform configurations for Azure and DigitalOcean VM provisioning.',
            },
        )
        self._log('Project', project.name, created)

        azure_inventory, azure_group = self._ensure_inventory(org, 'Azure VMs', 'azure_vms')
        do_inventory, do_group = self._ensure_inventory(org, 'DigitalOcean VMs', 'digitalocean_vms')

        azure_apply = self._ensure_terraform_template(
            org=org,
            project=project,
            name='Provision Azure VM',
            description='Provisions an Azure Linux VM via Terraform and registers it in Azure VMs.',
            terraform_dir='azure-vm',
            operation='apply',
            survey=AZURE_PROVISION_SURVEY,
            target_inventory=azure_inventory,
            target_group=azure_group.name,
        )
        azure_destroy = self._ensure_terraform_template(
            org=org,
            project=project,
            name='Deprovision Azure VM',
            description='Destroys an Azure Linux VM via Terraform destroy.',
            terraform_dir='azure-vm',
            operation='destroy',
            survey=AZURE_DEPROVISION_SURVEY,
        )
        do_apply = self._ensure_terraform_template(
            org=org,
            project=project,
            name='Provision DigitalOcean Droplet',
            description='Provisions a DigitalOcean Droplet via Terraform and registers it in DigitalOcean VMs.',
            terraform_dir='digitalocean-droplet',
            operation='apply',
            survey=DIGITALOCEAN_PROVISION_SURVEY,
            target_inventory=do_inventory,
            target_group=do_group.name,
        )
        do_destroy = self._ensure_terraform_template(
            org=org,
            project=project,
            name='Deprovision DigitalOcean Droplet',
            description='Destroys a DigitalOcean Droplet via Terraform destroy.',
            terraform_dir='digitalocean-droplet',
            operation='destroy',
            survey=DIGITALOCEAN_DEPROVISION_SURVEY,
        )

        azure_provision_wf = self._ensure_workflow(
            org,
            'Azure VM Provision Workflow',
            'Launches the Azure VM Terraform provision template.',
            AZURE_PROVISION_SURVEY,
            azure_apply,
        )
        azure_deprovision_wf = self._ensure_workflow(
            org,
            'Azure VM Deprovision Workflow',
            'Launches the Azure VM Terraform destroy template.',
            AZURE_DEPROVISION_SURVEY,
            azure_destroy,
        )
        do_provision_wf = self._ensure_workflow(
            org,
            'DigitalOcean VM Provision Workflow',
            'Launches the DigitalOcean Droplet Terraform provision template.',
            DIGITALOCEAN_PROVISION_SURVEY,
            do_apply,
        )
        do_deprovision_wf = self._ensure_workflow(
            org,
            'DigitalOcean VM Deprovision Workflow',
            'Launches the DigitalOcean Droplet Terraform destroy template.',
            DIGITALOCEAN_DEPROVISION_SURVEY,
            do_destroy,
        )

        catalog_item, created = CatalogItem.objects.update_or_create(
            name=_CATALOG_ITEM_NAME,
            organization=org,
            defaults={
                'description': 'Provision and deprovision Linux VMs through Azure or DigitalOcean Terraform workflows.',
                'browse_enabled': True,
                'available_providers': ['azure', 'digitalocean'],
                'provider_workflows': {
                    'azure': azure_provision_wf.pk,
                    'digitalocean': do_provision_wf.pk,
                },
                'provider_deprovision_workflows': {
                    'azure': azure_deprovision_wf.pk,
                    'digitalocean': do_deprovision_wf.pk,
                },
                'cloud_backends': {
                    'azure': azure_apply.pk,
                    'digitalocean': do_apply.pk,
                },
                'name_template': '{vm_name}{droplet_name}',
                'dynamic_name_field': 'vm_name,droplet_name',
                'provider_field_configs': {
                    'azure': {
                        'target_inventory': azure_inventory.name,
                        'target_group': azure_group.name,
                        'dynamic_field_sources': {
                            'vm_size': 'vm_sizes.name',
                        },
                    },
                    'digitalocean': {
                        'target_inventory': do_inventory.name,
                        'target_group': do_group.name,
                        'dynamic_field_sources': {
                            'do_region': 'regions.slug',
                            'do_droplet_size': 'droplet_sizes.slug',
                            'do_image': 'droplet_images.slug',
                        },
                    },
                },
            },
        )
        self._log('CatalogItem', catalog_item.name, created)

        self.stdout.write(self.style.SUCCESS('\nDone. Cloud provider workflows seeded successfully.'))

    def _copy_project_files(self, project_local_path):
        if not os.path.isdir(_SOURCE_TERRAFORM_EXAMPLES_DIR):
            raise CommandError(f'Terraform examples directory not found: {_SOURCE_TERRAFORM_EXAMPLES_DIR}')

        destination = os.path.join(settings.PROJECTS_ROOT, os.path.basename(project_local_path))
        os.makedirs(destination, exist_ok=True)
        shutil.copytree(
            _SOURCE_TERRAFORM_EXAMPLES_DIR,
            destination,
            dirs_exist_ok=True,
            ignore=shutil.ignore_patterns('.terraform', '.terraform.lock.hcl'),
        )
        self.stdout.write(f'  Synced Terraform examples to {destination}')

    def _ensure_inventory(self, org, inventory_name, group_name):
        inventory, created = Inventory.objects.update_or_create(
            name=inventory_name,
            organization=org,
            defaults={'description': f'Hosts provisioned through {inventory_name} Terraform workflows.'},
        )
        self._log('Inventory', inventory.name, created)
        group, created = Group.objects.get_or_create(name=group_name, inventory=inventory)
        self._log('Group', group.name, created)
        return inventory, group

    def _ensure_terraform_template(
        self,
        org,
        project,
        name,
        description,
        terraform_dir,
        operation,
        survey,
        target_inventory=None,
        target_group='',
    ):
        template, created = TerraformJobTemplate.objects.update_or_create(
            name=name,
            organization=org,
            defaults={
                'project': project,
                'terraform_dir': terraform_dir,
                'terraform_operation': operation,
                'target_inventory': target_inventory,
                'target_group': target_group,
                'ask_variables_on_launch': True,
                'survey_enabled': True,
                'survey_spec': survey,
                'description': description,
            },
        )
        self._log(f'TerraformJobTemplate ({operation})', template.name, created)
        return template

    def _ensure_workflow(self, org, name, description, survey, terraform_template):
        workflow, created = WorkflowJobTemplate.objects.update_or_create(
            name=name,
            organization=org,
            defaults={
                'description': description,
                'ask_variables_on_launch': True,
                'survey_enabled': True,
                'survey_spec': survey,
            },
        )
        self._log('WorkflowJobTemplate', workflow.name, created)

        _node, node_created = WorkflowJobTemplateNode.objects.get_or_create(
            workflow_job_template=workflow,
            unified_job_template=terraform_template,
        )
        self._log('WorkflowJobTemplateNode', f'{workflow.name} -> {terraform_template.name}', node_created)
        return workflow

    def _log(self, kind, name, created):
        verb = 'Created' if created else 'Updated'
        style = self.style.SUCCESS if created else self.style.WARNING
        self.stdout.write(f'  {style(verb)}: {kind} - {name}')
