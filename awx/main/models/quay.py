# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

from django.db import models
from django.utils.translation import gettext_lazy as _

from awx.api.versioning import reverse
from awx.main.models.base import PrimordialModel

__all__ = ['QuayImageBuild']


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

    @property
    def repository_path(self):
        return f'{self.namespace}/{self.repository}'

    def get_absolute_url(self, request=None):
        return reverse('api:quay_image_build_detail', kwargs={'pk': self.pk}, request=request)
