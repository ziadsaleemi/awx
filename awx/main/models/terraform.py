# Copyright (c) 2024 Red Hat, Inc.
# All Rights Reserved.

import logging

from django.db import models
from django.utils.translation import gettext_lazy as _

from ansible_base.lib.utils.models import prevent_search

from awx.api.versioning import reverse
from awx.main.models.base import (
    accepts_json,
    VERBOSITY_CHOICES,
)
from awx.main.models.unified_jobs import UnifiedJob, UnifiedJobTemplate
from awx.main.models.notifications import JobNotificationMixin
from awx.main.models.mixins import (
    ResourceMixin,
    SurveyJobMixin,
    SurveyJobTemplateMixin,
    TaskManagerUnifiedJobMixin,
)
from awx.main.fields import ImplicitRoleField, AskForField

logger = logging.getLogger('awx.main.models.terraform')

__all__ = ['TerraformJobTemplate', 'TerraformJob']

TERRAFORM_OPERATION_CHOICES = [
    ('apply', _('Apply')),
    ('plan', _('Plan')),
    ('destroy', _('Destroy')),
]


class TerraformJobTemplate(UnifiedJobTemplate, SurveyJobTemplateMixin, ResourceMixin):
    """
    A template for running Terraform operations (apply / plan / destroy)
    against an SCM project that contains .tf files.
    """

    class Meta:
        app_label = 'main'
        ordering = ('name',)
        default_permissions = ('change', 'delete', 'view')
        permissions = [
            ('execute_terraformjobtemplate', 'Can run this Terraform job template'),
        ]

    # ------------------------------------------------------------------ #
    # Source project                                                       #
    # ------------------------------------------------------------------ #
    project = models.ForeignKey(
        'Project',
        related_name='terraform_job_templates',
        blank=True,
        null=True,
        default=None,
        on_delete=models.SET_NULL,
        help_text=_('The project which contains the Terraform configuration files.'),
    )

    # ------------------------------------------------------------------ #
    # Terraform-specific options                                           #
    # ------------------------------------------------------------------ #
    terraform_dir = models.CharField(
        max_length=1024,
        blank=True,
        default='.',
        help_text=_(
            'Path within the project to the directory containing the Terraform '
            'root module. Use "." for the repository root (default).'
        ),
    )

    extra_vars = prevent_search(
        accepts_json(
            models.TextField(
                blank=True,
                default='',
                help_text=_(
                    'Variables to pass to Terraform as a tfvars file. '
                    'Accepts JSON or YAML key/value pairs.'
                ),
            )
        )
    )

    verbosity = models.PositiveIntegerField(
        choices=VERBOSITY_CHOICES,
        blank=True,
        default=0,
        help_text=_('Control the level of output Terraform produces.'),
    )

    terraform_operation = models.CharField(
        max_length=16,
        choices=TERRAFORM_OPERATION_CHOICES,
        default='apply',
        help_text=_('The Terraform operation to run: apply, plan, or destroy.'),
    )

    # ------------------------------------------------------------------ #
    # Inventory population after a successful apply                        #
    # ------------------------------------------------------------------ #
    target_inventory = models.ForeignKey(
        'Inventory',
        related_name='terraform_job_templates',
        blank=True,
        null=True,
        default=None,
        on_delete=models.SET_NULL,
        help_text=_(
            'If set, after a successful apply AWX will read Terraform output '
            'variables and create Host records in this inventory for each value '
            'named "host_ip_*".'
        ),
    )

    target_group = models.CharField(
        max_length=512,
        blank=True,
        default='',
        help_text=_(
            'Inventory group to add provisioned hosts to. '
            'The group is created automatically if it does not exist.'
        ),
    )

    # ------------------------------------------------------------------ #
    # Execution options                                                    #
    # ------------------------------------------------------------------ #
    allow_simultaneous = models.BooleanField(
        default=False,
        help_text=_('Allow multiple jobs from this template to run simultaneously.'),
    )

    timeout = models.IntegerField(
        blank=True,
        default=0,
        help_text=_(
            'The number of seconds to run before the task is cancelled. '
            'Zero means no timeout.'
        ),
    )

    # ------------------------------------------------------------------ #
    # Ask-at-launch prompts                                               #
    # ------------------------------------------------------------------ #
    ask_variables_on_launch = AskForField(
        blank=True,
        default=False,
        allows_field='extra_vars',
    )
    ask_inventory_on_launch = AskForField(
        blank=True,
        default=False,
        allows_field='target_inventory',
    )
    ask_terraform_operation_on_launch = AskForField(
        blank=True,
        default=False,
        allows_field='terraform_operation',
    )

    # ------------------------------------------------------------------ #
    # RBAC roles                                                          #
    # ------------------------------------------------------------------ #
    admin_role = ImplicitRoleField(
        parent_role=['organization.job_template_admin_role'],
    )
    execute_role = ImplicitRoleField(
        parent_role=['admin_role', 'organization.execute_role'],
    )
    read_role = ImplicitRoleField(
        parent_role=['admin_role', 'execute_role', 'organization.auditor_role'],
    )

    # ------------------------------------------------------------------ #
    # UnifiedJobTemplate interface                                        #
    # ------------------------------------------------------------------ #
    @classmethod
    def _get_unified_job_class(cls):
        return TerraformJob

    @classmethod
    def _get_unified_job_field_names(cls):
        return [
            'name',
            'description',
            'organization',
            'project',
            'terraform_dir',
            'extra_vars',
            'verbosity',
            'terraform_operation',
            'target_inventory',
            'target_group',
            'allow_simultaneous',
            'timeout',
            'execution_environment',
            'credentials',
            'survey_passwords',
        ]

    @property
    def validation_errors(self):
        errors = {}
        if self.project is None:
            errors['project'] = [_('A Terraform Job Template must have a project assigned.')]
        return errors

    @property
    def resources_needed_to_start(self):
        return ['project'] if not self.project_id else []

    def get_absolute_url(self, request=None):
        return reverse('api:terraform_job_template_detail', kwargs={'pk': self.pk}, request=request)

    def create_terraform_job(self, **kwargs):
        return self.create_unified_job(**kwargs)


class TerraformJob(UnifiedJob, SurveyJobMixin, JobNotificationMixin, TaskManagerUnifiedJobMixin):
    """
    A single run of a Terraform operation (apply / plan / destroy).
    """

    class Meta:
        app_label = 'main'
        ordering = ('id',)

    terraform_job_template = models.ForeignKey(
        'TerraformJobTemplate',
        related_name='jobs',
        blank=True,
        null=True,
        default=None,
        on_delete=models.SET_NULL,
        help_text=_('The Terraform job template that produced this job.'),
    )

    project = models.ForeignKey(
        'Project',
        related_name='terraform_jobs',
        blank=True,
        null=True,
        default=None,
        on_delete=models.SET_NULL,
        help_text=_('The project containing the Terraform configuration.'),
    )

    terraform_dir = models.CharField(
        max_length=1024,
        blank=True,
        default='.',
        help_text=_('Path within the project to the Terraform root module.'),
    )

    extra_vars = prevent_search(
        accepts_json(
            models.TextField(
                blank=True,
                default='',
                help_text=_('Variables passed to Terraform as a tfvars file.'),
            )
        )
    )

    verbosity = models.PositiveIntegerField(
        choices=VERBOSITY_CHOICES,
        blank=True,
        default=0,
        help_text=_('Verbosity level for Terraform output.'),
    )

    terraform_operation = models.CharField(
        max_length=16,
        choices=TERRAFORM_OPERATION_CHOICES,
        default='apply',
        help_text=_('The Terraform operation that was run: apply, plan, or destroy.'),
    )

    target_inventory = models.ForeignKey(
        'Inventory',
        related_name='terraform_jobs',
        blank=True,
        null=True,
        default=None,
        on_delete=models.SET_NULL,
        help_text=_('Inventory to populate with hosts after a successful apply.'),
    )

    target_group = models.CharField(
        max_length=512,
        blank=True,
        default='',
        help_text=_('Inventory group to add provisioned hosts to.'),
    )

    scm_revision = models.CharField(
        max_length=1024,
        blank=True,
        default='',
        editable=False,
        help_text=_('The SCM revision of the project that was checked out for this job.'),
    )

    # ------------------------------------------------------------------ #
    # UnifiedJob interface                                                 #
    # ------------------------------------------------------------------ #
    @classmethod
    def _get_task_class(cls):
        from awx.main.tasks.terraform import RunTerraformJob
        return RunTerraformJob

    @classmethod
    def _get_unified_job_template_class(cls):
        return TerraformJobTemplate

    def _get_parent_field_name(self):
        return 'terraform_job_template'

    def get_absolute_url(self, request=None):
        return reverse('api:terraform_job_detail', kwargs={'pk': self.pk}, request=request)

    def _global_timeout_setting(self):
        return 'DEFAULT_JOB_TIMEOUT'

    @property
    def task_impact(self):
        return 1

    def get_jobs_fail_chain(self):
        return []
