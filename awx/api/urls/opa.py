"""URL patterns for the AWX OPA guardrails endpoints."""

from django.urls import re_path

from awx.api.views.gatekeeper import (
    GatekeeperPolicyApplyView,
    GatekeeperPolicyAuthorView,
    GatekeeperPolicyDeleteView,
    GatekeeperPolicyManagerView,
    GatekeeperProjectSyncView,
    GatekeeperPolicyRemediationView,
    GatekeeperPolicyRollbackView,
)
from awx.api.views.opa import (
    OPAActivityView,
    OPAPolicyEvaluateView,
    OPAPolicyListView,
    OPAPolicyModuleDetailView,
    OPAPolicyModuleListView,
    OPAPolicyModuleProjectSyncView,
    OPAPolicyModuleRollbackView,
    OPAPolicyModuleVersionsView,
    OPAPolicySyncView,
)

opa_urls = [
    re_path(r'^gatekeeper/$', GatekeeperPolicyManagerView.as_view(), name='opa_gatekeeper'),
    re_path(r'^gatekeeper/author/$', GatekeeperPolicyAuthorView.as_view(), name='opa_gatekeeper_author'),
    re_path(r'^gatekeeper/project-sync/$', GatekeeperProjectSyncView.as_view(), name='opa_gatekeeper_project_sync'),
    re_path(r'^gatekeeper/remediate/$', GatekeeperPolicyRemediationView.as_view(), name='opa_gatekeeper_remediate'),
    re_path(r'^gatekeeper/apply/$', GatekeeperPolicyApplyView.as_view(), name='opa_gatekeeper_apply'),
    re_path(r'^gatekeeper/delete/$', GatekeeperPolicyDeleteView.as_view(), name='opa_gatekeeper_delete'),
    re_path(r'^gatekeeper/rollback/$', GatekeeperPolicyRollbackView.as_view(), name='opa_gatekeeper_rollback'),
    re_path(r'^policies/$', OPAPolicyListView.as_view(), name='opa_policies'),
    re_path(r'^policies/sync/$', OPAPolicySyncView.as_view(), name='opa_policies_sync'),
    re_path(r'^activity/$', OPAActivityView.as_view(), name='opa_activity'),
    re_path(r'^policy-modules/$', OPAPolicyModuleListView.as_view(), name='opa_policy_modules'),
    re_path(r'^policy-modules/project-sync/$', OPAPolicyModuleProjectSyncView.as_view(), name='opa_policy_module_project_sync'),
    re_path(r'^policy-modules/(?P<policy_id>.+)/versions/$', OPAPolicyModuleVersionsView.as_view(), name='opa_policy_module_versions'),
    re_path(r'^policy-modules/(?P<policy_id>.+)/rollback/$', OPAPolicyModuleRollbackView.as_view(), name='opa_policy_module_rollback'),
    re_path(r'^policy-modules/(?P<policy_id>.+)/$', OPAPolicyModuleDetailView.as_view(), name='opa_policy_module_detail'),
    re_path(r'^evaluate/$', OPAPolicyEvaluateView.as_view(), name='opa_evaluate'),
]
