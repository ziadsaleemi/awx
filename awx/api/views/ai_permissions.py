from django.db.models import Q
from rest_framework import permissions

from awx.main import models

AI_VIEW_CODENAMES = ('view_airesourceaction', 'change_airesourceaction', 'approve_airesourceaction')
AI_AUTHOR_CODENAMES = ('change_airesourceaction',)
AI_APPROVER_CODENAMES = ('approve_airesourceaction',)


def _has_dab_ai_permission(user, codenames):
    try:
        return user.has_roles.filter(permission_partials__codename__in=codenames).exists()
    except Exception:
        return False


def _has_org_role(user, role_fields, organization=None):
    query = Q()
    for role_field in role_fields:
        accessible = models.Organization.accessible_objects(user, role_field)
        if organization is not None and getattr(organization, 'pk', None):
            accessible = accessible.filter(pk=organization.pk)
        query |= Q(pk__in=accessible.values('pk'))
    return models.Organization.objects.filter(query).exists()


def user_can_view_ai_resources(user, organization=None):
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser or user.is_system_auditor:
        return True
    return _has_dab_ai_permission(user, AI_VIEW_CODENAMES) or _has_org_role(
        user, ('admin_role', 'auditor_role', 'ai_author_role', 'ai_approver_role'), organization=organization
    )


def user_can_author_ai_resources(user, organization=None):
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    return _has_dab_ai_permission(user, AI_AUTHOR_CODENAMES) or _has_org_role(user, ('admin_role', 'ai_author_role'), organization=organization)


def user_can_approve_ai_resources(user, organization=None):
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    return _has_dab_ai_permission(user, AI_APPROVER_CODENAMES) or _has_org_role(user, ('admin_role', 'ai_approver_role'), organization=organization)


class AIResourceActionPermission(permissions.BasePermission):
    def has_permission(self, request, view):
        return user_can_author_ai_resources(request.user)
