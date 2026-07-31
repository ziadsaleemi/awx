from django.conf import settings
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password as django_validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.core.validators import RegexValidator
from rest_framework import serializers

from awx.main.models import InstanceGroup, Organization


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
        return attrs

    def create(self, validated_data):
        try:
            with transaction.atomic():
                organization = Organization.objects.create(
                    name=validated_data['organization_name'],
                    tenant_slug=validated_data['organization_slug'],
                    tenant_status=Organization.TENANT_STATUS_ACTIVE,
                    is_saas_tenant=True,
                )
                execution_pool = InstanceGroup.objects.create(
                    name=f'tenant-{organization.pk}-{organization.tenant_slug}'[:250],
                    tenant_organization=organization,
                    tenant_status=InstanceGroup.TenantStates.ACTIVE,
                )
                organization.instance_groups.add(execution_pool)
                user = User.objects.create_user(
                    username=validated_data['username'],
                    email=validated_data['email'],
                    first_name=validated_data.get('first_name', ''),
                    last_name=validated_data.get('last_name', ''),
                    password=validated_data['password'],
                    is_active=True,
                    is_superuser=False,
                )
                organization.admin_role.members.add(user)
                organization.member_role.members.add(user)
        except IntegrityError as exc:
            raise serializers.ValidationError({'detail': 'The organization or user is no longer available.'}) from exc
        return organization, user, execution_pool
