from unittest import mock

import pytest

from awx.api.versioning import reverse
from awx.api.views.instance_install_bundle import IsSystemAdminOrTenantInstanceAdmin
from awx.main.models.activity_stream import ActivityStream
from awx.main.models.ha import Instance, InstanceGroup

from django.test.utils import override_settings
from django.http import HttpResponse

from rest_framework import status

INSTANCE_KWARGS = dict(hostname='example-host', cpu=6, node_type='execution', memory=36000000000, cpu_capacity=6, mem_capacity=42)


@pytest.mark.django_db
def test_disabled_zeros_capacity(patch, admin_user):
    instance = Instance.objects.create(**INSTANCE_KWARGS)
    assert ActivityStream.objects.filter(instance=instance).count() == 1

    url = reverse('api:instance_detail', kwargs={'pk': instance.pk})

    r = patch(url=url, data={'enabled': False}, user=admin_user)
    assert r.data['capacity'] == 0

    instance.refresh_from_db()
    assert instance.capacity == 0
    assert ActivityStream.objects.filter(instance=instance).count() == 2


@pytest.mark.django_db
def test_enabled_sets_capacity(patch, admin_user):
    instance = Instance.objects.create(enabled=False, capacity=0, **INSTANCE_KWARGS)
    assert instance.capacity == 0
    assert ActivityStream.objects.filter(instance=instance).count() == 1

    url = reverse('api:instance_detail', kwargs={'pk': instance.pk})

    r = patch(url=url, data={'enabled': True}, user=admin_user)
    assert r.data['capacity'] > 0

    instance.refresh_from_db()
    assert instance.capacity > 0
    assert ActivityStream.objects.filter(instance=instance).count() == 2


@pytest.mark.django_db
def test_auditor_user_health_check(get, post, system_auditor):
    instance = Instance.objects.create(**INSTANCE_KWARGS)
    url = reverse('api:instance_health_check', kwargs={'pk': instance.pk})
    get(url=url, user=system_auditor, expect=200)
    post(url=url, user=system_auditor, expect=403)


@pytest.mark.django_db
def test_health_check_usage(get, post, admin_user):
    instance = Instance.objects.create(**INSTANCE_KWARGS)
    url = reverse('api:instance_health_check', kwargs={'pk': instance.pk})
    get(url=url, user=admin_user, expect=200)
    r = post(url=url, user=admin_user, expect=200)
    assert r.data['msg'] == f"Health check is running for {instance.hostname}."


def test_custom_hostname_regex(post, admin_user):
    url = reverse('api:instance_list')
    with override_settings(IS_K8S=True):
        for value in [
            ("foo.bar.baz", 201),
            ("f.bar.bz", 201),
            ("foo.bar.b", 400),
            ("a.b.c", 400),
            ("localhost", 400),
            ("127.0.0.1", 400),
            ("192.168.56.101", 201),
            ("2001:0db8:85a3:0000:0000:8a2e:0370:7334", 201),
            ("foobar", 201),
            ("--yoooo", 400),
            ("$3$@foobar@#($!@#*$", 400),
            ("999.999.999.999", 201),
            ("0000:0000:0000:0000:0000:0000:0000:0001", 400),
            ("whitespaces are bad for hostnames", 400),
            ("0:0:0:0:0:0:0:1", 400),
            ("192.localhost.domain.101", 201),
            ("F@$%(@#$H%^(I@#^HCTQEWRFG", 400),
        ]:
            data = {
                "hostname": value[0],
                "node_type": "execution",
                "node_state": "installed",
                "peers": [],
            }
            post(url=url, user=admin_user, data=data, expect=value[1])


def test_instance_install_bundle(get, admin_user, system_auditor):
    instance = Instance.objects.create(**INSTANCE_KWARGS)
    url = reverse('api:instance_install_bundle', kwargs={'pk': instance.pk})
    with mock.patch('awx.api.views.instance_install_bundle.InstanceInstallBundle.get', return_value=HttpResponse({'test': 'data'}, status=status.HTTP_200_OK)):
        get(url=url, user=admin_user, expect=200)
        get(url=url, user=system_auditor, expect=403)


@pytest.mark.django_db
@override_settings(CAPSTAN_PRODUCT_MODE='saas', CAPSTAN_SAAS_REQUIRE_EXTERNAL_EXECUTION=True, IS_K8S=False)
def test_tenant_admin_can_enroll_owned_external_execution_instance(post, organization, org_admin):
    organization.is_saas_tenant = True
    organization.tenant_slug = 'test-org'
    organization.tenant_status = organization.TENANT_STATUS_ACTIVE
    organization.save(update_fields=['is_saas_tenant', 'tenant_slug', 'tenant_status'])
    execution_pool = InstanceGroup.objects.create(
        name='tenant-test-org',
        tenant_organization=organization,
        tenant_status=InstanceGroup.TenantStates.ACTIVE,
    )

    response = post(
        reverse('api:instance_list'),
        {
            'hostname': 'tenant-execution.example.org',
            'node_type': 'execution',
            'node_state': 'installed',
            'tenant_organization': organization.id,
            'execution_pool': execution_pool.id,
            'peers': [],
        },
        org_admin,
        expect=201,
    )

    instance = Instance.objects.get(pk=response.data['id'])
    assert instance.tenant_organization == organization
    assert execution_pool.instances.filter(pk=instance.pk).exists()


@pytest.mark.django_db
@override_settings(CAPSTAN_PRODUCT_MODE='saas', CAPSTAN_SAAS_REQUIRE_EXTERNAL_EXECUTION=True, IS_K8S=False)
def test_tenant_admin_cannot_enroll_instance_into_foreign_pool(post, organization, org_admin):
    organization.is_saas_tenant = True
    organization.tenant_slug = 'test-org'
    organization.tenant_status = organization.TENANT_STATUS_ACTIVE
    organization.save(update_fields=['is_saas_tenant', 'tenant_slug', 'tenant_status'])
    foreign_organization = type(organization).objects.create(
        name='Foreign tenant',
        is_saas_tenant=True,
        tenant_slug='foreign-tenant',
        tenant_status=organization.TENANT_STATUS_ACTIVE,
    )
    foreign_pool = InstanceGroup.objects.create(
        name='tenant-foreign',
        tenant_organization=foreign_organization,
        tenant_status=InstanceGroup.TenantStates.ACTIVE,
    )

    response = post(
        reverse('api:instance_list'),
        {
            'hostname': 'tenant-execution.example.org',
            'node_type': 'execution',
            'node_state': 'installed',
            'tenant_organization': organization.id,
            'execution_pool': foreign_pool.id,
            'peers': [],
        },
        org_admin,
        expect=400,
    )

    assert 'execution_pool' in response.data
    assert not Instance.objects.filter(hostname='tenant-execution.example.org').exists()


@pytest.mark.django_db
def test_tenant_instance_install_bundle_permission_is_owner_scoped(organization, org_admin, rando, admin_user):
    organization.is_saas_tenant = True
    organization.tenant_slug = 'test-org'
    organization.tenant_status = organization.TENANT_STATUS_ACTIVE
    organization.save(update_fields=['is_saas_tenant', 'tenant_slug', 'tenant_status'])
    instance = Instance.objects.create(hostname='tenant-execution.example.org', node_type='execution', tenant_organization=organization)
    permission = IsSystemAdminOrTenantInstanceAdmin()

    assert permission.has_object_permission(mock.Mock(user=admin_user), mock.Mock(), instance)
    assert permission.has_object_permission(mock.Mock(user=org_admin), mock.Mock(), instance)
    assert not permission.has_object_permission(mock.Mock(user=rando), mock.Mock(), instance)
