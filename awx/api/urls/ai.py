# Copyright (c) 2024 Red Hat, Inc.
# All Rights Reserved.

from django.urls import re_path

from awx.api.views.ai import (
    AIChatView,
    AISettingsView,
    OpenAICodexDefaultModelView,
    OpenAICodexDeviceCodePollView,
    OpenAICodexDeviceCodeStartView,
    OpenAICodexModelsRefreshView,
    OpenAICodexModelsView,
)

ai_urls = [
    re_path(r'^chat/$', AIChatView.as_view(), name='ai_chat'),
    re_path(r'^settings/$', AISettingsView.as_view(), name='ai_settings'),
    re_path(r'^openai_codex/device_code/start/$', OpenAICodexDeviceCodeStartView.as_view(), name='ai_openai_codex_device_code_start'),
    re_path(r'^openai_codex/device_code/poll/$', OpenAICodexDeviceCodePollView.as_view(), name='ai_openai_codex_device_code_poll'),
    re_path(r'^openai_codex/models/$', OpenAICodexModelsView.as_view(), name='ai_openai_codex_models'),
    re_path(r'^openai_codex/models/refresh/$', OpenAICodexModelsRefreshView.as_view(), name='ai_openai_codex_models_refresh'),
    re_path(r'^openai_codex/models/default/$', OpenAICodexDefaultModelView.as_view(), name='ai_openai_codex_models_default'),
]
