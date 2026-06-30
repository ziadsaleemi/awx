# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

from django.urls import re_path

from awx.api.views.galaxy_ng import (
    GalaxyNGCollectionApprovalApproveView,
    GalaxyNGCollectionApprovalRejectView,
    GalaxyNGCollectionsListView,
    GalaxyNGExecutionEnvironmentImageBuildPlanView,
    GalaxyNGExecutionEnvironmentImagesListView,
    GalaxyNGCollectionApprovalsListView,
    GalaxyNGNamespacesListView,
    GalaxyNGRemoteRegistriesListView,
    GalaxyNGRemotesListView,
    GalaxyNGRepositorySyncView,
    GalaxyNGRepositoriesListView,
    GalaxyNGSignatureKeysListView,
    GalaxyNGStatusView,
    GalaxyNGTasksListView,
)

galaxy_ng_urls = [
    re_path(r'^status/$', GalaxyNGStatusView.as_view(), name='galaxy_ng_status'),
    re_path(r'^namespaces/$', GalaxyNGNamespacesListView.as_view(), name='galaxy_ng_namespaces_list'),
    re_path(r'^collections/$', GalaxyNGCollectionsListView.as_view(), name='galaxy_ng_collections_list'),
    re_path(r'^repositories/$', GalaxyNGRepositoriesListView.as_view(), name='galaxy_ng_repositories_list'),
    re_path(r'^repositories/sync/$', GalaxyNGRepositorySyncView.as_view(), name='galaxy_ng_repository_sync'),
    re_path(r'^remotes/$', GalaxyNGRemotesListView.as_view(), name='galaxy_ng_remotes_list'),
    re_path(r'^remote-registries/$', GalaxyNGRemoteRegistriesListView.as_view(), name='galaxy_ng_remote_registries_list'),
    re_path(r'^signature-keys/$', GalaxyNGSignatureKeysListView.as_view(), name='galaxy_ng_signature_keys_list'),
    re_path(r'^collection-approvals/$', GalaxyNGCollectionApprovalsListView.as_view(), name='galaxy_ng_collection_approvals_list'),
    re_path(r'^collection-approvals/approve/$', GalaxyNGCollectionApprovalApproveView.as_view(), name='galaxy_ng_collection_approval_approve'),
    re_path(r'^collection-approvals/reject/$', GalaxyNGCollectionApprovalRejectView.as_view(), name='galaxy_ng_collection_approval_reject'),
    re_path(
        r'^execution-environment-images/$',
        GalaxyNGExecutionEnvironmentImagesListView.as_view(),
        name='galaxy_ng_execution_environment_images_list',
    ),
    re_path(
        r'^execution-environment-images/build-plan/$',
        GalaxyNGExecutionEnvironmentImageBuildPlanView.as_view(),
        name='galaxy_ng_execution_environment_image_build_plan',
    ),
    re_path(r'^tasks/$', GalaxyNGTasksListView.as_view(), name='galaxy_ng_tasks_list'),
]


__all__ = ['galaxy_ng_urls']
