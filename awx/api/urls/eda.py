# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

from django.urls import re_path

from awx.api.views.eda import (
    EDAActivationActionView,
    EDAActivationDetailView,
    EDAActivationEventsView,
    EDAActivationListView,
    EDAActivationStartView,
    EDAStatusView,
)

eda_urls = [
    re_path(r'^status/$', EDAStatusView.as_view(), name='eda_status'),
    re_path(r'^activations/start/$', EDAActivationStartView.as_view(), name='eda_activation_start'),
    re_path(r'^activations/(?P<pk>[^/]+)/events/$', EDAActivationEventsView.as_view(), name='eda_activation_events'),
    re_path(r'^activations/(?P<pk>[^/]+)/(?P<action>enable|disable|restart)/$', EDAActivationActionView.as_view(), name='eda_activation_action'),
    re_path(r'^activations/(?P<pk>[^/]+)/$', EDAActivationDetailView.as_view(), name='eda_activation_detail'),
    re_path(r'^activations/$', EDAActivationListView.as_view(), name='eda_activation_list'),
]


__all__ = ['eda_urls']
