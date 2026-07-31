import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
ROLES = REPO_ROOT / "tools" / "awx-deploy" / "ansible" / "roles"


class AuthenticationConfigurationTests(unittest.TestCase):
    def test_server_and_kubernetes_templates_support_ldap_and_entra(self):
        defaults = (ROLES / "awx_deploy_common" / "defaults" / "main.yml").read_text()
        server_settings = (ROLES / "awx_deploy_common" / "templates" / "settings.py.j2").read_text()
        kubernetes_settings = (ROLES / "awx_k8s" / "templates" / "00-core.yml.j2").read_text()

        self.assertIn("awx_ldap_enabled: false", defaults)
        self.assertIn("awx_entra_enabled: false", defaults)
        self.assertIn("awx_ldap_connection_options:", defaults)
        for settings_template in (server_settings, kubernetes_settings):
            self.assertIn("AUTH_LDAP_SERVER_URI", settings_template)
            self.assertIn("AUTH_LDAP_CONNECTION_OPTIONS", settings_template)
            self.assertIn("AUTH_LDAP_USER_SEARCH", settings_template)
            self.assertIn("AUTH_LDAP_ORGANIZATION_MAP", settings_template)
            self.assertIn("django_auth_ldap_config.LDAPSearch", settings_template)
            self.assertIn("django_auth_ldap_config.LDAPSearchUnion", settings_template)
            self.assertIn("getattr(django_auth_ldap_config", settings_template)
            self.assertIn("SOCIAL_AUTH_AZUREAD_TENANT_OAUTH2_KEY", settings_template)
            self.assertIn("SOCIAL_AUTH_AZUREAD_TENANT_OAUTH2_TENANT_ID", settings_template)
            self.assertIn("SOCIAL_AUTH_AZUREAD_TENANT_OAUTH2_ORGANIZATION_MAP", settings_template)


if __name__ == "__main__":
    unittest.main()
