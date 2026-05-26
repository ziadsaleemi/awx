# Copyright (c) 2024 Red Hat, Inc.
# All Rights Reserved.

"""
Management command: seed_proxmox_example

Creates a complete end-to-end Proxmox + Catalog example inside a running AWX
dev environment.  Safe to re-run — all objects are created with get_or_create
so running it twice is idempotent.

Usage (from inside the dev container):
    awx-manage seed_proxmox_example

What it creates
---------------
  1. Default Organization (reused if already present)
  2. Project — "Proxmox Terraform Examples" (manual, points at the bundled
     awx/terraform_examples/proxmox-vm directory)
  3. Project — "AWX Built-in Playbooks" (manual, points at awx/playbooks)
  4. Inventory — "Proxmox VMs" with a 'proxmox_vms' group
  5. TerraformJobTemplate — "Provision Proxmox VM" (apply, targets the
     Proxmox VMs inventory, group=proxmox_vms)
  6. TerraformJobTemplate — "Deprovision Proxmox VM" (destroy, same project)
  7. JobTemplate — "Configure Proxmox VM" (configure_proxmox_vm.yml playbook,
     limits to proxmox_vms group, asks inventory on launch)
  8. WorkflowJobTemplate — "Proxmox VM Provision Workflow" (Node 1: Terraform
     apply → Node 2 on success: Ansible configure)
  9. WorkflowJobTemplate — "Proxmox VM Deprovision Workflow" (single node:
     Terraform destroy)
 10. CatalogItem — "Apache on Proxmox VM" (provision = workflow 8,
     deprovision = workflow 9)
"""

import os

from django.core.management.base import BaseCommand
from django.db import transaction

from awx.main.models import (
    Organization,
    Project,
    Inventory,
    Group,
    JobTemplate,
    WorkflowJobTemplate,
    WorkflowJobTemplateNode,
)
from awx.main.models.catalog import CatalogItem
from awx.main.models.terraform import TerraformJobTemplate


# Path to the bundled Terraform example (relative to the AWX source root)
_TERRAFORM_EXAMPLE_DIR = os.path.join(
    os.path.dirname(__file__),  # awx/main/management/commands/
    '..', '..', '..', '..', '..', 'terraform_examples', 'proxmox-vm',
)
_PLAYBOOKS_DIR = os.path.join(
    os.path.dirname(__file__),
    '..', '..', '..', '..', 'playbooks',
)


class Command(BaseCommand):
    help = 'Seed a complete Proxmox → Catalog example into the AWX dev environment.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--org',
            default='Default',
            help='Name of the AWX organization to use / create (default: Default).',
        )
        parser.add_argument(
            '--inventory',
            default='Proxmox VMs',
            help='Name for the target inventory (default: "Proxmox VMs").',
        )

    def handle(self, *args, **options):
        org_name = options['org']
        inv_name = options['inventory']

        with transaction.atomic():
            self._seed(org_name, inv_name)

    # ------------------------------------------------------------------ #
    # Internal helpers                                                    #
    # ------------------------------------------------------------------ #

    def _seed(self, org_name, inv_name):
        self.stdout.write(self.style.MIGRATE_HEADING('=== Seeding Proxmox example ==='))

        # 1. Organization
        org, created = Organization.objects.get_or_create(name=org_name)
        self._log('Organization', org.name, created)

        # 2. Terraform project (manual SCM, local path)
        tf_project, created = Project.objects.get_or_create(
            name='Proxmox Terraform Examples',
            defaults=dict(
                organization=org,
                scm_type='',  # manual
                local_path=os.path.normpath(_TERRAFORM_EXAMPLE_DIR),
                description='Bundled Terraform configuration for Proxmox VM provisioning.',
            ),
        )
        self._log('Project (Terraform)', tf_project.name, created)

        # 3. Ansible playbooks project (manual SCM, local path)
        playbook_project, created = Project.objects.get_or_create(
            name='AWX Built-in Playbooks',
            defaults=dict(
                organization=org,
                scm_type='',  # manual
                local_path=os.path.normpath(_PLAYBOOKS_DIR),
                description='Built-in AWX playbooks shipped with the dev environment.',
            ),
        )
        self._log('Project (Playbooks)', playbook_project.name, created)

        # 4. Inventory + group
        inventory, created = Inventory.objects.get_or_create(
            name=inv_name,
            organization=org,
            defaults=dict(description='Hosts provisioned via the Proxmox Terraform provider.'),
        )
        self._log('Inventory', inventory.name, created)

        group, created = Group.objects.get_or_create(
            name='proxmox_vms',
            inventory=inventory,
        )
        self._log('Group', group.name, created)

        # 5. Terraform apply template
        tf_apply, created = TerraformJobTemplate.objects.get_or_create(
            name='Provision Proxmox VM',
            defaults=dict(
                organization=org,
                project=tf_project,
                terraform_dir='.',
                terraform_operation='apply',
                target_inventory=inventory,
                target_group='proxmox_vms',
                ask_variables_on_launch=True,
                description='Provisions a Proxmox VM via Terraform and adds the host to the Proxmox VMs inventory.',
            ),
        )
        self._log('TerraformJobTemplate (apply)', tf_apply.name, created)

        # 6. Terraform destroy template
        tf_destroy, created = TerraformJobTemplate.objects.get_or_create(
            name='Deprovision Proxmox VM',
            defaults=dict(
                organization=org,
                project=tf_project,
                terraform_dir='.',
                terraform_operation='destroy',
                ask_variables_on_launch=True,
                description='Destroys a previously provisioned Proxmox VM via Terraform.',
            ),
        )
        self._log('TerraformJobTemplate (destroy)', tf_destroy.name, created)

        # 7. Ansible configure job template
        jt, created = JobTemplate.objects.get_or_create(
            name='Configure Proxmox VM',
            defaults=dict(
                organization=org,
                project=playbook_project,
                playbook='configure_proxmox_vm.yml',
                inventory=inventory,
                limit='proxmox_vms',
                ask_inventory_on_launch=True,
                ask_variables_on_launch=True,
                description='Installs and configures Apache/Nginx on a freshly provisioned Proxmox VM.',
            ),
        )
        self._log('JobTemplate', jt.name, created)

        # 8. Provision workflow: Terraform apply → Ansible configure
        wf_provision, created = WorkflowJobTemplate.objects.get_or_create(
            name='Proxmox VM Provision Workflow',
            defaults=dict(
                organization=org,
                description='End-to-end VM provisioning: Terraform apply then Ansible web-server configuration.',
                ask_variables_on_launch=True,
            ),
        )
        self._log('WorkflowJobTemplate (provision)', wf_provision.name, created)

        if created:
            node1 = WorkflowJobTemplateNode.objects.create(
                workflow_job_template=wf_provision,
                unified_job_template=tf_apply,
            )
            node2 = WorkflowJobTemplateNode.objects.create(
                workflow_job_template=wf_provision,
                unified_job_template=jt,
            )
            # node2 runs only on success of node1
            node1.success_nodes.add(node2)
            self.stdout.write('  Created 2 workflow nodes: Terraform apply → Ansible configure')

        # 9. Deprovision workflow: single Terraform destroy node
        wf_deprovision, created = WorkflowJobTemplate.objects.get_or_create(
            name='Proxmox VM Deprovision Workflow',
            defaults=dict(
                organization=org,
                description='Destroys the provisioned VM via Terraform destroy.',
                ask_variables_on_launch=True,
            ),
        )
        self._log('WorkflowJobTemplate (deprovision)', wf_deprovision.name, created)

        if created:
            WorkflowJobTemplateNode.objects.create(
                workflow_job_template=wf_deprovision,
                unified_job_template=tf_destroy,
            )
            self.stdout.write('  Created 1 workflow node: Terraform destroy')

        # 10. Catalog item
        catalog_item, created = CatalogItem.objects.get_or_create(
            name='Apache on Proxmox VM',
            defaults=dict(
                organization=org,
                description=(
                    'Provisions a Proxmox VM via Terraform then installs '
                    'Apache web server via Ansible. '
                    'Deprovisioning destroys the VM with terraform destroy.'
                ),
                provision_workflow=wf_provision,
                deprovision_workflow=wf_deprovision,
                extra_vars_schema={
                    "type": "object",
                    "properties": {
                        "vm_name": {
                            "type": "string",
                            "title": "VM Name",
                            "description": "Unique name for the new VM."
                        },
                        "ip_address": {
                            "type": "string",
                            "title": "IP Address",
                            "description": "Static IPv4 address for the VM (e.g. 192.168.1.100)."
                        },
                        "gateway": {
                            "type": "string",
                            "title": "Default Gateway",
                            "description": "Default gateway IPv4 address (e.g. 192.168.1.1)."
                        },
                        "proxmox_template_name": {
                            "type": "string",
                            "title": "Proxmox Template Name",
                            "description": "Name of the cloud-init-enabled Proxmox template to clone."
                        },
                        "cores": {
                            "type": "integer",
                            "title": "CPU Cores",
                            "description": "Number of vCPU cores.",
                            "default": 2,
                            "minimum": 1
                        },
                        "memory": {
                            "type": "integer",
                            "title": "Memory (MiB)",
                            "description": "VM memory in mebibytes.",
                            "default": 2048,
                            "minimum": 512
                        },
                        "disk_gb": {
                            "type": "integer",
                            "title": "Disk (GiB)",
                            "description": "VM disk size in gibibytes.",
                            "default": 20,
                            "minimum": 5
                        },
                        "web_server": {
                            "type": "string",
                            "title": "Web Server",
                            "description": "Web server to install: apache or nginx.",
                            "enum": ["apache", "nginx"],
                            "default": "apache"
                        }
                    },
                    "required": ["vm_name", "ip_address", "gateway", "proxmox_template_name"]
                },
            ),
        )
        self._log('CatalogItem', catalog_item.name, created)

        self.stdout.write(self.style.SUCCESS('\nDone. Proxmox example seeded successfully.'))
        self.stdout.write(
            '\nNext steps:\n'
            '  1. Create a Proxmox VE credential at /api/v2/credentials/\n'
            '     (use the "Proxmox VE" credential type)\n'
            '  2. Attach the credential to "Provision Proxmox VM" and\n'
            '     "Deprovision Proxmox VM" Terraform templates\n'
            '  3. Browse to /catalog to deploy "Apache on Proxmox VM"\n'
        )

    def _log(self, kind, name, created):
        verb = 'Created' if created else 'Already exists'
        style = self.style.SUCCESS if created else self.style.WARNING
        self.stdout.write(f'  {style(verb)}: {kind} — {name}')
