# Copyright (c) 2024 Red Hat, Inc.
# All Rights Reserved.

from django.urls import re_path

from awx.api.views.ai import AIChatView, AISettingsView

ai_urls = [
    re_path(r'^chat/$', AIChatView.as_view(), name='ai_chat'),
    re_path(r'^settings/$', AISettingsView.as_view(), name='ai_settings'),
]
