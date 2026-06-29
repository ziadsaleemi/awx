# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

from django.urls import re_path

from awx.api.views.galaxy_ng import GalaxyNGStatusView


galaxy_ng_urls = [
    re_path(r'^status/$', GalaxyNGStatusView.as_view(), name='galaxy_ng_status'),
]


__all__ = ['galaxy_ng_urls']
