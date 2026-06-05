import pytest

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.utils.text import slugify

from ansible_base.rbac.models import RoleDefinition

from awx.main.management.commands.seed_access_matrix import DEFAULT_PASSWORD
from awx.main.models import UserType, UserTypeAssignment


def _username(prefix, role_name):
    return f'{prefix}-{slugify(role_name)}'[:150]


@pytest.mark.django_db
def test_seed_access_matrix_creates_user_for_every_role(setup_managed_roles, credentialtype_ssh):
    prefix = 'test-access-matrix'

    call_command('seed_access_matrix', '--prefix', prefix, '--password', DEFAULT_PASSWORD)

    User = get_user_model()
    role_definitions = list(RoleDefinition.objects.select_related('content_type').prefetch_related('permissions').order_by('name'))

    assert User.objects.filter(username__in=[f'{prefix}-system-admin', f'{prefix}-system-auditor', f'{prefix}-no-access']).count() == 3
    assert User.objects.get(username=f'{prefix}-system-admin').is_superuser
    assert User.objects.get(username=f'{prefix}-system-auditor').is_system_auditor
    assert not User.objects.get(username=f'{prefix}-no-access').role_assignments.exists()

    for role_definition in role_definitions:
        user = User.objects.get(username=_username(prefix, role_definition.name))
        assert user.check_password(DEFAULT_PASSWORD)

        if role_definition.name == 'Platform Auditor':
            assert user.is_system_auditor
            assert not UserTypeAssignment.objects.filter(user=user).exists()
            continue

        assert UserTypeAssignment.objects.filter(user=user, user_type__role_definitions=role_definition).exists()
        assert user.role_assignments.filter(role_definition=role_definition).exists()

    all_roles_user = User.objects.get(username=f'{prefix}-all-roles')
    assigned_role_names = set(all_roles_user.role_assignments.values_list('role_definition__name', flat=True))
    object_role_names = {role_definition.name for role_definition in role_definitions if role_definition.name != 'Platform Auditor'}
    assert object_role_names.issubset(assigned_role_names)

    all_roles_user_type = UserType.objects.get(name='Access Matrix: All Roles')
    assert set(all_roles_user_type.role_definitions.values_list('name', flat=True)) == {role_definition.name for role_definition in role_definitions}


@pytest.mark.django_db
def test_seed_access_matrix_is_idempotent(setup_managed_roles, credentialtype_ssh):
    prefix = 'test-access-matrix-idempotent'

    call_command('seed_access_matrix', '--prefix', prefix)
    first_user_count = get_user_model().objects.filter(username__startswith=prefix).count()
    first_user_type_count = UserType.objects.filter(name__startswith='Access Matrix:').count()

    call_command('seed_access_matrix', '--prefix', prefix)

    assert get_user_model().objects.filter(username__startswith=prefix).count() == first_user_count
    assert UserType.objects.filter(name__startswith='Access Matrix:').count() == first_user_type_count
