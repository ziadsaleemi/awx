# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

from django.urls import re_path

from awx.api.views.galaxy_ng import (
    GalaxyNGCollectionsListView,
    GalaxyNGNamespacesListView,
    GalaxyNGRepositorySyncView,
    GalaxyNGRepositoriesListView,
    GalaxyNGStatusView,
    GalaxyNGTasksListView,
)


galaxy_ng_urls = [
    re_path(r'^status/$', GalaxyNGStatusView.as_view(), name='galaxy_ng_status'),
    re_path(r'^namespaces/$', GalaxyNGNamespacesListView.as_view(), name='galaxy_ng_namespaces_list'),
    re_path(r'^collections/$', GalaxyNGCollectionsListView.as_view(), name='galaxy_ng_collections_list'),
    re_path(r'^repositories/$', GalaxyNGRepositoriesListView.as_view(), name='galaxy_ng_repositories_list'),
    re_path(r'^repositories/sync/$', GalaxyNGRepositorySyncView.as_view(), name='galaxy_ng_repository_sync'),
    re_path(r'^tasks/$', GalaxyNGTasksListView.as_view(), name='galaxy_ng_tasks_list'),
]


__all__ = ['galaxy_ng_urls']
