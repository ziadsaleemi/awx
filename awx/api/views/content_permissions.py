# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

from django.db.models import Q
from rest_framework import permissions

from awx.main import models

AUTOMATION_HUB_VIEW_CODENAMES = (
    'view_project',
    'use_project',
    'update_project',
    'add_project',
    'change_project',
    'delete_project',
    'view_credential',
    'use_credential',
    'add_credential',
    'change_credential',
    'delete_credential',
    'view_organization',
    'member_organization',
    'audit_organization',
    'add_organization',
    'change_organization',
    'delete_organization',
)
AUTOMATION_HUB_MANAGE_CODENAMES = (
    'update_project',
    'add_project',
    'change_project',
    'delete_project',
)
QUAY_VIEW_CODENAMES = (
    'view_project',
    'use_project',
    'update_project',
    'add_project',
    'change_project',
    'delete_project',
    'view_executionenvironment',
    'add_executionenvironment',
    'change_executionenvironment',
    'delete_executionenvironment',
)
QUAY_MANAGE_CODENAMES = (
    'update_project',
    'add_project',
    'change_project',
    'delete_project',
    'add_executionenvironment',
    'change_executionenvironment',
    'delete_executionenvironment',
)


def _has_dab_permission(user, codenames):
    try:
        return user.has_roles.filter(permission_partials__codename__in=codenames).exists()
    except Exception:
        return False


def _has_org_role(user, role_fields):
    query = Q()
    for role_field in role_fields:
        query |= Q(pk__in=models.Organization.accessible_objects(user, role_field).values('pk'))
    return models.Organization.objects.filter(query).exists()


def _has_project_role(user, role_fields):
    query = Q()
    for role_field in role_fields:
        query |= Q(pk__in=models.Project.accessible_objects(user, role_field).values('pk'))
    return models.Project.objects.filter(query).exists()


def user_can_view_automation_hub(user):
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser or user.is_system_auditor:
        return True
    return (
        _has_dab_permission(user, AUTOMATION_HUB_VIEW_CODENAMES)
        or _has_org_role(user, ('admin_role', 'auditor_role', 'member_role', 'project_admin_role', 'credential_admin_role'))
        or _has_project_role(user, ('read_role', 'use_role', 'update_role', 'admin_role'))
    )


def user_can_manage_automation_hub(user):
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    return (
        _has_dab_permission(user, AUTOMATION_HUB_MANAGE_CODENAMES)
        or _has_org_role(user, ('admin_role', 'project_admin_role'))
        or _has_project_role(user, ('update_role', 'admin_role'))
    )


def user_can_admin_automation_hub(user):
    return bool(user and user.is_authenticated and user.is_superuser)


def user_can_view_quay(user):
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser or user.is_system_auditor:
        return True
    return (
        _has_dab_permission(user, QUAY_VIEW_CODENAMES)
        or _has_org_role(user, ('admin_role', 'auditor_role', 'member_role', 'project_admin_role', 'execution_environment_admin_role'))
        or _has_project_role(user, ('read_role', 'use_role', 'update_role', 'admin_role'))
    )


def user_can_manage_quay(user):
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    return (
        _has_dab_permission(user, QUAY_MANAGE_CODENAMES)
        or _has_org_role(user, ('admin_role', 'project_admin_role', 'execution_environment_admin_role'))
        or _has_project_role(user, ('update_role', 'admin_role'))
    )


class AutomationHubViewPermission(permissions.BasePermission):
    def has_permission(self, request, view):
        return user_can_view_automation_hub(request.user)


class AutomationHubManagePermission(permissions.BasePermission):
    def has_permission(self, request, view):
        return user_can_manage_automation_hub(request.user)


class AutomationHubAdminPermission(permissions.BasePermission):
    def has_permission(self, request, view):
        return user_can_admin_automation_hub(request.user)


class QuayViewPermission(permissions.BasePermission):
    def has_permission(self, request, view):
        return user_can_view_quay(request.user)


class QuayManagePermission(permissions.BasePermission):
    def has_permission(self, request, view):
        return user_can_manage_quay(request.user)
