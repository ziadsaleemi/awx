import pytest

from ansible_base.rbac.models import RoleDefinition

from awx.api.versioning import reverse


@pytest.mark.django_db
def test_user_type_create_clone_and_assign_to_user(post, patch, get, admin, rando, setup_managed_roles):
    role_definition = RoleDefinition.objects.get(name='Inventory Admin')

    response = post(
        reverse('api:user_type_list'),
        data={
            'name': 'NOC operator',
            'description': 'Can administer inventories through assigned roles.',
            'role_definitions': [role_definition.id],
        },
        user=admin,
        expect=201,
    )

    user_type_id = response.data['id']
    assert response.data['name'] == 'NOC operator'
    assert response.data['role_definitions'] == [role_definition.id]
    assert response.data['summary_fields']['role_definitions'][0]['name'] == 'Inventory Admin'

    clone_response = post(
        reverse('api:user_type_copy', kwargs={'pk': user_type_id}),
        data={'name': 'Copy of NOC operator'},
        user=admin,
        expect=201,
    )
    assert clone_response.data['name'] == 'Copy of NOC operator'
    assert clone_response.data['role_definitions'] == [role_definition.id]

    user_response = patch(
        reverse('api:user_detail', kwargs={'pk': rando.id}),
        data={'custom_user_type': user_type_id, 'is_superuser': False, 'is_system_auditor': False},
        user=admin,
        expect=200,
    )
    assert user_response.data['custom_user_type'] == user_type_id
    assert user_response.data['summary_fields']['custom_user_type']['name'] == 'NOC operator'

    detail_response = get(reverse('api:user_detail', kwargs={'pk': rando.id}), user=admin, expect=200)
    assert detail_response.data['custom_user_type'] == user_type_id
    assert detail_response.data['summary_fields']['custom_user_type']['role_definitions'][0]['name'] == 'Inventory Admin'


@pytest.mark.django_db
def test_only_superusers_can_manage_user_types(post, rando, setup_managed_roles):
    role_definition = RoleDefinition.objects.get(name='Inventory Admin')

    post(
        reverse('api:user_type_list'),
        data={'name': 'Blocked user type', 'role_definitions': [role_definition.id]},
        user=rando,
        expect=403,
    )
