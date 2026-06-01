# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

from django.urls import re_path

from awx.api.views.eda import EDAActivationListView, EDAStatusView


eda_urls = [
    re_path(r'^status/$', EDAStatusView.as_view(), name='eda_status'),
    re_path(r'^activations/$', EDAActivationListView.as_view(), name='eda_activation_list'),
]


__all__ = ['eda_urls']
