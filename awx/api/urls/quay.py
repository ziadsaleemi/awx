# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

from django.urls import re_path

from awx.api.views.quay import (
    QuayExecutionEnvironmentImageBuildPlanView,
    QuayRepositoriesListView,
    QuayStatusView,
    QuayTagsListView,
)

quay_urls = [
    re_path(r'^status/$', QuayStatusView.as_view(), name='quay_status'),
    re_path(r'^repositories/$', QuayRepositoriesListView.as_view(), name='quay_repositories_list'),
    re_path(r'^tags/$', QuayTagsListView.as_view(), name='quay_tags_list'),
    re_path(
        r'^execution-environment-images/build-plan/$',
        QuayExecutionEnvironmentImageBuildPlanView.as_view(),
        name='quay_execution_environment_image_build_plan',
    ),
]

__all__ = ['quay_urls']
