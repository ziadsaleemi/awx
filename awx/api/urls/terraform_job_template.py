# Copyright (c) 2024 Red Hat, Inc.
# All Rights Reserved.

from django.urls import re_path

from awx.api.views import (
    TerraformJobTemplateList,
    TerraformJobTemplateDetail,
    TerraformJobTemplateLaunch,
    TerraformJobTemplateJobsList,
    TerraformJobTemplateCredentialsList,
    TerraformJobList,
    TerraformJobDetail,
    TerraformJobCancel,
    TerraformJobEventsList,
)

terraform_job_template_urls = [
    re_path(r'^$', TerraformJobTemplateList.as_view(), name='terraform_job_template_list'),
    re_path(r'^(?P<pk>[0-9]+)/$', TerraformJobTemplateDetail.as_view(), name='terraform_job_template_detail'),
    re_path(r'^(?P<pk>[0-9]+)/launch/$', TerraformJobTemplateLaunch.as_view(), name='terraform_job_template_launch'),
    re_path(r'^(?P<pk>[0-9]+)/jobs/$', TerraformJobTemplateJobsList.as_view(), name='terraform_job_template_jobs_list'),
    re_path(r'^(?P<pk>[0-9]+)/credentials/$', TerraformJobTemplateCredentialsList.as_view(), name='terraform_job_template_credentials_list'),
]

terraform_job_urls = [
    re_path(r'^$', TerraformJobList.as_view(), name='terraform_job_list'),
    re_path(r'^(?P<pk>[0-9]+)/$', TerraformJobDetail.as_view(), name='terraform_job_detail'),
    re_path(r'^(?P<pk>[0-9]+)/cancel/$', TerraformJobCancel.as_view(), name='terraform_job_cancel'),
    re_path(r'^(?P<pk>[0-9]+)/events/$', TerraformJobEventsList.as_view(), name='terraform_job_events_list'),
]
