# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

from django.urls import re_path

from awx.api.views.quay import (
    QuayExecutionEnvironmentImageBuildPlanView,
    QuayRepositoryChangeVisibilityView,
    QuayRepositoryCreateView,
    QuayRepositoryDeleteView,
    QuayRepositoryUpdateView,
    QuayRepositoriesListView,
    QuayStatusView,
    QuayTagsListView,
)

quay_urls = [
    re_path(r'^status/$', QuayStatusView.as_view(), name='quay_status'),
    re_path(r'^repositories/$', QuayRepositoriesListView.as_view(), name='quay_repositories_list'),
    re_path(r'^repositories/create/$', QuayRepositoryCreateView.as_view(), name='quay_repository_create'),
    re_path(r'^repositories/update/$', QuayRepositoryUpdateView.as_view(), name='quay_repository_update'),
    re_path(r'^repositories/change-visibility/$', QuayRepositoryChangeVisibilityView.as_view(), name='quay_repository_change_visibility'),
    re_path(r'^repositories/delete/$', QuayRepositoryDeleteView.as_view(), name='quay_repository_delete'),
    re_path(r'^tags/$', QuayTagsListView.as_view(), name='quay_tags_list'),
    re_path(
        r'^execution-environment-images/build-plan/$',
        QuayExecutionEnvironmentImageBuildPlanView.as_view(),
        name='quay_execution_environment_image_build_plan',
    ),
]

__all__ = ['quay_urls']
