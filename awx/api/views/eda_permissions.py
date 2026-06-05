from django.db.models import Q
from rest_framework import permissions

from awx.main import models

EDA_VIEW_CODENAMES = ('view_edaactivation', 'execute_edaactivation', 'change_edaactivation')
EDA_OPERATE_CODENAMES = ('execute_edaactivation', 'change_edaactivation')
EDA_ADMIN_CODENAMES = ('change_edaactivation',)


def _has_dab_eda_permission(user, codenames):
    try:
        return user.has_roles.filter(permission_partials__codename__in=codenames).exists()
    except Exception:
        return False


def _has_org_role(user, role_fields):
    query = Q()
    for role_field in role_fields:
        query |= Q(pk__in=models.Organization.accessible_objects(user, role_field).values('pk'))
    return models.Organization.objects.filter(query).exists()


def user_can_view_eda_activations(user):
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser or user.is_system_auditor:
        return True
    return _has_dab_eda_permission(user, EDA_VIEW_CODENAMES) or _has_org_role(user, ('admin_role', 'auditor_role', 'eda_admin_role', 'eda_operator_role'))


def user_can_operate_eda_activations(user):
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    return _has_dab_eda_permission(user, EDA_OPERATE_CODENAMES) or _has_org_role(user, ('admin_role', 'eda_admin_role', 'eda_operator_role'))


def user_can_admin_eda_activations(user):
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    return _has_dab_eda_permission(user, EDA_ADMIN_CODENAMES) or _has_org_role(user, ('admin_role', 'eda_admin_role'))


class EDAActivationViewPermission(permissions.BasePermission):
    def has_permission(self, request, view):
        return user_can_view_eda_activations(request.user)


class EDAActivationOperatePermission(permissions.BasePermission):
    def has_permission(self, request, view):
        return user_can_operate_eda_activations(request.user)


class EDAActivationAdminPermission(permissions.BasePermission):
    def has_permission(self, request, view):
        return user_can_admin_eda_activations(request.user)


class EDAActivationStartPermission(permissions.BasePermission):
    def has_permission(self, request, view):
        data = request.data if isinstance(request.data, dict) else {}
        activation_id = str(data.get('activation_id') or data.get('id') or '').strip()
        rulebook_name = str(data.get('rulebook_name') or data.get('name') or '').strip()
        if activation_id and not rulebook_name:
            return user_can_operate_eda_activations(request.user)
        return user_can_admin_eda_activations(request.user)
