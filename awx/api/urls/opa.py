"""URL patterns for the AWX OPA guardrails endpoints."""

from django.urls import re_path

from awx.api.views.gatekeeper import GatekeeperPolicyApplyView, GatekeeperPolicyManagerView
from awx.api.views.opa import OPAPolicyEvaluateView, OPAPolicyListView, OPAPolicyModuleDetailView, OPAPolicyModuleListView, OPAPolicySyncView

opa_urls = [
    re_path(r'^gatekeeper/$', GatekeeperPolicyManagerView.as_view(), name='opa_gatekeeper'),
    re_path(r'^gatekeeper/apply/$', GatekeeperPolicyApplyView.as_view(), name='opa_gatekeeper_apply'),
    re_path(r'^policies/$', OPAPolicyListView.as_view(), name='opa_policies'),
    re_path(r'^policies/sync/$', OPAPolicySyncView.as_view(), name='opa_policies_sync'),
    re_path(r'^policy-modules/$', OPAPolicyModuleListView.as_view(), name='opa_policy_modules'),
    re_path(r'^policy-modules/(?P<policy_id>.+)/$', OPAPolicyModuleDetailView.as_view(), name='opa_policy_module_detail'),
    re_path(r'^evaluate/$', OPAPolicyEvaluateView.as_view(), name='opa_evaluate'),
]
