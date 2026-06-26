# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

from django.urls import re_path

from awx.api.views.eda import (
    EDAActivationActionView,
    EDAActivationDetailView,
    EDAActivationEventsView,
    EDAActivationListView,
    EDAActivationStartView,
    EDAEventStreamActivationsView,
    EDAProjectSyncView,
    EDARBACSyncView,
    EDAResourceDetailView,
    EDAResourceListView,
    EDAStatusView,
)

EDA_RESOURCE_PATTERN = (
    r'projects|rule-audit|decision-environments|event-streams|credentials|credential-types|rulebooks|'
    r'organizations|teams|users|role-definitions|user-role-assignments|team-role-assignments'
)

eda_urls = [
    re_path(r'^status/$', EDAStatusView.as_view(), name='eda_status'),
    re_path(r'^activations/start/$', EDAActivationStartView.as_view(), name='eda_activation_start'),
    re_path(r'^activations/(?P<pk>[^/]+)/events/$', EDAActivationEventsView.as_view(), name='eda_activation_events'),
    re_path(r'^activations/(?P<pk>[^/]+)/(?P<action>enable|disable|restart)/$', EDAActivationActionView.as_view(), name='eda_activation_action'),
    re_path(r'^activations/(?P<pk>[^/]+)/$', EDAActivationDetailView.as_view(), name='eda_activation_detail'),
    re_path(r'^activations/$', EDAActivationListView.as_view(), name='eda_activation_list'),
    re_path(r'^projects/(?P<pk>[^/]+)/sync/$', EDAProjectSyncView.as_view(), name='eda_project_sync'),
    re_path(r'^rbac-sync/$', EDARBACSyncView.as_view(), name='eda_rbac_sync'),
    re_path(r'^event-streams/(?P<pk>[^/]+)/activations/$', EDAEventStreamActivationsView.as_view(), name='eda_event_stream_activations'),
    re_path(rf'^(?P<resource>{EDA_RESOURCE_PATTERN})/(?P<pk>[^/]+)/$', EDAResourceDetailView.as_view(), name='eda_resource_detail'),
    re_path(rf'^(?P<resource>{EDA_RESOURCE_PATTERN})/$', EDAResourceListView.as_view(), name='eda_resource_list'),
]


__all__ = ['eda_urls']
