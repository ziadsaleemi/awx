import importlib.util
import sys
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).parents[1] / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))
SCRIPT = SCRIPT_DIR / "export_configuration.py"
SPEC = importlib.util.spec_from_file_location("export_configuration", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class FakeExportClient:
    def __init__(self):
        self.objects = {
            "/api/v2/organizations/": [
                {"id": 1, "name": "Platform", "description": "Managed", "related": {}},
            ],
            "/api/v2/credential_types/": [
                {
                    "id": 2,
                    "name": "Machine",
                    "kind": "ssh",
                    "managed": True,
                    "inputs": {"fields": [{"id": "username"}, {"id": "password", "secret": True}]},
                    "related": {},
                },
                {
                    "id": 3,
                    "name": "Custom Cloud",
                    "kind": "cloud",
                    "managed": False,
                    "inputs": {"fields": [{"id": "endpoint"}, {"id": "token", "secret": True}]},
                    "injectors": {},
                    "related": {},
                },
            ],
            "/api/v2/credentials/": [
                {
                    "id": 4,
                    "name": "Cloud API",
                    "organization": 1,
                    "credential_type": 3,
                    "inputs": {"endpoint": "https://cloud.example.test", "token": "$encrypted$"},
                    "related": {},
                }
            ],
            "/api/v2/inventories/": [
                {"id": 5, "name": "Production", "organization": 1, "kind": "", "variables": "---", "related": {}},
            ],
            "/api/v2/hosts/": [
                {"id": 6, "name": "web01", "inventory": 5, "enabled": True, "variables": "ansible_host: 192.0.2.10", "related": {}},
            ],
            "/api/v2/job_templates/": [
                {
                    "id": 7,
                    "name": "Configure web",
                    "organization": 1,
                    "inventory": 5,
                    "survey_enabled": True,
                    "related": {
                        "credentials": "/related/job/7/credentials/",
                        "survey_spec": "/related/job/7/survey/",
                    },
                }
            ],
            "/api/v2/projects/": [
                {
                    "id": 10,
                    "name": "EE Project",
                    "organization": 1,
                    "scm_type": "git",
                    "scm_url": "https://example.test/ee.git",
                    "related": {},
                }
            ],
            "/api/v2/quay/execution-environment-images/templates/": [
                {
                    "id": 11,
                    "name": "Build EE",
                    "description": "Build from Git",
                    "project": {"id": 10, "name": "EE Project"},
                    "namespace": "platform",
                    "repository": "demo-ee",
                    "tag": "latest",
                    "runtime": "podman",
                    "definition_file": "ee/execution-environment.yml",
                    "context": "ee",
                    "related": {},
                }
            ],
            "/api/v2/notification_templates/": [
                {
                    "id": 8,
                    "name": "Webhook",
                    "organization": 1,
                    "notification_type": "webhook",
                    "notification_configuration": {"url": "https://secret.example.test/hook", "headers": {"Authorization": "secret"}},
                    "messages": {},
                    "related": {},
                }
            ],
            "/api/v2/role_definitions/": [
                {"id": 9, "name": "Managed role", "managed": True, "content_type": "awx.inventory", "permissions": []},
            ],
            "/related/job/7/credentials/": [{"id": 4, "name": "Cloud API"}],
        }
        self.settings = {"CUSTOM_LOGIN_INFO": "Capstan", "SOCIAL_AUTH_PASSWORD": "$encrypted$"}

    def list(self, endpoint, match=None):
        rows = list(self.objects.get(endpoint, []))
        if match:
            rows = [row for row in rows if all(row.get(key) == value for key, value in match.items())]
        return rows

    def request(self, method, path, data=None):
        if method == "GET" and path == "/related/job/7/survey/":
            return {"name": "Web survey", "description": "", "spec": [{"variable": "port", "type": "integer", "default": 80}]}
        if method == "GET" and path == "/api/v2/settings/all/":
            return dict(self.settings)
        raise AssertionError(f"Unhandled request {method} {path} {data}")


class ExporterTests(unittest.TestCase):
    def setUp(self):
        self.client = FakeExportClient()

    def test_exports_portable_references_nested_endpoints_and_surveys(self):
        exporter = MODULE.ConfigurationExporter(self.client)
        document = exporter.export()
        resources = {resource["key"]: resource for resource in document["resources"]}

        self.assertNotIn("credential_type.machine", resources)
        credential = resources["credential.cloud_api"]
        self.assertEqual(credential["data"]["organization"], {"$ref": "organization.platform"})
        self.assertEqual(credential["data"]["inputs"]["endpoint"], "https://cloud.example.test")
        self.assertEqual(credential["data"]["inputs"]["token"], "${CAPSTAN_CREDENTIAL_CLOUD_API_TOKEN}")

        host = resources["host.web01"]
        self.assertEqual(host["endpoint"], {"$related": {"ref": "inventory.production", "name": "hosts"}})
        template = resources["job_template.configure_web"]
        self.assertEqual(template["associations"][0]["items"], [{"$ref": "credential.cloud_api"}])
        self.assertEqual(template["actions"][0]["path"], "survey_spec")
        self.assertEqual(
            exporter.secrets,
            {
                "CAPSTAN_CREDENTIAL_CLOUD_API_TOKEN",
                "CAPSTAN_NOTIFICATION_WEBHOOK_HEADERS_AUTHORIZATION",
                "CAPSTAN_NOTIFICATION_WEBHOOK_URL",
            },
        )

    def test_explicit_settings_only_and_secret_setting_placeholder(self):
        exporter = MODULE.ConfigurationExporter(
            self.client,
            selected_resources=set(),
            setting_names=["CUSTOM_LOGIN_INFO", "SOCIAL_AUTH_PASSWORD"],
        )
        document = exporter.export()
        self.assertEqual(document["settings"]["CUSTOM_LOGIN_INFO"], "Capstan")
        self.assertEqual(document["settings"]["SOCIAL_AUTH_PASSWORD"], "${CAPSTAN_SETTING_SOCIAL_AUTH_PASSWORD}")
        self.assertEqual(exporter.secrets, {"CAPSTAN_SETTING_SOCIAL_AUTH_PASSWORD"})

    def test_include_managed_controls_seed_resources(self):
        default = MODULE.ConfigurationExporter(self.client, selected_resources={"credential_type"}).export()
        managed = MODULE.ConfigurationExporter(self.client, include_managed=True, selected_resources={"credential_type"}).export()
        self.assertEqual(len(default["resources"]), 1)
        self.assertEqual(len(managed["resources"]), 2)

    def test_ee_build_template_exports_canonical_context(self):
        exporter = MODULE.ConfigurationExporter(self.client, selected_resources={"project", "ee_build_template"})
        document = exporter.export()
        resources = {resource["key"]: resource for resource in document["resources"]}

        template = resources["ee_build_template.build_ee"]
        self.assertEqual(template["data"]["project"], {"$ref": "project.ee_project"})
        self.assertEqual(template["data"]["context"], "ee")
        self.assertNotIn("context_path", template["data"])


if __name__ == "__main__":
    unittest.main()
