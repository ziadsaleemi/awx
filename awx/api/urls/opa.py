"""URL patterns for the AWX OPA guardrails endpoints."""

from django.urls import re_path

from awx.api.views.opa import OPAPolicyEvaluateView, OPAPolicyListView

opa_urls = [
    re_path(r'^policies/$', OPAPolicyListView.as_view(), name='opa_policies'),
    re_path(r'^evaluate/$', OPAPolicyEvaluateView.as_view(), name='opa_evaluate'),
]
