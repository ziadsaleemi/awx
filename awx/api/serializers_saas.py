from datetime import timedelta
from urllib.parse import urlencode

import requests
from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password as django_validate_password
from django.core import signing
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import send_mail
from django.core.validators import RegexValidator
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import APIException

from awx.main.models import InstanceGroup, Organization, SaaSTenantRegistration

REGISTRATION_TOKEN_SALT = 'capstan.saas.tenant-registration.v1'


class RegistrationDependencyUnavailable(APIException):
    status_code = 503
    default_detail = 'Tenant registration is temporarily unavailable. Please try again later.'
    default_code = 'registration_dependency_unavailable'


def _verify_bot_challenge(token, request):
    remote_ip = request.META.get('REMOTE_ADDR', '') if request is not None else ''
    try:
        response = requests.post(
            settings.CAPSTAN_SAAS_REGISTRATION_TURNSTILE_VERIFY_URL,
            data={
                'secret': settings.CAPSTAN_SAAS_REGISTRATION_TURNSTILE_SECRET_KEY,
                'response': token,
                'remoteip': remote_ip,
            },
            timeout=5,
        )
        response.raise_for_status()
        result = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise RegistrationDependencyUnavailable() from exc
    if not result.get('success'):
        raise serializers.ValidationError({'bot_challenge_token': 'Complete the security check and try again.'})


def build_registration_verification_token(registration):
    return signing.dumps(
        {'registration_id': str(registration.pk), 'nonce': str(registration.verification_nonce)},
        salt=REGISTRATION_TOKEN_SALT,
        compress=True,
    )


def send_registration_verification(registration):
    token = build_registration_verification_token(registration)
    query = urlencode({'token': token})
    verification_url = '{}/register/verify?{}'.format(settings.CAPSTAN_SAAS_REGISTRATION_PUBLIC_URL, query)
    try:
        send_mail(
            'Verify your Capstan organization',
            (
                'Verify the email address for your Capstan organization by opening this link:\n\n'
                '{}\n\nThis link expires in {} hours. If you did not request this organization, ignore this message.'
            ).format(verification_url, max(1, settings.CAPSTAN_SAAS_REGISTRATION_TOKEN_MAX_AGE // 3600)),
            settings.CAPSTAN_SAAS_REGISTRATION_EMAIL_FROM,
            [registration.email],
            fail_silently=False,
        )
    except Exception as exc:
        raise RegistrationDependencyUnavailable() from exc


class TenantRegistrationSerializer(serializers.Serializer):
    organization_name = serializers.CharField(max_length=512, trim_whitespace=True)
    organization_slug = serializers.CharField(
        max_length=255,
        trim_whitespace=True,
        validators=[
            RegexValidator(
                regex=r'^[a-z0-9]+(?:-[a-z0-9]+)*$',
                message='Use lowercase letters, numbers, and single hyphens only.',
            )
        ],
    )
    username = serializers.CharField(
        max_length=User._meta.get_field(User.USERNAME_FIELD).max_length,
        trim_whitespace=True,
        validators=User._meta.get_field(User.USERNAME_FIELD).validators,
    )
    email = serializers.EmailField(max_length=User._meta.get_field('email').max_length)
    first_name = serializers.CharField(max_length=User._meta.get_field('first_name').max_length, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=User._meta.get_field('last_name').max_length, required=False, allow_blank=True)
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    terms_accepted = serializers.BooleanField(write_only=True)
    terms_version = serializers.CharField(write_only=True, max_length=64)
    bot_challenge_token = serializers.CharField(write_only=True, trim_whitespace=True)

    def validate_organization_name(self, value):
        if Organization.objects.filter(name__iexact=value).exists():
            raise serializers.ValidationError('An organization with this name already exists.')
        return value

    def validate_organization_slug(self, value):
        if Organization.objects.filter(tenant_slug=value).exists():
            raise serializers.ValidationError('This organization identifier is unavailable.')
        return value

    def validate_username(self, value):
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError('A user with this username already exists.')
        return value

    def validate_email(self, value):
        normalized = User.objects.normalize_email(value).lower()
        if User.objects.filter(email__iexact=normalized).exists():
            raise serializers.ValidationError('A user with this email address already exists.')
        return normalized

    def validate(self, attrs):
        password = attrs['password']
        password_max_length = User._meta.get_field('password').max_length
        if len(password) > password_max_length:
            raise serializers.ValidationError({'password': 'Password max length is {}.'.format(password_max_length)})
        if getattr(settings, 'LOCAL_PASSWORD_MIN_LENGTH', 0) and len(password) < settings.LOCAL_PASSWORD_MIN_LENGTH:
            raise serializers.ValidationError({'password': 'Password must be at least {} characters long.'.format(settings.LOCAL_PASSWORD_MIN_LENGTH)})
        if getattr(settings, 'LOCAL_PASSWORD_MIN_DIGITS', 0) and sum(character.isdigit() for character in password) < settings.LOCAL_PASSWORD_MIN_DIGITS:
            raise serializers.ValidationError({'password': 'Password does not contain enough digits.'})
        if getattr(settings, 'LOCAL_PASSWORD_MIN_UPPER', 0) and sum(character.isupper() for character in password) < settings.LOCAL_PASSWORD_MIN_UPPER:
            raise serializers.ValidationError({'password': 'Password does not contain enough uppercase characters.'})
        if getattr(settings, 'LOCAL_PASSWORD_MIN_SPECIAL', 0) and sum(not character.isalnum() for character in password) < settings.LOCAL_PASSWORD_MIN_SPECIAL:
            raise serializers.ValidationError({'password': 'Password does not contain enough special characters.'})

        candidate = User(
            username=attrs['username'],
            email=attrs['email'],
            first_name=attrs.get('first_name', ''),
            last_name=attrs.get('last_name', ''),
        )
        try:
            django_validate_password(password, user=candidate)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({'password': list(exc.messages)}) from exc

        if not attrs['terms_accepted']:
            raise serializers.ValidationError({'terms_accepted': 'Accept the Terms of Service and Privacy Policy to continue.'})
        if attrs['terms_version'] != settings.CAPSTAN_SAAS_REGISTRATION_TERMS_VERSION:
            raise serializers.ValidationError({'terms_version': 'The legal terms have changed. Review and accept the current version.'})
        _verify_bot_challenge(attrs['bot_challenge_token'], self.context.get('request'))
        return attrs

    def create(self, validated_data):
        now = timezone.now()
        identity_filter = Q(organization_slug=validated_data['organization_slug']) | Q(username=validated_data['username']) | Q(email=validated_data['email'])
        try:
            with transaction.atomic():
                SaaSTenantRegistration.objects.filter(identity_filter, consumed_at__isnull=True, expires_at__lte=now).delete()
                conflicts = list(SaaSTenantRegistration.objects.select_for_update().filter(identity_filter, consumed_at__isnull=True))
                if conflicts:
                    existing = conflicts[0]
                    if len(conflicts) == 1 and (
                        existing.organization_slug == validated_data['organization_slug']
                        and existing.username.lower() == validated_data['username'].lower()
                        and existing.email.lower() == validated_data['email'].lower()
                        and existing.terms_version == validated_data['terms_version']
                    ):
                        return existing
                    errors = {}
                    for conflict in conflicts:
                        if conflict.organization_slug == validated_data['organization_slug']:
                            errors['organization_slug'] = 'This organization identifier has a pending registration.'
                        if conflict.username.lower() == validated_data['username'].lower():
                            errors['username'] = 'This username has a pending registration.'
                        if conflict.email.lower() == validated_data['email'].lower():
                            errors['email'] = 'This email address has a pending registration.'
                    raise serializers.ValidationError(errors)

                return SaaSTenantRegistration.objects.create(
                    organization_name=validated_data['organization_name'],
                    organization_slug=validated_data['organization_slug'],
                    username=validated_data['username'],
                    email=validated_data['email'],
                    first_name=validated_data.get('first_name', ''),
                    last_name=validated_data.get('last_name', ''),
                    password_hash=make_password(validated_data['password']),
                    terms_version=validated_data['terms_version'],
                    terms_accepted_at=now,
                    expires_at=now + timedelta(seconds=settings.CAPSTAN_SAAS_REGISTRATION_TOKEN_MAX_AGE),
                )
        except IntegrityError as exc:
            raise serializers.ValidationError({'detail': 'The organization or user is no longer available.'}) from exc


class TenantRegistrationVerificationSerializer(serializers.Serializer):
    token = serializers.CharField(write_only=True, trim_whitespace=True)

    def validate_token(self, value):
        try:
            payload = signing.loads(value, salt=REGISTRATION_TOKEN_SALT, max_age=settings.CAPSTAN_SAAS_REGISTRATION_TOKEN_MAX_AGE)
            registration_id = payload['registration_id']
            nonce = payload['nonce']
        except (signing.BadSignature, signing.SignatureExpired, KeyError, TypeError):
            raise serializers.ValidationError('This verification link is invalid or has expired.')
        return {'registration_id': registration_id, 'nonce': nonce}

    def create(self, validated_data):
        token = validated_data['token']
        now = timezone.now()
        try:
            with transaction.atomic():
                registration = SaaSTenantRegistration.objects.select_for_update().get(pk=token['registration_id'])
                if str(registration.verification_nonce) != token['nonce']:
                    raise serializers.ValidationError({'token': 'This verification link is invalid or has expired.'})
                if registration.consumed_at is not None:
                    raise serializers.ValidationError({'token': 'This verification link has already been used.'})
                if registration.expires_at <= now:
                    raise serializers.ValidationError({'token': 'This verification link is invalid or has expired.'})
                if registration.terms_version != settings.CAPSTAN_SAAS_REGISTRATION_TERMS_VERSION:
                    raise serializers.ValidationError({'token': 'The legal terms have changed. Start a new registration.'})
                if Organization.objects.filter(Q(name__iexact=registration.organization_name) | Q(tenant_slug=registration.organization_slug)).exists():
                    raise serializers.ValidationError({'token': 'The organization is no longer available.'})
                if User.objects.filter(Q(username__iexact=registration.username) | Q(email__iexact=registration.email)).exists():
                    raise serializers.ValidationError({'token': 'The administrator account is no longer available.'})

                organization = Organization.objects.create(
                    name=registration.organization_name,
                    tenant_slug=registration.organization_slug,
                    tenant_status=Organization.TENANT_STATUS_ACTIVE,
                    is_saas_tenant=True,
                    tenant_terms_version=registration.terms_version,
                    tenant_terms_accepted_at=registration.terms_accepted_at,
                    tenant_terms_accepted_by_email=registration.email,
                )
                execution_pool = InstanceGroup.objects.create(
                    name='tenant-{}-{}'.format(organization.pk, organization.tenant_slug)[:250],
                    tenant_organization=organization,
                    tenant_status=InstanceGroup.TenantStates.ACTIVE,
                )
                organization.instance_groups.add(execution_pool)
                user = User.objects.create(
                    username=registration.username,
                    email=registration.email,
                    first_name=registration.first_name,
                    last_name=registration.last_name,
                    password=registration.password_hash,
                    is_active=True,
                    is_superuser=False,
                )
                organization.admin_role.members.add(user)
                organization.member_role.members.add(user)
                registration.verified_at = now
                registration.consumed_at = now
                registration.save(update_fields=['verified_at', 'consumed_at'])
        except SaaSTenantRegistration.DoesNotExist as exc:
            raise serializers.ValidationError({'token': 'This verification link is invalid or has expired.'}) from exc
        except IntegrityError as exc:
            raise serializers.ValidationError({'token': 'The organization or user is no longer available.'}) from exc
        return organization, user, execution_pool
