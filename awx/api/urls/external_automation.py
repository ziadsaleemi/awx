"""URL patterns for external automation smoke checks."""

from django.urls import re_path

from awx.api.views.external_automation import ExternalAutomationCheckView

external_automation_urls = [
    re_path(r'^check/$', ExternalAutomationCheckView.as_view(), name='external_automation_check'),
]


__all__ = ['external_automation_urls']
