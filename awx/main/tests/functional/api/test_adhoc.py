from unittest import mock  # noqa
import pytest

from awx.api.versioning import reverse
from awx.main.models import Credential

"""
    def run_test_ad_hoc_command(self, **kwargs):
        # Post to list to start a new ad hoc command.
        expect = kwargs.pop('expect', 201)
        url = kwargs.pop('url', reverse('api:ad_hoc_command_list'))
        data = {
            'inventory': self.inventory.pk,
            'credential': self.credential.pk,
            'module_name': 'command',
            'module_args': 'uptime',
        }
        data.update(kwargs)
        for k,v in data.items():
            if v is None:
                del data[k]
        return self.post(url, data, expect=expect)
"""


@pytest.fixture
def post_adhoc(post, inventory, machine_credential):
    def f(url, data, user, expect=201):
        if not url:
            url = reverse('api:ad_hoc_command_list')

        if 'module_name' not in data:
            data['module_name'] = 'command'
        if 'module_args' not in data:
            data['module_args'] = 'uptime'
        if 'inventory' not in data:
            data['inventory'] = inventory.id
        if 'credential' not in data:
            data['credential'] = machine_credential.id

        for k, v in list(data.items()):
            if v is None:
                del data[k]

        return post(url, data, user, expect=expect)

    return f


@pytest.mark.django_db
def test_admin_post_ad_hoc_command_list(admin, post_adhoc, inventory, machine_credential):
    res = post_adhoc(reverse('api:ad_hoc_command_list'), {}, admin, expect=201)
    assert res.data['job_type'] == 'run'
    assert res.data['inventory'], inventory.id
    assert res.data['credential'] == machine_credential.id
    assert res.data['module_name'] == 'command'
    assert res.data['module_args'] == 'uptime'
    assert res.data['limit'] == ''
    assert res.data['forks'] == 0
    assert res.data['verbosity'] == 0
    assert res.data['become_enabled'] is False


@pytest.mark.django_db
def test_empty_post_403(admin, post):
    post(reverse('api:ad_hoc_command_list'), {}, admin, expect=400)


@pytest.mark.django_db
def test_empty_put_405(admin, put):
    put(reverse('api:ad_hoc_command_list'), {}, admin, expect=405)


@pytest.mark.django_db
def test_empty_patch_405(admin, patch):
    patch(reverse('api:ad_hoc_command_list'), {}, admin, expect=405)


@pytest.mark.django_db
def test_empty_delete_405(admin, delete):
    delete(reverse('api:ad_hoc_command_list'), admin, expect=405)


@pytest.mark.django_db
def test_user_post_ad_hoc_command_list(alice, post_adhoc, inventory, machine_credential):
    inventory.adhoc_role.members.add(alice)
    machine_credential.use_role.members.add(alice)
    post_adhoc(reverse('api:ad_hoc_command_list'), {}, alice, expect=201)


@pytest.mark.django_db
def test_user_post_ad_hoc_command_list_xfail(alice, post_adhoc, inventory, machine_credential):
    inventory.read_role.members.add(alice)  # just read access? no dice.
    machine_credential.use_role.members.add(alice)
    post_adhoc(reverse('api:ad_hoc_command_list'), {}, alice, expect=403)


@pytest.mark.django_db
def test_user_post_ad_hoc_command_list_without_creds(alice, post_adhoc, inventory, machine_credential):
    inventory.adhoc_role.members.add(alice)
    post_adhoc(reverse('api:ad_hoc_command_list'), {}, alice, expect=403)


@pytest.mark.django_db
def test_user_post_ad_hoc_command_list_without_inventory(alice, post_adhoc, inventory, machine_credential):
    machine_credential.use_role.members.add(alice)
    post_adhoc(reverse('api:ad_hoc_command_list'), {}, alice, expect=403)


@pytest.mark.django_db
def test_admin_post_inventory_ad_hoc_command_list(admin, post_adhoc, inventory):
    post_adhoc(reverse('api:inventory_ad_hoc_commands_list', kwargs={'pk': inventory.id}), {'inventory': None}, admin, expect=201)
    post_adhoc(reverse('api:inventory_ad_hoc_commands_list', kwargs={'pk': inventory.id}), {}, admin, expect=201)


@pytest.mark.django_db
def test_host_ad_hoc_uses_inventory_default_machine_credential(admin, post_adhoc, host, inventory, credentialtype_ssh):
    inventory_default_credential = Credential.objects.create(
        credential_type=credentialtype_ssh,
        name='inventory default machine',
        inputs={'username': 'inventory', 'password': 'secret'},
    )
    inventory.default_machine_credential = inventory_default_credential
    inventory.save()

    res = post_adhoc(
        reverse('api:host_ad_hoc_commands_list', kwargs={'pk': host.id}),
        {'credential': None, 'module_name': 'setup', 'module_args': ''},
        admin,
        expect=201,
    )

    assert res.data['inventory'] == inventory.id
    assert res.data['limit'] == host.name
    assert res.data['credential'] == inventory_default_credential.id


@pytest.mark.django_db
def test_host_ad_hoc_force_inventory_machine_credential_overrides_submitted_credential(
    admin, post_adhoc, host, inventory, machine_credential, credentialtype_ssh
):
    inventory_default_credential = Credential.objects.create(
        credential_type=credentialtype_ssh,
        name='forced inventory machine',
        inputs={'username': 'inventory', 'password': 'secret'},
    )
    inventory.default_machine_credential = inventory_default_credential
    inventory.force_inventory_machine_credential = True
    inventory.save()

    res = post_adhoc(
        reverse('api:host_ad_hoc_commands_list', kwargs={'pk': host.id}),
        {'credential': machine_credential.id, 'module_name': 'setup', 'module_args': ''},
        admin,
        expect=201,
    )

    assert res.data['credential'] == inventory_default_credential.id


@pytest.mark.django_db
def test_host_ad_hoc_preserves_submitted_credential_without_inventory_force(admin, post_adhoc, host, inventory, machine_credential, credentialtype_ssh):
    inventory.default_machine_credential = Credential.objects.create(
        credential_type=credentialtype_ssh,
        name='optional inventory machine',
        inputs={'username': 'inventory', 'password': 'secret'},
    )
    inventory.force_inventory_machine_credential = False
    inventory.save()

    res = post_adhoc(
        reverse('api:host_ad_hoc_commands_list', kwargs={'pk': host.id}),
        {'credential': machine_credential.id, 'module_name': 'setup', 'module_args': ''},
        admin,
        expect=201,
    )

    assert res.data['credential'] == machine_credential.id


@pytest.mark.django_db
def test_get_inventory_ad_hoc_command_list(admin, alice, post_adhoc, get, inventory_factory, machine_credential):
    inv1 = inventory_factory('inv1')
    inv2 = inventory_factory('inv2')

    post_adhoc(reverse('api:ad_hoc_command_list'), {'inventory': inv1.id}, admin, expect=201)
    post_adhoc(reverse('api:ad_hoc_command_list'), {'inventory': inv2.id}, admin, expect=201)
    res = get(reverse('api:ad_hoc_command_list'), admin, expect=200)
    assert res.data['count'] == 2
    res = get(reverse('api:inventory_ad_hoc_commands_list', kwargs={'pk': inv1.id}), admin, expect=200)
    assert res.data['count'] == 1
    res = get(reverse('api:inventory_ad_hoc_commands_list', kwargs={'pk': inv2.id}), admin, expect=200)
    assert res.data['count'] == 1

    inv1.adhoc_role.members.add(alice)
    res = get(reverse('api:inventory_ad_hoc_commands_list', kwargs={'pk': inv1.id}), alice, expect=200)
    assert res.data['count'] == 1

    machine_credential.use_role.members.add(alice)
    res = get(reverse('api:inventory_ad_hoc_commands_list', kwargs={'pk': inv1.id}), alice, expect=200)
    assert res.data['count'] == 1
    res = get(reverse('api:inventory_ad_hoc_commands_list', kwargs={'pk': inv2.id}), alice, expect=403)


@pytest.mark.django_db
def test_bad_data1(admin, post_adhoc):
    post_adhoc(reverse('api:ad_hoc_command_list'), {'module_name': 'command', 'module_args': None}, admin, expect=400)


@pytest.mark.django_db
def test_bad_data2(admin, post_adhoc):
    post_adhoc(reverse('api:ad_hoc_command_list'), {'job_type': 'baddata'}, admin, expect=400)


@pytest.mark.django_db
def test_bad_data3(admin, post_adhoc):
    post_adhoc(reverse('api:ad_hoc_command_list'), {'verbosity': -1}, admin, expect=400)


@pytest.mark.django_db
def test_bad_data4(admin, post_adhoc):
    post_adhoc(reverse('api:ad_hoc_command_list'), {'forks': -1}, admin, expect=400)
