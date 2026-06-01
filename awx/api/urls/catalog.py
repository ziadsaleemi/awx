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
    CatalogDeploymentCancel,
    CatalogDigitalOceanConnectorValidate,
    CatalogDigitalOceanPullImages,
    CatalogProxmoxPullResources,
    CatalogVmwarePullResources,
    CatalogAzurePullResources,
    CloudProviderConnectionList,
    CloudProviderConnectionDetail,
    CloudProviderInventorySuggestions,
    CloudProviderStateDetail,
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
    re_path(r'^(?P<pk>[0-9]+)/cancel/$', CatalogDeploymentCancel.as_view(), name='catalog_deployment_cancel'),
]

catalog_cloud_urls = [
    re_path(
        r'^connections/$',
        CloudProviderConnectionList.as_view(),
        name='catalog_cloud_connection_list',
    ),
    re_path(
        r'^connections/(?P<pk>[0-9]+)/$',
        CloudProviderConnectionDetail.as_view(),
        name='catalog_cloud_connection_detail',
    ),
    re_path(
        r'^provider_state/(?P<provider_id>[a-z0-9_-]+)/$',
        CloudProviderStateDetail.as_view(),
        name='catalog_cloud_provider_state_detail',
    ),
    re_path(
        r'^provider_state/(?P<provider_id>[a-z0-9_-]+)/inventory_suggestions/$',
        CloudProviderInventorySuggestions.as_view(),
        name='catalog_cloud_provider_inventory_suggestions',
    ),
    re_path(
        r'^connectors/digitalocean/validate/$',
        CatalogDigitalOceanConnectorValidate.as_view(),
        name='catalog_cloud_digitalocean_validate',
    ),
    re_path(
        r'^connectors/digitalocean/pull_images/$',
        CatalogDigitalOceanPullImages.as_view(),
        name='catalog_cloud_digitalocean_pull_images',
    ),
    re_path(
        r'^connectors/proxmox/pull_resources/$',
        CatalogProxmoxPullResources.as_view(),
        name='catalog_cloud_proxmox_pull_resources',
    ),
    re_path(
        r'^connectors/vmware/pull_resources/$',
        CatalogVmwarePullResources.as_view(),
        name='catalog_cloud_vmware_pull_resources',
    ),
    re_path(
        r'^connectors/azure/pull_resources/$',
        CatalogAzurePullResources.as_view(),
        name='catalog_cloud_azure_pull_resources',
    ),
]
