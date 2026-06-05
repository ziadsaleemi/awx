# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

from django.urls import re_path

from awx.api.views import UserTypeCopy, UserTypeDetail, UserTypeList

urls = [
    re_path(r'^$', UserTypeList.as_view(), name='user_type_list'),
    re_path(r'^(?P<pk>[0-9]+)/$', UserTypeDetail.as_view(), name='user_type_detail'),
    re_path(r'^(?P<pk>[0-9]+)/copy/$', UserTypeCopy.as_view(), name='user_type_copy'),
]

__all__ = ['urls']
