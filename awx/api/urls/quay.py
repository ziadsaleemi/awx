# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

from django.urls import re_path

from awx.api.views.quay import (
    QuayApiTokenPlanView,
    QuayExecutionEnvironmentImageBuildTemplateDetailView,
    QuayExecutionEnvironmentImageBuildTemplateLaunchView,
    QuayExecutionEnvironmentImageBuildTemplatesView,
    QuayExecutionEnvironmentImageBuildDetailView,
    QuayExecutionEnvironmentImageBuildsView,
    QuayExecutionEnvironmentImageBuildPlanView,
    QuayRepositoryPermissionsView,
    QuayRepositoryChangeVisibilityView,
    QuayRepositoryCreateView,
    QuayRepositoryDeleteView,
    QuayRepositoryTeamPermissionDeleteView,
    QuayRepositoryTeamPermissionSetView,
    QuayRepositoryUpdateView,
    QuayRepositoryUserPermissionDeleteView,
    QuayRepositoryUserPermissionSetView,
    QuayRepositoriesListView,
    QuayRobotCreateView,
    QuayRobotDeleteView,
    QuayRobotRegenerateTokenView,
    QuayRobotsListView,
    QuayTagDeleteView,
    QuayStatusView,
    QuayTagsListView,
)

quay_urls = [
    re_path(r'^status/$', QuayStatusView.as_view(), name='quay_status'),
    re_path(r'^api-token-plan/$', QuayApiTokenPlanView.as_view(), name='quay_api_token_plan'),
    re_path(r'^repositories/$', QuayRepositoriesListView.as_view(), name='quay_repositories_list'),
    re_path(r'^repositories/create/$', QuayRepositoryCreateView.as_view(), name='quay_repository_create'),
    re_path(r'^repositories/update/$', QuayRepositoryUpdateView.as_view(), name='quay_repository_update'),
    re_path(r'^repositories/change-visibility/$', QuayRepositoryChangeVisibilityView.as_view(), name='quay_repository_change_visibility'),
    re_path(r'^repositories/delete/$', QuayRepositoryDeleteView.as_view(), name='quay_repository_delete'),
    re_path(r'^repositories/permissions/$', QuayRepositoryPermissionsView.as_view(), name='quay_repository_permissions'),
    re_path(r'^repositories/permissions/user/set/$', QuayRepositoryUserPermissionSetView.as_view(), name='quay_repository_user_permission_set'),
    re_path(r'^repositories/permissions/user/delete/$', QuayRepositoryUserPermissionDeleteView.as_view(), name='quay_repository_user_permission_delete'),
    re_path(r'^repositories/permissions/team/set/$', QuayRepositoryTeamPermissionSetView.as_view(), name='quay_repository_team_permission_set'),
    re_path(r'^repositories/permissions/team/delete/$', QuayRepositoryTeamPermissionDeleteView.as_view(), name='quay_repository_team_permission_delete'),
    re_path(r'^robots/$', QuayRobotsListView.as_view(), name='quay_robots_list'),
    re_path(r'^robots/create/$', QuayRobotCreateView.as_view(), name='quay_robot_create'),
    re_path(r'^robots/delete/$', QuayRobotDeleteView.as_view(), name='quay_robot_delete'),
    re_path(r'^robots/regenerate-token/$', QuayRobotRegenerateTokenView.as_view(), name='quay_robot_regenerate_token'),
    re_path(r'^tags/$', QuayTagsListView.as_view(), name='quay_tags_list'),
    re_path(r'^tags/delete/$', QuayTagDeleteView.as_view(), name='quay_tag_delete'),
    re_path(
        r'^execution-environment-images/build-plan/$',
        QuayExecutionEnvironmentImageBuildPlanView.as_view(),
        name='quay_execution_environment_image_build_plan',
    ),
    re_path(
        r'^execution-environment-images/templates/$',
        QuayExecutionEnvironmentImageBuildTemplatesView.as_view(),
        name='quay_image_build_templates',
    ),
    re_path(
        r'^execution-environment-images/templates/(?P<pk>[0-9]+)/$',
        QuayExecutionEnvironmentImageBuildTemplateDetailView.as_view(),
        name='quay_image_build_template_detail',
    ),
    re_path(
        r'^execution-environment-images/templates/(?P<pk>[0-9]+)/launch/$',
        QuayExecutionEnvironmentImageBuildTemplateLaunchView.as_view(),
        name='quay_image_build_template_launch',
    ),
    re_path(
        r'^execution-environment-images/builds/$',
        QuayExecutionEnvironmentImageBuildsView.as_view(),
        name='quay_image_builds',
    ),
    re_path(
        r'^execution-environment-images/builds/(?P<pk>[0-9]+)/$',
        QuayExecutionEnvironmentImageBuildDetailView.as_view(),
        name='quay_image_build_detail',
    ),
]

__all__ = ['quay_urls']
