from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.contrib.auth.models import User
from django_auth_ldap.backend import LDAPBackend as BaseLDAPBackend

from awx.sso.backends import LDAPBackend, _update_m2m_from_groups, on_populate_user
from awx.sso.models import UserEnterpriseAuth


class MockLDAPGroups(object):
    def is_member_of(self, group_dn):
        return bool(group_dn)


class MockLDAPUser(object):
    def _get_groups(self):
        return MockLDAPGroups()


@pytest.mark.parametrize(
    "setting, expected_result",
    [
        (True, True),
        ('something', True),
        (False, False),
        ('', False),
    ],
)
def test_mock_objects(setting, expected_result):
    ldap_user = MockLDAPUser()
    assert ldap_user._get_groups().is_member_of(setting) == expected_result


@pytest.mark.parametrize(
    "opts, remove, expected_result",
    [
        # In these case we will pass no opts so we should get None as a return in all cases
        (
            None,
            False,
            None,
        ),
        (
            None,
            True,
            None,
        ),
        # Next lets test with empty opts ([]) This should return False if remove is True and None otherwise
        (
            [],
            True,
            False,
        ),
        (
            [],
            False,
            None,
        ),
        # Next opts is True, this will always return True
        (
            True,
            True,
            True,
        ),
        (
            True,
            False,
            True,
        ),
        # If we get only a non-string as an option we hit a continue and will either return None or False depending on the remove flag
        (
            [32],
            False,
            None,
        ),
        (
            [32],
            True,
            False,
        ),
        # Finally we need to test whether or not a user should be allowed in or not.
        # We use a mock class for ldap_user that simply returns true/false based on the otps
        (
            ['true'],
            False,
            True,
        ),
        # In this test we are going to pass a string to test the part of the code that coverts strings into array, this should give us True
        (
            'something',
            True,
            True,
        ),
        (
            [''],
            False,
            None,
        ),
        (
            False,
            True,
            False,
        ),
        # Empty strings are considered opts == None and will result in None or False based on the remove flag
        (
            '',
            True,
            False,
        ),
        (
            '',
            False,
            None,
        ),
    ],
)
@pytest.mark.django_db
def test__update_m2m_from_groups(opts, remove, expected_result):
    ldap_user = MockLDAPUser()
    assert expected_result == _update_m2m_from_groups(ldap_user, opts, remove)


def _ldap_settings():
    return SimpleNamespace(
        START_TLS=False,
        CONNECTION_OPTIONS={},
        SERVER_URI='ldap://directory.example.com',
        GROUP_SEARCH=object(),
        GROUP_TYPE=object(),
    )


@pytest.mark.django_db
def test_ldap_backend_does_not_claim_local_user():
    User.objects.create_user(username='local-user', password='local-password')
    backend = LDAPBackend()
    backend.settings = _ldap_settings()

    with patch.object(BaseLDAPBackend, 'authenticate') as base_authenticate:
        assert backend.authenticate(None, 'local-user', 'directory-password') is None

    base_authenticate.assert_not_called()


@pytest.mark.django_db
def test_ldap_backend_authenticates_marked_ldap_user():
    user = User.objects.create(username='ldap-user')
    user.set_unusable_password()
    user.save()
    UserEnterpriseAuth.objects.create(user=user, provider='ldap')
    backend = LDAPBackend()
    backend.settings = _ldap_settings()

    with patch.object(BaseLDAPBackend, 'authenticate', return_value=None) as base_authenticate:
        assert backend.authenticate(None, 'ldap-user', 'directory-password') is None

    base_authenticate.assert_called_once_with(None, 'ldap-user', 'directory-password')


@pytest.mark.django_db
def test_ldap_backend_adopts_unowned_legacy_external_user():
    user = User.objects.create(username='legacy-ldap-user')
    user.set_unusable_password()
    user.save()
    backend = LDAPBackend()
    backend.settings = _ldap_settings()

    with patch.object(BaseLDAPBackend, 'authenticate', return_value=None) as base_authenticate:
        assert backend.authenticate(None, 'legacy-ldap-user', 'directory-password') is None

    base_authenticate.assert_called_once_with(None, 'legacy-ldap-user', 'directory-password')


@pytest.mark.django_db
def test_ldap_backend_does_not_claim_other_enterprise_user():
    user = User.objects.create(username='radius-user')
    user.set_unusable_password()
    user.save()
    UserEnterpriseAuth.objects.create(user=user, provider='radius')
    backend = LDAPBackend()
    backend.settings = _ldap_settings()

    with patch.object(BaseLDAPBackend, 'authenticate') as base_authenticate:
        assert backend.authenticate(None, 'radius-user', 'directory-password') is None

    base_authenticate.assert_not_called()


@pytest.mark.django_db
def test_ldap_backend_does_not_claim_social_auth_user():
    user = User.objects.create(username='social-user')
    user.set_unusable_password()
    user.save()
    user.social_auth.create(provider='github', uid='social-user')
    backend = LDAPBackend()
    backend.settings = _ldap_settings()

    with patch.object(BaseLDAPBackend, 'authenticate') as base_authenticate:
        assert backend.authenticate(None, 'social-user', 'directory-password') is None

    base_authenticate.assert_not_called()


@pytest.mark.django_db
def test_populated_ldap_user_gets_enterprise_auth_marker():
    user = User(username='new-ldap-user')
    user.set_password('temporary-password')
    ldap_user = SimpleNamespace(
        backend=SimpleNamespace(settings=SimpleNamespace(ORGANIZATION_MAP={}, TEAM_MAP={})),
        dn='uid=new-ldap-user,dc=example,dc=com',
        _get_groups=lambda: SimpleNamespace(get_group_dns=lambda: []),
    )

    with (
        patch('awx.sso.backends.create_org_and_teams'),
        patch('awx.sso.backends.reconcile_users_org_team_mappings'),
    ):
        on_populate_user(None, user=user, ldap_user=ldap_user)

    user.refresh_from_db()
    assert not user.has_usable_password()
    assert user.enterprise_auth.filter(provider='ldap').exists()
