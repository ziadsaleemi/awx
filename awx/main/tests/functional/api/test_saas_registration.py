from urllib.parse import parse_qs, urlparse

import pytest

from django.contrib.auth.models import User
from django.core import mail
from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.reverse import reverse as drf_reverse

from awx.api.versioning import reverse
from awx.main.models import Instance, InstanceGroup, Organization, SaaSTenantRegistration

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def configured_registration(settings, mocker):
    settings.CAPSTAN_PRODUCT_MODE = 'saas'
    settings.CAPSTAN_SAAS_REGISTRATION_ENABLED = True
    settings.CAPSTAN_SAAS_REGISTRATION_RATE_LIMIT = '1000/minute'
    settings.CAPSTAN_SAAS_REGISTRATION_VERIFICATION_RATE_LIMIT = '1000/minute'
    settings.CAPSTAN_SAAS_REGISTRATION_TOKEN_MAX_AGE = 3600
    settings.CAPSTAN_SAAS_REGISTRATION_PUBLIC_URL = 'https://capstan.example'
    settings.CAPSTAN_SAAS_REGISTRATION_EMAIL_FROM = 'no-reply@capstan.example'
    settings.CAPSTAN_SAAS_REGISTRATION_TERMS_VERSION = '2026-07-31'
    settings.CAPSTAN_SAAS_REGISTRATION_TERMS_URL = 'https://capstan.example/terms'
    settings.CAPSTAN_SAAS_REGISTRATION_PRIVACY_URL = 'https://capstan.example/privacy'
    settings.CAPSTAN_SAAS_REGISTRATION_BOT_PROVIDER = 'turnstile'
    settings.CAPSTAN_SAAS_REGISTRATION_TURNSTILE_SITE_KEY = 'site-key'
    settings.CAPSTAN_SAAS_REGISTRATION_TURNSTILE_SECRET_KEY = 'secret-key'
    settings.EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'
    settings.EMAIL_HOST = 'smtp.capstan.example'
    response = mocker.Mock()
    response.json.return_value = {'success': True}
    response.raise_for_status.return_value = None
    mocker.patch('awx.api.serializers_saas.requests.post', return_value=response)
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
        'terms_accepted': True,
        'terms_version': '2026-07-31',
        'bot_challenge_token': 'verified-browser-challenge',
    }
    payload.update(overrides)
    return payload


def email_verification_token():
    verification_url = next(line for line in mail.outbox[-1].body.splitlines() if line.startswith('https://'))
    return parse_qs(urlparse(verification_url).query)['token'][0]


@override_settings(CAPSTAN_PRODUCT_MODE='on_prem', CAPSTAN_SAAS_REGISTRATION_ENABLED=False)
def test_api_root_advertises_on_prem_mode_without_registration(get):
    response = get(drf_reverse('api:api_root_view'), expect=200)

    assert response.data['product_mode'] == 'on_prem'
    assert response.data['registration_enabled'] is False
    assert 'registration_url' not in response.data


def test_api_root_advertises_ready_saas_registration(get):
    response = get(drf_reverse('api:api_root_view'), expect=200)

    assert response.data['product_mode'] == 'saas'
    assert response.data['registration_enabled'] is True
    assert response.data['registration_url'].endswith('/api/v2/tenant-registration/')
    assert response.data['registration_verification_url'].endswith('/api/v2/tenant-registration/verify/')
    assert response.data['registration_terms_version'] == '2026-07-31'
    assert response.data['registration_bot_provider'] == 'turnstile'
    assert response.data['registration_bot_site_key'] == 'site-key'


@pytest.mark.parametrize(
    ('setting_name', 'value'),
    [
        ('CAPSTAN_SAAS_REGISTRATION_TURNSTILE_SECRET_KEY', ''),
        ('EMAIL_HOST', ''),
        ('CAPSTAN_SAAS_REGISTRATION_PUBLIC_URL', 'http://capstan.example'),
        ('CAPSTAN_SAAS_REGISTRATION_TERMS_URL', 'http://capstan.example/terms'),
        ('CAPSTAN_SAAS_REGISTRATION_PRIVACY_URL', 'http://capstan.example/privacy'),
    ],
)
def test_api_root_hides_registration_when_a_production_gate_is_missing(get, settings, setting_name, value):
    setattr(settings, setting_name, value)

    response = get(drf_reverse('api:api_root_view'), expect=200)

    assert response.data['registration_enabled'] is False
    assert 'registration_url' not in response.data


@pytest.mark.parametrize(
    ('product_mode', 'registration_enabled'),
    [
        ('on_prem', True),
        ('saas', False),
    ],
)
def test_registration_endpoint_is_hidden_when_unavailable(post, settings, product_mode, registration_enabled):
    settings.CAPSTAN_PRODUCT_MODE = product_mode
    settings.CAPSTAN_SAAS_REGISTRATION_ENABLED = registration_enabled

    post(reverse('api:tenant_registration_view'), registration_payload(), expect=404)

    assert Organization.objects.count() == 0
    assert User.objects.count() == 0


def test_registration_requires_email_verification_before_creating_tenant(post):
    response = post(reverse('api:tenant_registration_view'), registration_payload(), expect=202)

    assert response.data == {
        'detail': 'Check your email to verify the organization registration.',
        'verification_required': True,
    }
    assert SaaSTenantRegistration.objects.count() == 1
    assert Organization.objects.count() == 0
    assert User.objects.count() == 0
    assert len(mail.outbox) == 1
    assert 'https://capstan.example/register/verify?token=' in mail.outbox[0].body


def test_registration_email_failure_never_creates_an_active_tenant(post, mocker):
    mocker.patch('awx.api.serializers_saas.send_mail', side_effect=OSError('SMTP unavailable'))

    post(reverse('api:tenant_registration_view'), registration_payload(), expect=503)

    assert SaaSTenantRegistration.objects.count() == 1
    assert Organization.objects.count() == 0
    assert User.objects.count() == 0


def test_identical_pending_retry_resends_without_replacing_credentials(post):
    post(reverse('api:tenant_registration_view'), registration_payload(), expect=202)
    registration = SaaSTenantRegistration.objects.get()
    original_password_hash = registration.password_hash
    original_nonce = registration.verification_nonce

    post(
        reverse('api:tenant_registration_view'),
        registration_payload(password='Different-CloudHarbor-2026!'),
        expect=202,
    )

    registration.refresh_from_db()
    assert SaaSTenantRegistration.objects.count() == 1
    assert registration.password_hash == original_password_hash
    assert registration.verification_nonce == original_nonce
    assert len(mail.outbox) == 2


def test_verified_registration_creates_tenant_and_non_system_admin(post):
    post(reverse('api:tenant_registration_view'), registration_payload(), expect=202)
    response = post(reverse('api:tenant_registration_verification_view'), {'token': email_verification_token()}, expect=201)

    organization = Organization.objects.get(name='Northstar Automation')
    user = User.objects.get(username='northstar-admin')
    execution_pool = InstanceGroup.objects.get(tenant_organization=organization)
    registration = SaaSTenantRegistration.objects.get()

    assert organization.tenant_slug == 'northstar-automation'
    assert organization.tenant_status == Organization.TENANT_STATUS_ACTIVE
    assert organization.is_saas_tenant is True
    assert organization.tenant_terms_version == '2026-07-31'
    assert organization.tenant_terms_accepted_at == registration.terms_accepted_at
    assert organization.tenant_terms_accepted_by_email == 'admin@northstar.example'
    assert user.email == 'admin@northstar.example'
    assert user.check_password('CloudHarbor-2026!')
    assert user.is_active is True
    assert user.is_superuser is False
    assert user.is_system_auditor is False
    assert organization.admin_role.members.filter(pk=user.pk).exists()
    assert organization.member_role.members.filter(pk=user.pk).exists()
    assert execution_pool.name == 'tenant-{}-northstar-automation'.format(organization.id)
    assert execution_pool.tenant_status == InstanceGroup.TenantStates.ACTIVE
    assert organization.instance_groups.filter(pk=execution_pool.pk).exists()
    assert registration.verified_at is not None
    assert registration.consumed_at is not None
    assert response.data['user']['username'] == 'northstar-admin'


def test_verification_token_cannot_be_replayed(post):
    post(reverse('api:tenant_registration_view'), registration_payload(), expect=202)
    token = email_verification_token()

    post(reverse('api:tenant_registration_verification_view'), {'token': token}, expect=201)
    response = post(reverse('api:tenant_registration_verification_view'), {'token': token}, expect=400)

    assert 'already been used' in str(response.data['token'])
    assert Organization.objects.count() == 1
    assert User.objects.count() == 1


def test_expired_registration_cannot_be_verified(post):
    post(reverse('api:tenant_registration_view'), registration_payload(), expect=202)
    token = email_verification_token()
    SaaSTenantRegistration.objects.update(expires_at=timezone.now())

    response = post(reverse('api:tenant_registration_verification_view'), {'token': token}, expect=400)

    assert 'expired' in str(response.data['token'])
    assert Organization.objects.count() == 0


def test_registration_rejects_missing_legal_acceptance(post):
    response = post(reverse('api:tenant_registration_view'), registration_payload(terms_accepted=False), expect=400)

    assert 'terms_accepted' in response.data
    assert SaaSTenantRegistration.objects.count() == 0


def test_registration_rejects_failed_bot_challenge(post, mocker):
    response = mocker.Mock()
    response.json.return_value = {'success': False, 'error-codes': ['invalid-input-response']}
    response.raise_for_status.return_value = None
    mocker.patch('awx.api.serializers_saas.requests.post', return_value=response)

    result = post(reverse('api:tenant_registration_view'), registration_payload(), expect=400)

    assert 'bot_challenge_token' in result.data
    assert SaaSTenantRegistration.objects.count() == 0


def test_registration_rejects_duplicate_tenant_and_email_without_partial_create(post):
    post(reverse('api:tenant_registration_view'), registration_payload(), expect=202)
    post(reverse('api:tenant_registration_verification_view'), {'token': email_verification_token()}, expect=201)

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


@override_settings(LOCAL_PASSWORD_MIN_LENGTH=16)
def test_registration_applies_local_password_policy(post):
    response = post(reverse('api:tenant_registration_view'), registration_payload(password='short'), expect=400)

    assert 'password' in response.data
    assert SaaSTenantRegistration.objects.count() == 0


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
