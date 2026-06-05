# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

"""
Create local users that cover every AWX managed role definition.

This is intentionally a dev/test command. It creates deterministic users with
an access-matrix prefix, assigns concrete DAB RBAC object roles, attaches a
matching custom user type, and verifies the resulting object permissions.
"""

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils.text import slugify

from ansible_base.rbac.models import RoleDefinition

from awx.main.models import (
    CatalogItem,
    Credential,
    CredentialType,
    ExecutionEnvironment,
    InstanceGroup,
    Inventory,
    JobTemplate,
    NotificationTemplate,
    Organization,
    Project,
    Team,
    TerraformJobTemplate,
    UserType,
    UserTypeAssignment,
    WorkflowJobTemplate,
)

DEFAULT_PREFIX = 'access-matrix'
DEFAULT_PASSWORD = 'access-matrix'


class Command(BaseCommand):
    help = 'Seed users, user types, role assignments, and verification resources for every AWX role definition.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--prefix',
            default=DEFAULT_PREFIX,
            help=f'Prefix for users, user types, and resources. Default: {DEFAULT_PREFIX}',
        )
        parser.add_argument(
            '--password',
            default=DEFAULT_PASSWORD,
            help='Password to set on all seeded users. Intended for local/dev environments only.',
        )
        parser.add_argument(
            '--no-verify',
            action='store_true',
            help='Create users and assignments without checking resulting object permissions.',
        )

    def handle(self, *args, **options):
        prefix = options['prefix']
        password = options['password']
        verify = not options['no_verify']

        with transaction.atomic():
            resources = self._ensure_resources(prefix)
            result = self._seed_users(prefix, password, resources, verify=verify)

        self.stdout.write(self.style.SUCCESS('Access matrix seeded successfully.'))
        self.stdout.write(f'Password for seeded users: {password}')
        self.stdout.write(f'Baseline users: {", ".join(result["baseline_users"])}')
        self.stdout.write(f'Role users: {len(result["role_users"])}')
        self.stdout.write(f'All-role user: {result["all_roles_user"]}')

    def _seed_users(self, prefix, password, resources, verify=True):
        member_role = RoleDefinition.objects.get(name='Organization Member')
        org = resources['organization']

        baseline_users = [
            self._ensure_user(f'{prefix}-system-admin', password, is_superuser=True),
            self._ensure_user(f'{prefix}-system-auditor', password, is_system_auditor=True),
            self._ensure_user(f'{prefix}-no-access', password),
        ]
        role_definitions = list(RoleDefinition.objects.select_related('content_type').prefetch_related('permissions').order_by('name'))

        role_users = []
        failures = []
        for role_definition in role_definitions:
            username = self._role_username(prefix, role_definition.name)
            user = self._ensure_user(username, password)
            user_type = self._ensure_user_type(prefix, role_definition.name, [role_definition])
            UserTypeAssignment.objects.update_or_create(user=user, defaults={'user_type': user_type})

            if role_definition.name == 'Platform Auditor':
                user.is_system_auditor = True
                user.save()
                UserTypeAssignment.objects.filter(user=user).delete()
                role_users.append(username)
                continue

            member_role.give_permission(user, org)
            target = self._target_for_role(role_definition, resources)
            if target is None:
                failures.append(f'{role_definition.name}: no resource target for {role_definition.content_type}')
                continue

            role_definition.give_permission(user, target)
            role_users.append(username)
            if verify:
                failures.extend(self._verify_role(user, role_definition, target))

        all_roles_user = self._ensure_user(f'{prefix}-all-roles', password)
        member_role.give_permission(all_roles_user, org)
        all_roles_user_type = self._ensure_user_type(prefix, 'All Roles', role_definitions)
        UserTypeAssignment.objects.update_or_create(user=all_roles_user, defaults={'user_type': all_roles_user_type})

        for role_definition in role_definitions:
            if role_definition.name == 'Platform Auditor':
                continue
            target = self._target_for_role(role_definition, resources)
            if target is None:
                failures.append(f'all roles: no resource target for {role_definition.name}')
                continue
            role_definition.give_permission(all_roles_user, target)
            if verify:
                failures.extend(self._verify_role(all_roles_user, role_definition, target, prefix='all roles'))

        if failures:
            raise CommandError('Access matrix verification failed:\n' + '\n'.join(failures))

        return {
            'baseline_users': [user.username for user in baseline_users],
            'role_users': role_users,
            'all_roles_user': all_roles_user.username,
        }

    def _ensure_user(self, username, password, is_superuser=False, is_system_auditor=False):
        User = get_user_model()
        user, _ = User.objects.get_or_create(
            username=username,
            defaults={
                'email': f'{username}@example.invalid',
                'first_name': 'Access',
                'last_name': 'Matrix',
            },
        )
        user.email = f'{username}@example.invalid'
        user.is_staff = bool(is_superuser)
        user.is_superuser = bool(is_superuser)
        user.is_system_auditor = bool(is_system_auditor)
        user.set_password(password)
        user.save()
        if is_superuser or is_system_auditor:
            UserTypeAssignment.objects.filter(user=user).delete()
        return user

    def _ensure_user_type(self, prefix, name, role_definitions):
        user_type, _ = UserType.objects.get_or_create(
            name=f'Access Matrix: {name}',
            defaults={'description': f'{prefix} persona for {name}.'},
        )
        user_type.description = f'{prefix} persona for {name}.'
        user_type.save(update_fields=['description'])
        user_type.role_definitions.set(role_definitions)
        return user_type

    def _ensure_resources(self, prefix):
        org, _ = Organization.objects.get_or_create(
            name=f'{prefix} Organization',
            defaults={'description': 'Access matrix verification organization.'},
        )
        team, _ = Team.objects.get_or_create(
            name=f'{prefix} Team',
            organization=org,
            defaults={'description': 'Access matrix verification team.'},
        )
        inventory, _ = Inventory.objects.get_or_create(
            name=f'{prefix} Inventory',
            organization=org,
            defaults={'description': 'Access matrix verification inventory.'},
        )
        project, _ = Project.objects.get_or_create(
            name=f'{prefix} Project',
            organization=org,
            defaults={
                'description': 'Access matrix verification project.',
                'scm_type': '',
                'local_path': f'{prefix}-project',
            },
        )
        credential_type = CredentialType.objects.filter(kind='ssh').order_by('id').first()
        if credential_type is None:
            raise CommandError('No Machine credential type exists; cannot seed credential role tests.')
        credential, _ = Credential.objects.get_or_create(
            name=f'{prefix} Credential',
            organization=org,
            credential_type=credential_type,
            defaults={'description': 'Access matrix verification credential.', 'inputs': {}},
        )
        execution_environment, _ = ExecutionEnvironment.objects.get_or_create(
            name=f'{prefix} Execution Environment',
            defaults={
                'organization': org,
                'image': 'quay.io/ansible/awx-ee:latest',
                'description': 'Access matrix verification execution environment.',
            },
        )
        instance_group, _ = InstanceGroup.objects.get_or_create(
            name=f'{prefix} Instance Group',
        )
        notification_template, _ = NotificationTemplate.objects.get_or_create(
            name=f'{prefix} Notification Template',
            organization=org,
            defaults={
                'notification_type': 'webhook',
                'notification_configuration': {
                    'url': 'http://example.invalid/awx-access-matrix',
                    'http_method': 'POST',
                    'headers': {},
                    'disable_ssl_verification': False,
                    'username': '',
                    'password': '',
                },
                'description': 'Access matrix verification notification template.',
            },
        )
        job_template, _ = JobTemplate.objects.get_or_create(
            name=f'{prefix} Job Template',
            organization=org,
            defaults={
                'description': 'Access matrix verification job template.',
                'project': project,
                'inventory': inventory,
                'playbook': 'access_matrix.yml',
            },
        )
        workflow_job_template, _ = WorkflowJobTemplate.objects.get_or_create(
            name=f'{prefix} Workflow Job Template',
            organization=org,
            defaults={'description': 'Access matrix verification workflow job template.'},
        )
        terraform_job_template, _ = TerraformJobTemplate.objects.get_or_create(
            name=f'{prefix} Terraform Job Template',
            organization=org,
            defaults={
                'description': 'Access matrix verification Terraform job template.',
                'project': project,
                'terraform_dir': '.',
                'terraform_operation': 'plan',
            },
        )
        catalog_item, _ = CatalogItem.objects.get_or_create(
            name=f'{prefix} Catalog Item',
            organization=org,
            defaults={
                'description': 'Access matrix verification catalog item.',
                'provision_workflow': workflow_job_template,
            },
        )

        return {
            'catalogitem': catalog_item,
            'credential': credential,
            'executionenvironment': execution_environment,
            'instancegroup': instance_group,
            'inventory': inventory,
            'jobtemplate': job_template,
            'notificationtemplate': notification_template,
            'organization': org,
            'project': project,
            'team': team,
            'terraformjobtemplate': terraform_job_template,
            'workflowjobtemplate': workflow_job_template,
        }

    def _target_for_role(self, role_definition, resources):
        if role_definition.content_type is None:
            return None
        return resources.get(role_definition.content_type.model)

    def _verify_role(self, user, role_definition, target, prefix=None):
        failures = []
        label = prefix or user.username
        for codename in role_definition.permissions.values_list('codename', flat=True):
            if not user.has_obj_perm(target, codename):
                failures.append(f'{label}: missing {codename} from {role_definition.name} on {target}')
        return failures

    def _role_username(self, prefix, role_name):
        return f'{prefix}-{slugify(role_name)}'[:150]
