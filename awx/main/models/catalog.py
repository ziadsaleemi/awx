# Copyright (c) 2024 Red Hat, Inc.
# All Rights Reserved.

import logging

from django.db import models
from django.contrib.auth.models import User
from django.utils.translation import gettext_lazy as _

from awx.api.versioning import reverse
from awx.main.fields import ImplicitRoleField
from awx.main.models.base import CommonModelNameNotUnique

logger = logging.getLogger('awx.main.models.catalog')

__all__ = ['CatalogItem', 'CatalogDeployment']


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
    extra_vars_schema = models.JSONField(
        blank=True,
        null=True,
        default=None,
        help_text=_(
            'JSON Schema describing the parameters presented to the user at deploy time. '
            'If null, no extra-var form is shown.'
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
    extra_vars = models.JSONField(
        blank=True,
        null=True,
        default=None,
        help_text=_('Variable values supplied by the user at deploy time.'),
    )
    deployed_hosts = models.ManyToManyField(
        'Host',
        blank=True,
        related_name='catalog_deployments',
    )

    def get_absolute_url(self, request=None):
        return reverse('api:catalog_deployment_detail', kwargs={'pk': self.pk}, request=request)
