# Copyright (c) 2024 Red Hat, Inc.
# All Rights Reserved.

from django.urls import re_path

from awx.api.views import (
    CatalogItemList,
    CatalogItemDetail,
    CatalogItemDeploymentsList,
    CatalogItemDeploy,
    CatalogItemDeploySurvey,
    CatalogDeploymentList,
    CatalogDeploymentDetail,
    CatalogDeploymentDeprovision,
    CatalogDeploymentRetry,
)

catalog_item_urls = [
    re_path(r'^$', CatalogItemList.as_view(), name='catalog_item_list'),
    re_path(r'^(?P<pk>[0-9]+)/$', CatalogItemDetail.as_view(), name='catalog_item_detail'),
    re_path(r'^(?P<pk>[0-9]+)/deployments/$', CatalogItemDeploymentsList.as_view(), name='catalog_item_deployments_list'),
    re_path(r'^(?P<pk>[0-9]+)/deploy/$', CatalogItemDeploy.as_view(), name='catalog_item_deploy'),
    re_path(r'^(?P<pk>[0-9]+)/deploy_survey/$', CatalogItemDeploySurvey.as_view(), name='catalog_item_deploy_survey'),
]

catalog_deployment_urls = [
    re_path(r'^$', CatalogDeploymentList.as_view(), name='catalog_deployment_list'),
    re_path(r'^(?P<pk>[0-9]+)/$', CatalogDeploymentDetail.as_view(), name='catalog_deployment_detail'),
    re_path(r'^(?P<pk>[0-9]+)/deprovision/$', CatalogDeploymentDeprovision.as_view(), name='catalog_deployment_deprovision'),
    re_path(r'^(?P<pk>[0-9]+)/retry/$', CatalogDeploymentRetry.as_view(), name='catalog_deployment_retry'),
]
