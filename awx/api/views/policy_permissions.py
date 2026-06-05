from django.db.models import Q
from rest_framework import permissions

from awx.main import models


POLICY_VIEW_CODENAMES = ('view_policyascode', 'change_policyascode')
POLICY_OPERATE_CODENAMES = ('view_policyascode', 'change_policyascode')
POLICY_AUTHOR_CODENAMES = ('change_policyascode',)


def _has_dab_policy_permission(user, codenames):
    try:
        return user.has_roles.filter(permission_partials__codename__in=codenames).exists()
    except Exception:
        return False


def _has_org_role(user, role_fields):
    query = Q()
    for role_field in role_fields:
        query |= Q(pk__in=models.Organization.accessible_objects(user, role_field).values('pk'))
    return models.Organization.objects.filter(query).exists()


def user_can_view_policy_as_code(user):
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser or user.is_system_auditor:
        return True
    return _has_dab_policy_permission(user, POLICY_VIEW_CODENAMES) or _has_org_role(
        user, ('admin_role', 'auditor_role', 'policy_author_role', 'policy_operator_role')
    )


def user_can_operate_policy_as_code(user):
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    return _has_dab_policy_permission(user, POLICY_OPERATE_CODENAMES) or _has_org_role(
        user, ('admin_role', 'policy_author_role', 'policy_operator_role')
    )


def user_can_author_policy_as_code(user):
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    return _has_dab_policy_permission(user, POLICY_AUTHOR_CODENAMES) or _has_org_role(user, ('admin_role', 'policy_author_role'))


class PolicyAsCodeViewPermission(permissions.BasePermission):
    def has_permission(self, request, view):
        return user_can_view_policy_as_code(request.user)


class PolicyAsCodeOperatePermission(permissions.BasePermission):
    def has_permission(self, request, view):
        return user_can_operate_policy_as_code(request.user)


class PolicyAsCodeAuthorPermission(permissions.BasePermission):
    def has_permission(self, request, view):
        return user_can_author_policy_as_code(request.user)


class GatekeeperGovernedWritePermission(permissions.BasePermission):
    def has_permission(self, request, view):
        data = request.data if isinstance(request.data, dict) else {}
        mode = str(data.get('mode') or '').strip().lower()
        if mode in ('apply', 'delete'):
            return user_can_author_policy_as_code(request.user)
        return user_can_operate_policy_as_code(request.user)


class ExternalAutomationCheckPermission(permissions.BasePermission):
    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if user.is_superuser:
            return True

        data = request.data if isinstance(request.data, dict) else {}
        include_eda = bool(data.get('include_eda', True))
        uses_eda_write = any(
            bool(data.get(key))
            for key in (
                'start_eda_activation',
                'eda_activation_id',
                'eda_event_source',
                'eda_include_events',
                'cleanup_eda_activation',
            )
        )
        if include_eda or uses_eda_write:
            return False

        include_opa = bool(data.get('include_opa', True))
        include_gatekeeper = bool(data.get('include_gatekeeper', False))
        policy_smoke_requested = include_opa or include_gatekeeper or bool(data.get('sync_opa_policy')) or bool(data.get('opa_deny_smoke'))
        return policy_smoke_requested and user_can_operate_policy_as_code(user)
