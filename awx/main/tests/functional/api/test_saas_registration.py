import pytest

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import override_settings
from rest_framework.reverse import reverse as drf_reverse

from awx.api.versioning import reverse
from awx.main.models import Instance, InstanceGroup, Organization

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def clear_registration_throttle():
    cache.clear()
    yield
    cache.clear()


def registration_payload(**overrides):
    payload = {
        'organization_name': 'Northstar Automation',
        'organization_slug': 'northstar-automation',
        'username': 'northstar-admin',
        'email': 'admin@northstar.example',
        'first_name': 'Northstar',
        'last_name': 'Admin',
        'password': 'CloudHarbor-2026!',
    }
    payload.update(overrides)
    return payload


@override_settings(CAPSTAN_PRODUCT_MODE='on_prem', CAPSTAN_SAAS_REGISTRATION_ENABLED=False)
def test_api_root_advertises_on_prem_mode_without_registration(get):
    response = get(drf_reverse('api:api_root_view'), expect=200)

    assert response.data['product_mode'] == 'on_prem'
    assert response.data['registration_enabled'] is False
    assert 'registration_url' not in response.data


@override_settings(CAPSTAN_PRODUCT_MODE='saas', CAPSTAN_SAAS_REGISTRATION_ENABLED=True)
def test_api_root_advertises_saas_registration(get):
    response = get(drf_reverse('api:api_root_view'), expect=200)

    assert response.data['product_mode'] == 'saas'
    assert response.data['registration_enabled'] is True
    assert response.data['registration_url'].endswith('/api/v2/tenant-registration/')


@pytest.mark.parametrize(
    ('product_mode', 'registration_enabled'),
    [
        ('on_prem', True),
        ('saas', False),
    ],
)
def test_registration_endpoint_is_hidden_when_unavailable(post, product_mode, registration_enabled):
    with override_settings(
        CAPSTAN_PRODUCT_MODE=product_mode,
        CAPSTAN_SAAS_REGISTRATION_ENABLED=registration_enabled,
        CAPSTAN_SAAS_REGISTRATION_RATE_LIMIT='1000/minute',
    ):
        post(reverse('api:tenant_registration_view'), registration_payload(), expect=404)

    assert Organization.objects.count() == 0
    assert User.objects.count() == 0


@override_settings(
    CAPSTAN_PRODUCT_MODE='saas',
    CAPSTAN_SAAS_REGISTRATION_ENABLED=True,
    CAPSTAN_SAAS_REGISTRATION_RATE_LIMIT='1000/minute',
)
def test_registration_creates_tenant_and_non_system_admin(post):
    response = post(reverse('api:tenant_registration_view'), registration_payload(), expect=201)

    organization = Organization.objects.get(name='Northstar Automation')
    user = User.objects.get(username='northstar-admin')

    assert organization.tenant_slug == 'northstar-automation'
    assert organization.tenant_status == Organization.TENANT_STATUS_ACTIVE
    assert organization.is_saas_tenant is True
    assert user.email == 'admin@northstar.example'
    assert user.check_password('CloudHarbor-2026!')
    assert user.is_active is True
    assert user.is_superuser is False
    assert user.is_system_auditor is False
    assert organization.admin_role.members.filter(pk=user.pk).exists()
    assert organization.member_role.members.filter(pk=user.pk).exists()
    assert response.data == {
        'organization': {
            'id': organization.id,
            'name': organization.name,
            'tenant_slug': organization.tenant_slug,
            'tenant_status': organization.tenant_status,
        },
        'user': {
            'id': user.id,
            'username': user.username,
            'email': user.email,
        },
        'login_url': '/api/login/',
    }


@override_settings(
    CAPSTAN_PRODUCT_MODE='saas',
    CAPSTAN_SAAS_REGISTRATION_ENABLED=True,
    CAPSTAN_SAAS_REGISTRATION_RATE_LIMIT='1000/minute',
)
def test_registration_rejects_duplicate_tenant_and_email_without_partial_create(post):
    post(reverse('api:tenant_registration_view'), registration_payload(), expect=201)

    duplicate = registration_payload(
        organization_name='Another Organization',
        username='another-admin',
        organization_slug='northstar-automation',
    )
    response = post(reverse('api:tenant_registration_view'), duplicate, expect=400)

    assert 'organization_slug' in response.data
    assert 'email' in response.data
    assert Organization.objects.count() == 1
    assert User.objects.count() == 1


@override_settings(
    CAPSTAN_PRODUCT_MODE='saas',
    CAPSTAN_SAAS_REGISTRATION_ENABLED=True,
    CAPSTAN_SAAS_REGISTRATION_RATE_LIMIT='1000/minute',
    LOCAL_PASSWORD_MIN_LENGTH=16,
)
def test_registration_applies_local_password_policy(post):
    response = post(
        reverse('api:tenant_registration_view'),
        registration_payload(password='short'),
        expect=400,
    )

    assert 'password' in response.data
    assert Organization.objects.count() == 0
    assert User.objects.count() == 0


@override_settings(CAPSTAN_PRODUCT_MODE='saas')
def test_saas_public_ping_does_not_expose_control_plane_topology(get):
    instance = Instance.objects.create(hostname='private-controller.internal', node_type='control')
    group = InstanceGroup.objects.create(name='private-control-plane')
    group.instances.add(instance)

    response = get(reverse('api:api_v2_ping_view'), expect=200)

    assert response.data['product_mode'] == 'saas'
    assert 'active_node' not in response.data
    assert 'install_uuid' not in response.data
    assert 'instances' not in response.data
    assert 'instance_groups' not in response.data


@override_settings(CAPSTAN_PRODUCT_MODE='saas', CAPSTAN_SAAS_REQUIRE_EXTERNAL_EXECUTION=True)
def test_authenticated_config_exposes_saas_execution_contract(get, rando):
    response = get(reverse('api:api_v2_config_view'), rando, expect=200)

    assert response.data['product_mode'] == 'saas'
    assert response.data['external_execution_required'] is True
