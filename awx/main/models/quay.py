# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

from io import StringIO

from django.db import models
from django.contrib.contenttypes.models import ContentType
from django.utils.translation import gettext_lazy as _

from awx.main.fields import ImplicitRoleField
from awx.api.versioning import reverse
from awx.main.models.base import PrimordialModel
from awx.main.models.mixins import ResourceMixin, TaskManagerUnifiedJobMixin
from awx.main.models.notifications import JobNotificationMixin, NotificationTemplate
from awx.main.models.rbac import RoleAncestorEntry
from awx.main.models.unified_jobs import UnifiedJob, UnifiedJobTemplate

__all__ = ['QuayImageBuild', 'QuayImageBuildJob', 'QuayImageBuildTemplate']


QUAY_IMAGE_BUILD_STATUS_CHOICES = [
    ('pending', _('Pending')),
    ('running', _('Running')),
    ('successful', _('Successful')),
    ('failed', _('Failed')),
    ('canceled', _('Canceled')),
]


class QuayImageBuild(PrimordialModel):
    """
    A Project Quay execution-environment image build launched from an AWX Project.
    """

    class Meta:
        app_label = 'main'
        ordering = ('-created', '-id')

    project = models.ForeignKey(
        'Project',
        related_name='quay_image_builds',
        null=True,
        blank=True,
        default=None,
        on_delete=models.SET_NULL,
        help_text=_('AWX Project used as the execution environment build source.'),
    )
    template = models.ForeignKey(
        'QuayImageBuildTemplate',
        related_name='builds',
        null=True,
        blank=True,
        default=None,
        on_delete=models.SET_NULL,
        help_text=_('Saved execution environment build template used to launch this run.'),
    )
    project_name = models.CharField(max_length=512, blank=True, default='')
    project_path = models.CharField(max_length=4096, blank=True, default='')
    scm_revision = models.CharField(max_length=1024, blank=True, default='')
    namespace = models.CharField(max_length=255)
    repository = models.CharField(max_length=255)
    tag = models.CharField(max_length=128, default='latest')
    image = models.CharField(max_length=1024)
    registry = models.CharField(max_length=512)
    runtime = models.CharField(max_length=16, default='podman')
    definition_file = models.CharField(max_length=1024, default='execution-environment.yml')
    context_path = models.CharField(max_length=1024, default='.')
    status = models.CharField(
        max_length=32,
        choices=QUAY_IMAGE_BUILD_STATUS_CHOICES,
        default='pending',
    )
    progress = models.PositiveSmallIntegerField(default=0)
    started = models.DateTimeField(null=True, blank=True, default=None)
    finished = models.DateTimeField(null=True, blank=True, default=None)
    error = models.TextField(blank=True, default='')
    log = models.TextField(blank=True, default='')
    command_summary = models.JSONField(blank=True, default=list)
    unified_job = models.OneToOneField(
        'QuayImageBuildJob',
        related_name='quay_image_build',
        null=True,
        blank=True,
        default=None,
        on_delete=models.SET_NULL,
        help_text=_('Native AWX unified job that owns this Project Quay image build run.'),
    )

    @property
    def repository_path(self):
        return f'{self.namespace}/{self.repository}'

    def get_absolute_url(self, request=None):
        return reverse('api:quay_image_build_detail', kwargs={'pk': self.pk}, request=request)


class QuayImageBuildTemplate(UnifiedJobTemplate, ResourceMixin):
    """
    Saved Project Quay execution-environment image build definition.
    """

    class Meta:
        app_label = 'main'
        ordering = ('name', 'id')
        default_permissions = ('change', 'delete', 'view')
        permissions = [
            ('execute_quayimagebuildtemplate', 'Can run this Project Quay image build template'),
        ]

    unifiedjobtemplate_ptr = models.OneToOneField(
        'UnifiedJobTemplate',
        db_column='id',
        on_delete=models.CASCADE,
        parent_link=True,
        primary_key=True,
        serialize=False,
        auto_created=True,
    )

    project = models.ForeignKey(
        'Project',
        related_name='quay_image_build_templates',
        null=True,
        blank=True,
        default=None,
        on_delete=models.SET_NULL,
        help_text=_('AWX Project used as the execution environment build source.'),
    )
    namespace = models.CharField(max_length=255)
    repository = models.CharField(max_length=255)
    tag = models.CharField(max_length=128, default='latest')
    runtime = models.CharField(max_length=16, default='podman')
    definition_file = models.CharField(max_length=1024, default='execution-environment.yml')
    context_path = models.CharField(max_length=1024, default='.')
    admin_role = ImplicitRoleField(
        parent_role=['organization.execution_environment_admin_role', 'organization.job_template_admin_role'],
    )
    execute_role = ImplicitRoleField(
        parent_role=['admin_role', 'organization.execute_role'],
    )
    read_role = ImplicitRoleField(
        parent_role=['admin_role', 'execute_role', 'organization.auditor_role'],
    )

    @property
    def repository_path(self):
        return f'{self.namespace}/{self.repository}'

    def get_absolute_url(self, request=None):
        return reverse('api:quay_image_build_template_detail', kwargs={'pk': self.pk}, request=request)

    @classmethod
    def _get_unified_job_class(cls):
        return QuayImageBuildJob

    @classmethod
    def _get_unified_job_field_names(cls):
        return [
            'name',
            'description',
            'organization',
            'project',
            'namespace',
            'repository',
            'tag',
            'runtime',
            'definition_file',
            'context_path',
            'execution_environment',
        ]

    @property
    def validation_errors(self):
        errors = {}
        if self.project is None:
            errors['project'] = [_('A Project Quay image build template must have a project assigned.')]
        return errors

    @property
    def resources_needed_to_start(self):
        return ['project'] if not self.project_id else []

    @property
    def notification_templates(self):
        base_notification_templates = NotificationTemplate.objects.all()
        error_notification_templates = list(base_notification_templates.filter(unifiedjobtemplate_notification_templates_for_errors__in=[self]))
        started_notification_templates = list(base_notification_templates.filter(unifiedjobtemplate_notification_templates_for_started__in=[self]))
        success_notification_templates = list(base_notification_templates.filter(unifiedjobtemplate_notification_templates_for_success__in=[self]))
        if self.organization_id:
            error_notification_templates = set(
                error_notification_templates + list(base_notification_templates.filter(organization_notification_templates_for_errors=self.organization))
            )
            started_notification_templates = set(
                started_notification_templates + list(base_notification_templates.filter(organization_notification_templates_for_started=self.organization))
            )
            success_notification_templates = set(
                success_notification_templates + list(base_notification_templates.filter(organization_notification_templates_for_success=self.organization))
            )
        return dict(error=list(error_notification_templates), started=list(started_notification_templates), success=list(success_notification_templates))

    def save(self, *args, **kwargs):
        if not self.organization_id and self.project_id and self.project and self.project.organization_id:
            self.organization = self.project.organization
        super().save(*args, **kwargs)

    def create_quay_image_build_job(self, **kwargs):
        return self.create_unified_job(**kwargs)

    @classmethod
    def accessible_pk_qs(cls, accessor, role_field):
        if getattr(accessor, 'is_superuser', False):
            return cls.objects.values_list('id', flat=True)
        if getattr(accessor, 'is_system_auditor', False) and role_field in ('read_role',):
            return cls.objects.values_list('id', flat=True)
        ct = ContentType.objects.get_for_model(cls)
        return (
            RoleAncestorEntry.objects.filter(
                ancestor__in=accessor.roles.all(),
                role_field=role_field,
                content_type=ct,
            )
            .values_list('object_id')
            .distinct()
        )


class QuayImageBuildJob(UnifiedJob, JobNotificationMixin, TaskManagerUnifiedJobMixin):
    """
    Native AWX job for a Project Quay execution-environment image build.
    """

    class Meta:
        app_label = 'main'
        ordering = ('id',)

    quay_image_build_template = models.ForeignKey(
        'QuayImageBuildTemplate',
        related_name='jobs',
        blank=True,
        null=True,
        default=None,
        on_delete=models.SET_NULL,
        help_text=_('Project Quay image build template that produced this job.'),
    )
    project = models.ForeignKey(
        'Project',
        related_name='quay_image_build_jobs',
        blank=True,
        null=True,
        default=None,
        on_delete=models.SET_NULL,
        help_text=_('AWX Project used as the execution environment build source.'),
    )
    namespace = models.CharField(max_length=255)
    repository = models.CharField(max_length=255)
    tag = models.CharField(max_length=128, default='latest')
    image = models.CharField(max_length=1024, blank=True, default='')
    registry = models.CharField(max_length=512, blank=True, default='')
    runtime = models.CharField(max_length=16, default='podman')
    definition_file = models.CharField(max_length=1024, default='execution-environment.yml')
    context_path = models.CharField(max_length=1024, default='.')
    scm_revision = models.CharField(max_length=1024, blank=True, default='', editable=False)
    progress = models.PositiveSmallIntegerField(default=0)
    command_summary = models.JSONField(blank=True, default=list)

    @property
    def repository_path(self):
        return f'{self.namespace}/{self.repository}'

    @classmethod
    def _get_task_class(cls):
        from awx.main.tasks.quay import RunQuayImageBuildJob

        return RunQuayImageBuildJob

    @classmethod
    def _get_unified_job_template_class(cls):
        return QuayImageBuildTemplate

    def _get_parent_field_name(self):
        return 'quay_image_build_template'

    def get_absolute_url(self, request=None):
        return reverse('api:quay_image_build_job_detail', kwargs={'pk': self.pk}, request=request)

    def _global_timeout_setting(self):
        return 'DEFAULT_JOB_TIMEOUT'

    def _get_task_impact(self):
        return 1

    @property
    def preferred_instance_groups(self):
        selected_groups = []
        if self.quay_image_build_template_id:
            selected_groups.extend(self.quay_image_build_template.instance_groups.all())
        if self.organization_id:
            selected_groups.extend(self.organization.instance_groups.all())
        if not selected_groups:
            return self.global_instance_groups
        return selected_groups

    def result_stdout_raw_handle(self, enforce_max_bytes=False):
        try:
            legacy_build = self.quay_image_build
        except QuayImageBuild.DoesNotExist:
            legacy_build = None
        if legacy_build and legacy_build.log:
            return StringIO(legacy_build.log)
        return StringIO('')

    def display_artifacts(self):
        return {}

    def get_notification_templates(self):
        if self.quay_image_build_template_id:
            return self.quay_image_build_template.notification_templates
        return {}

    def get_notification_friendly_name(self):
        return 'Project Quay image build'
