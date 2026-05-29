# Copyright (c) 2024 Red Hat, Inc.
# All Rights Reserved.

import logging

from django.db import models
from django.contrib.auth.models import User
from django.utils.translation import gettext_lazy as _
from django.utils.timezone import now

from awx.api.versioning import reverse
from awx.main.fields import ImplicitRoleField
from awx.main.models.base import CommonModelNameNotUnique

logger = logging.getLogger('awx.main.models.catalog')

__all__ = ['CatalogItem', 'CatalogDeployment', 'CloudProviderConnection', 'CloudProviderState']


class CatalogItem(CommonModelNameNotUnique):
    """
    A self-service catalog entry that wraps a provision workflow (and
    optionally a deprovision workflow).  Users with the catalog_user role
    can browse items and launch deployments; catalog_admin users can create
    and manage items.
    """

    class Meta:
        app_label = 'main'
        ordering = ('name',)
        default_permissions = ('change', 'delete', 'view')

    icon_url = models.URLField(
        max_length=1024,
        blank=True,
        default='',
        help_text=_('Optional URL for a display icon.'),
    )
    icon_data = models.TextField(
        blank=True,
        default='',
        help_text=_('Optional base64-encoded image (data URL) used for catalog item icon upload.'),
    )
    name_template = models.CharField(
        max_length=1024,
        blank=True,
        default='',
        help_text=_(
            'Optional deployment name template. Use {user_org_name} for the normalized organization name and append +1 to enable sequential numbering.'
        ),
    )
    dynamic_name_field = models.CharField(
        max_length=256,
        blank=True,
        default='',
        help_text=_(
            'Optional deploy variable name to auto-populate as a dynamic field (for example, vmnam).'
        ),
    )
    dynamic_field_templates = models.JSONField(
        blank=True,
        null=True,
        default=None,
        help_text=_(
            'Optional per-field dynamic values keyed by deploy variable name. These values are independent from name_template.'
        ),
    )
    deploy_disabled_fields = models.JSONField(
        blank=True,
        null=True,
        default=None,
        help_text=_(
            'Optional list of deploy field names that should be read-only in the deploy form for this catalog item.'
        ),
    )
    deploy_hidden_fields = models.JSONField(
        blank=True,
        null=True,
        default=None,
        help_text=_(
            'Optional list of deploy field names that should be hidden from the deploy form for this catalog item.'
        ),
    )
    organization = models.ForeignKey(
        'Organization',
        related_name='catalog_items',
        null=True,
        blank=True,
        default=None,
        on_delete=models.SET_NULL,
    )
    provision_workflow = models.ForeignKey(
        'WorkflowJobTemplate',
        related_name='catalog_items_as_provision',
        null=True,
        blank=True,
        default=None,
        on_delete=models.SET_NULL,
        help_text=_('Workflow to run when a user deploys this item.'),
    )
    terraform_job_template = models.ForeignKey(
        'TerraformJobTemplate',
        related_name='catalog_items',
        null=True,
        blank=True,
        default=None,
        on_delete=models.SET_NULL,
        help_text=_('Terraform template to run when a user deploys this item (alternative to provision_workflow).'),
    )
    deprovision_workflow = models.ForeignKey(
        'WorkflowJobTemplate',
        related_name='catalog_items_as_deprovision',
        null=True,
        blank=True,
        default=None,
        on_delete=models.SET_NULL,
        help_text=_('Workflow to run when a user decommissions a deployment.'),
    )
    override_workflow_limit = models.BooleanField(
        default=True,
        help_text=_('When enabled, deployment launches include terraform_override_limit=true.'),
    )
    extra_vars_schema = models.JSONField(
        blank=True,
        null=True,
        default=None,
        help_text=_(
            'JSON Schema describing the parameters presented to the user at deploy time. '
            'If null, no extra-var form is shown.'
        ),
    )
    cloud_backends = models.JSONField(
        blank=True,
        null=True,
        default=None,
        help_text=_(
            'Mapping of cloud provider id to TerraformJobTemplate pk for multi-cloud deployments. '
            'e.g. {"digitalocean": 5, "azure": 12}. When set, the deploy wizard offers a provider selector.'
        ),
    )
    provider_workflows = models.JSONField(
        blank=True,
        null=True,
        default=None,
        help_text=_(
            'Mapping of cloud provider slug to WorkflowJobTemplate pk whose survey drives the '
            'provider-specific deploy form fields. e.g. {"digitalocean": 25, "proxmox": 21}.'
        ),
    )
    provider_deprovision_workflows = models.JSONField(
        blank=True,
        null=True,
        default=None,
        help_text=_(
            'Mapping of cloud provider slug to WorkflowJobTemplate pk used to deprovision '
            'resources for that provider. e.g. {"digitalocean": 26, "proxmox": 22}.'
        ),
    )
    available_providers = models.JSONField(
        blank=True,
        null=True,
        default=None,
        help_text=_(
            'List of cloud provider slugs this catalog item is available on. '
            'Drives the provider tabs shown to users. e.g. ["digitalocean", "proxmox", "azure"]. '
            'If null, only providers in cloud_backends/provider_workflows are shown.'
        ),
    )
    provider_field_configs = models.JSONField(
        blank=True,
        null=True,
        default=None,
        help_text=_(
            'Per-provider deploy-form field configuration. '
            'Maps provider slug to {disabled_fields: [], hidden_fields: [], field_templates: {}}.'
        ),
    )

    # ------------------------------------------------------------------ #
    # RBAC roles                                                           #
    # ------------------------------------------------------------------ #
    admin_role = ImplicitRoleField(
        parent_role=['organization.admin_role'],
    )
    use_role = ImplicitRoleField(
        parent_role=['admin_role', 'organization.member_role'],
    )
    read_role = ImplicitRoleField(
        parent_role=['admin_role', 'use_role', 'organization.auditor_role'],
    )

    def get_absolute_url(self, request=None):
        return reverse('api:catalog_item_detail', kwargs={'pk': self.pk}, request=request)


DEPLOYMENT_STATUS_CHOICES = [
    ('pending', _('Pending')),
    ('provisioning', _('Provisioning')),
    ('active', _('Active')),
    ('deprovisioning', _('Deprovisioning')),
    ('failed', _('Failed')),
    ('destroyed', _('Destroyed')),
]


class CatalogDeployment(CommonModelNameNotUnique):
    """
    A concrete deployment created when a user provisions a CatalogItem.
    Tracks the lifecycle of the provisioned resource.
    """

    class Meta:
        app_label = 'main'
        ordering = ('-created',)
        default_permissions = ('change', 'delete', 'view')

    catalog_item = models.ForeignKey(
        'CatalogItem',
        related_name='deployments',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    owner = models.ForeignKey(
        User,
        related_name='catalog_deployments',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    status = models.CharField(
        max_length=32,
        choices=DEPLOYMENT_STATUS_CHOICES,
        default='pending',
    )
    provision_job = models.ForeignKey(
        'WorkflowJob',
        related_name='catalog_deployments_as_provision',
        null=True,
        blank=True,
        default=None,
        on_delete=models.SET_NULL,
    )
    terraform_provision_job = models.ForeignKey(
        'TerraformJob',
        related_name='catalog_deployments_as_terraform_provision',
        null=True,
        blank=True,
        default=None,
        on_delete=models.SET_NULL,
    )
    deprovision_job = models.ForeignKey(
        'WorkflowJob',
        related_name='catalog_deployments_as_deprovision',
        null=True,
        blank=True,
        default=None,
        on_delete=models.SET_NULL,
    )
    last_failed_workflow_job = models.ForeignKey(
        'WorkflowJob',
        related_name='catalog_deployments_as_last_failed',
        null=True,
        blank=True,
        default=None,
        on_delete=models.SET_NULL,
    )
    target_provider = models.CharField(
        max_length=128,
        blank=True,
        default='',
        help_text=_('Cloud provider slug selected at deploy time, used to route deprovision to the correct workflow.'),
    )
    extra_vars = models.JSONField(
        blank=True,
        null=True,
        default=None,
        help_text=_('Variable values supplied by the user at deploy time.'),
    )
    last_deprovision_vars = models.JSONField(
        blank=True,
        null=True,
        default=None,
        help_text=_('Resolved variables passed to the most recent deprovision workflow launch.'),
    )
    provisioning_history = models.JSONField(
        blank=True,
        default=list,
        help_text=_('Chronological record of provision/deprovision/retry job attempts for this deployment.'),
    )
    deployed_hosts = models.ManyToManyField(
        'Host',
        blank=True,
        related_name='catalog_deployments',
    )

    def append_history_entry(self, action, job=None, status='pending', details=None):
        history = list(self.provisioning_history or [])
        entry = {
            'action': action,
            'status': status,
            'created': now().isoformat(),
            'job_id': getattr(job, 'id', None),
            'job_type': getattr(job, 'polymorphic_ctype', None).model if getattr(job, 'polymorphic_ctype_id', None) else None,
        }
        if details:
            entry['details'] = details
        history.append(entry)
        self.provisioning_history = history

    def update_history_for_job(self, job_id, status):
        if not job_id:
            return
        history = list(self.provisioning_history or [])
        for entry in reversed(history):
            if entry.get('job_id') == job_id:
                entry['status'] = status
                entry['finished'] = now().isoformat()
                break
        self.provisioning_history = history

    def get_absolute_url(self, request=None):
        return reverse('api:catalog_deployment_detail', kwargs={'pk': self.pk}, request=request)


CLOUD_CONNECTION_STATUS_CHOICES = [
    ('connected', _('Connected')),
    ('disconnected', _('Disconnected')),
    ('misconfigured', _('Misconfigured')),
]


class CloudProviderConnection(models.Model):
    """
    A named connection entry linking a cloud provider to an AWX credential.
    Previously stored in browser localStorage; now persisted in the database.
    """

    class Meta:
        app_label = 'main'
        ordering = ('provider_id', 'name')

    provider_id = models.CharField(
        max_length=64,
        help_text=_('Identifier of the cloud provider (e.g. digitalocean, azure, proxmox).'),
    )
    name = models.CharField(
        max_length=512,
        help_text=_('Human-readable display name for this connection.'),
    )
    status = models.CharField(
        max_length=32,
        choices=CLOUD_CONNECTION_STATUS_CHOICES,
        default='disconnected',
    )
    credential = models.ForeignKey(
        'Credential',
        related_name='cloud_provider_connections',
        null=True,
        blank=True,
        default=None,
        on_delete=models.SET_NULL,
    )
    credential_name = models.CharField(
        max_length=512,
        blank=True,
        default='',
        help_text=_('Cached display name of the credential.'),
    )
    error = models.TextField(
        blank=True,
        default='',
        help_text=_('Last error message, if any.'),
    )
    updated_at = models.DateTimeField(auto_now=True)

    def get_absolute_url(self, request=None):
        return reverse('api:catalog_cloud_connection_detail', kwargs={'pk': self.pk}, request=request)


class CloudProviderState(models.Model):
    """
    Per-provider singleton storing pulled resource data and admin allow-list
    settings.  Previously stored in browser localStorage.
    """

    class Meta:
        app_label = 'main'
        ordering = ('provider_id',)

    provider_id = models.CharField(
        max_length=64,
        unique=True,
        help_text=_('Identifier of the cloud provider (e.g. digitalocean).'),
    )
    pulled_at = models.DateTimeField(
        null=True,
        blank=True,
        default=None,
        help_text=_('Timestamp of the last successful data pull.'),
    )
    provider_data = models.JSONField(
        null=True,
        blank=True,
        default=None,
        help_text=_('Raw pulled resource data (images, sizes, regions, VPCs, etc.).'),
    )
    admin_settings = models.JSONField(
        null=True,
        blank=True,
        default=None,
        help_text=_('Admin allow-list settings for this provider (e.g. allowed size slugs).'),
    )
    provider_settings = models.JSONField(
        null=True,
        blank=True,
        default=None,
        help_text=_('General provider settings (allow template pull, allowed networks, etc.).'),
    )

    def get_absolute_url(self, request=None):
        return reverse('api:catalog_cloud_provider_state_detail', kwargs={'provider_id': self.provider_id}, request=request)
