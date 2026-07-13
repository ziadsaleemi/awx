import importlib.util
import json
import os
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "reconcile_configuration.py"
SPEC = importlib.util.spec_from_file_location("reconcile_configuration", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class FakeClient:
    def __init__(self):
        self.objects = {
            "/api/v2/organizations/": [{"id": 1, "url": "/api/v2/organizations/1/", "name": "Default"}],
            "/api/v2/credentials/": [{"id": 2, "url": "/api/v2/credentials/2/", "name": "Machine", "inputs": {"password": "$encrypted$"}}],
            "/api/v2/inventories/": [],
            "/api/v2/job_templates/": [],
        }
        self.settings = {"CUSTOM_LOGIN_INFO": "old"}
        self.associations = {}
        self.next_id = 10

    def list(self, endpoint, match=None):
        if endpoint in self.associations:
            ids = self.associations[endpoint]
            return [{"id": item} for item in sorted(ids)]
        results = self.objects.get(endpoint, [])
        if not match:
            return list(results)
        return [item for item in results if all(item.get(key) == value for key, value in match.items())]

    def request(self, method, path, data=None):
        if path == "/api/v2/settings/all/":
            if method == "GET":
                return dict(self.settings)
            self.settings.update(data)
            return dict(self.settings)
        if method == "POST" and path in self.objects:
            created = {"id": self.next_id, "url": f"{path}{self.next_id}/", **data}
            self.next_id += 1
            self.objects[path].append(created)
            return created
        if method == "PATCH":
            for endpoint, objects in self.objects.items():
                for item in objects:
                    if item.get("url") == path:
                        item.update(data)
                        return item
        if method == "POST" and data and (data.get("associate") or data.get("disassociate")):
            ids = self.associations.setdefault(path, set())
            if data.get("associate"):
                ids.add(data["id"])
            else:
                ids.discard(data["id"])
            return None
        if method == "DELETE":
            for endpoint, objects in self.objects.items():
                self.objects[endpoint] = [item for item in objects if item.get("url") != path]
            return None
        raise AssertionError(f"Unhandled request {method} {path} {data}")


class ManifestTests(unittest.TestCase):
    def test_production_integration_demo_wires_eda_opa_gatekeeper_and_quay(self):
        configuration = Path(__file__).parents[1] / "configuration" / "production"
        environment = {
            "VCENTER_HOST": "vcenter.example.test",
            "VCENTER_USERNAME": "svc-capstan@example.test",
            "VCENTER_PASSWORD": "preserved-secret",
            "AZURE_SUBSCRIPTION_ID": "00000000-0000-0000-0000-000000000001",
            "AZURE_CLIENT_ID": "00000000-0000-0000-0000-000000000002",
            "AZURE_CLIENT_SECRET": "preserved-azure-secret",
            "AZURE_TENANT_ID": "00000000-0000-0000-0000-000000000003",
        }
        with mock.patch.dict(os.environ, environment, clear=False):
            foundation = MODULE.load_manifests([configuration / "awx-ziadsaleemi-foundation.yml"])
            content = MODULE.load_manifests([configuration / "awx-ziadsaleemi-content.yml"])

        foundation_resources = {resource["key"]: resource for resource in foundation["resources"]}
        content_resources = {resource["key"]: resource for resource in content["resources"]}

        self.assertEqual(
            foundation_resources["project.integrations_demo"]["data"]["scm_url"],
            "https://github.com/ziadsaleemi/capstan-integrations-demo.git",
        )
        self.assertEqual(
            foundation_resources["eda.project.integrations_demo"]["data"]["url"],
            "https://github.com/ziadsaleemi/capstan-integrations-demo.git",
        )
        self.assertEqual(
            foundation_resources["eda.decision_environment.demo"]["data"]["image_url"],
            "quay.io/ansible/ansible-rulebook:latest",
        )

        actions = content_resources["project.integrations_demo"]["actions"]
        self.assertEqual(actions[0]["path"], "/api/v2/opa/policy-modules/project-sync/")
        self.assertEqual(actions[0]["data"]["path"], "opa/**/*.rego")
        self.assertEqual(actions[1]["path"], "/api/v2/opa/gatekeeper/project-sync/")
        self.assertTrue(actions[1]["data"]["human_approved"])
        self.assertEqual(actions[1]["data"]["apply_strategy"], "server_side")

        ee_template = content_resources["ee_template.integrations_demo"]
        self.assertEqual(ee_template["data"]["project"], {"$ref": "project.integrations_demo"})
        self.assertEqual(ee_template["data"]["definition_file"], "ee/execution-environment.yml")

    def test_production_vsphere_catalog_uses_surveyed_workflow(self):
        manifest_path = Path(__file__).parents[1] / "configuration" / "production" / "awx-ziadsaleemi-content.yml"
        environment = {
            "VCENTER_HOST": "vcenter.example.test",
            "VCENTER_USERNAME": "svc-capstan@example.test",
            "VCENTER_PASSWORD": "preserved-secret",
            "AZURE_SUBSCRIPTION_ID": "00000000-0000-0000-0000-000000000001",
            "AZURE_CLIENT_ID": "00000000-0000-0000-0000-000000000002",
            "AZURE_CLIENT_SECRET": "preserved-azure-secret",
            "AZURE_TENANT_ID": "00000000-0000-0000-0000-000000000003",
        }
        with mock.patch.dict(os.environ, environment, clear=False):
            manifest = MODULE.load_manifests([manifest_path])
        resources = {resource["key"]: resource for resource in manifest["resources"]}

        workflow = resources["workflow.vsphere_provision"]
        node = resources["workflow_node.vsphere_terraform"]
        destroy_template = resources["terraform.vsphere_destroy"]
        deprovision_workflow = resources["workflow.vsphere_deprovision"]
        deprovision_node = resources["workflow_node.vsphere_destroy"]
        catalog = resources["catalog.vsphere_vm"]
        self.assertTrue(workflow["data"]["survey_enabled"])
        self.assertEqual(len(workflow["actions"][0]["data"]["spec"]), 9)
        self.assertEqual(node["data"]["unified_job_template"], {"$ref": "terraform.vsphere_apply"})
        self.assertEqual(destroy_template["data"]["terraform_operation"], "destroy")
        self.assertEqual(
            destroy_template["associations"][0]["items"],
            [{"$ref": "credential.vsphere"}, {"$ref": "credential.azure_terraform_backend"}],
        )
        self.assertTrue(deprovision_workflow["data"]["survey_enabled"])
        self.assertEqual(deprovision_node["data"]["unified_job_template"], {"$ref": "terraform.vsphere_destroy"})
        self.assertEqual(catalog["data"]["provision_workflow"], {"$ref": "workflow.vsphere_provision"})
        self.assertEqual(catalog["data"]["deprovision_workflow"], {"$ref": "workflow.vsphere_deprovision"})
        self.assertEqual(catalog["data"]["provider_workflows"]["vmware"], {"$ref": "workflow.vsphere_provision"})
        self.assertEqual(
            catalog["data"]["provider_deprovision_workflows"]["vmware"],
            {"$ref": "workflow.vsphere_deprovision"},
        )
        self.assertIsNone(catalog["data"]["terraform_job_template"])

    def test_environment_expansion_is_strict_and_supports_defaults(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            path.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "settings": {"A": "${CAPSTAN_TEST_VALUE}", "B": "${CAPSTAN_MISSING:-fallback}"},
                        "resources": [],
                    }
                )
            )
            with mock.patch.dict(os.environ, {"CAPSTAN_TEST_VALUE": "secret"}, clear=False):
                manifest = MODULE.load_manifests([path])
            self.assertEqual(manifest["settings"], {"A": "secret", "B": "fallback"})

    def test_missing_environment_variable_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            path.write_text(json.dumps({"version": 1, "settings": {"A": "${CAPSTAN_DOES_NOT_EXIST}"}}))
            with self.assertRaisesRegex(MODULE.ConfigurationError, "CAPSTAN_DOES_NOT_EXIST"):
                MODULE.load_manifests([path])

    def test_sensitive_environment_values_are_redacted(self):
        with mock.patch.dict(os.environ, {"CAPSTAN_TEST_PASSWORD": "do-not-print-this"}, clear=False):
            message = MODULE._redact_sensitive("API rejected do-not-print-this")
        self.assertEqual(message, "API rejected **********")


class ReconcilerTests(unittest.TestCase):
    def setUp(self):
        self.client = FakeClient()
        self.manifest = {
            "settings": {"CUSTOM_LOGIN_INFO": "managed"},
            "resources": [
                {"key": "org.default", "endpoint": "organizations", "match": {"name": "Default"}, "data": {"name": "Default"}},
                {
                    "key": "inventory.demo",
                    "endpoint": "inventories",
                    "match": {"name": "Code Inventory", "organization": {"$ref": "org.default"}},
                    "data": {"name": "Code Inventory", "organization": {"$ref": "org.default"}},
                },
                {
                    "key": "credential.machine",
                    "endpoint": "credentials",
                    "match": {"name": "Machine"},
                    "data": {"name": "Machine", "inputs": {"password": "new-secret"}},
                },
                {
                    "key": "template.demo",
                    "endpoint": "job_templates",
                    "match": {"name": "Code Template", "organization": {"$ref": "org.default"}},
                    "data": {"name": "Code Template", "organization": {"$ref": "org.default"}, "inventory": {"$ref": "inventory.demo"}},
                    "associations": [{"name": "credentials", "items": [{"$ref": "credential.machine"}], "exact": True}],
                },
            ],
        }

    def test_create_references_associations_and_idempotency(self):
        first = MODULE.ConfigurationReconciler(self.client).reconcile(self.manifest)
        self.assertEqual(first["created"], 2)
        self.assertEqual(first["updated"], 1)
        self.assertEqual(first["associated"], 1)
        self.assertEqual(self.client.settings["CUSTOM_LOGIN_INFO"], "managed")
        template = self.client.objects["/api/v2/job_templates/"][0]
        inventory = self.client.objects["/api/v2/inventories/"][0]
        self.assertEqual(template["inventory"], inventory["id"])

        second = MODULE.ConfigurationReconciler(self.client).reconcile(self.manifest)
        self.assertEqual(second["created"], 0)
        self.assertEqual(second["updated"], 0)
        self.assertEqual(second["associated"], 0)

    def test_absent_deletes_matching_resource(self):
        MODULE.ConfigurationReconciler(self.client).reconcile(self.manifest)
        delete_manifest = {
            "resources": [
                {
                    "key": "template.demo",
                    "endpoint": "job_templates",
                    "match": {"name": "Code Template", "organization": 1},
                    "state": "absent",
                }
            ]
        }
        result = MODULE.ConfigurationReconciler(self.client).reconcile(delete_manifest)
        self.assertEqual(result["deleted"], 1)
        self.assertEqual(self.client.objects["/api/v2/job_templates/"], [])

    def test_pending_deletion_is_idempotent(self):
        self.client.objects["/api/v2/inventories/"] = [
            {
                "id": 20,
                "url": "/api/v2/inventories/20/",
                "name": "Pending Inventory",
                "pending_deletion": True,
            }
        ]
        manifest = {
            "resources": [
                {
                    "key": "inventory.pending",
                    "endpoint": "inventories",
                    "match": {"name": "Pending Inventory"},
                    "state": "absent",
                }
            ]
        }
        result = MODULE.ConfigurationReconciler(self.client).reconcile(manifest)
        self.assertEqual(result["deleted"], 0)
        self.assertEqual(result["resources"], [{"key": "inventory.pending", "action": "pending_deletion"}])

    def test_api_trimmed_multiline_values_are_equal(self):
        self.assertFalse(MODULE.ConfigurationReconciler._different("key: value", "key: value\n"))

    def test_summarized_relation_object_equals_desired_id(self):
        self.assertFalse(MODULE.ConfigurationReconciler._different({"id": 42, "name": "Project"}, 42))
        self.assertTrue(MODULE.ConfigurationReconciler._different({"id": 42, "name": "Project"}, 43))

    def test_related_endpoint_uses_prior_resource_detail_url(self):
        reconciler = MODULE.ConfigurationReconciler(self.client)
        reconciler.registry["inventory.demo"] = MODULE.ResourceState(
            "inventory.demo",
            "/api/v2/inventories/",
            {"id": 42, "url": "/api/v2/inventories/42/"},
            "unchanged",
        )
        self.assertEqual(
            reconciler._resource_endpoint({"$related": {"ref": "inventory.demo", "name": "hosts"}}),
            "/api/v2/inventories/42/hosts/",
        )

    def test_detail_path_does_not_treat_eda_scm_url_as_api_url(self):
        self.assertEqual(
            MODULE.ConfigurationReconciler._detail_path(
                "/api/v2/eda/projects/",
                {
                    "id": 7,
                    "url": "https://github.com/ziadsaleemi/capstan-integrations-demo.git",
                },
            ),
            "/api/v2/eda/projects/7/",
        )

    def test_detail_path_accepts_absolute_api_url(self):
        self.assertEqual(
            MODULE.ConfigurationReconciler._detail_path(
                "/api/v2/projects/",
                {"id": 9, "url": "https://capstan.example.test/api/v2/projects/9/"},
            ),
            "https://capstan.example.test/api/v2/projects/9/",
        )

    def test_check_mode_does_not_query_synthetic_parent_related_endpoint(self):
        manifest = {
            "resources": [
                {
                    "key": "inventory.new",
                    "endpoint": "inventories",
                    "match": {"name": "New Inventory"},
                    "data": {"name": "New Inventory"},
                },
                {
                    "key": "group.new",
                    "endpoint": {"$related": {"ref": "inventory.new", "name": "groups"}},
                    "match": {"name": "provisioned", "inventory": {"$ref": "inventory.new"}},
                    "data": {"name": "provisioned", "inventory": {"$ref": "inventory.new"}},
                },
            ]
        }

        original_list = self.client.list

        def reject_synthetic_endpoint(endpoint, match=None):
            self.assertNotRegex(endpoint, r"/-\d+/")
            return original_list(endpoint, match)

        with mock.patch.object(self.client, "list", side_effect=reject_synthetic_endpoint):
            result = MODULE.ConfigurationReconciler(self.client, check_mode=True).reconcile(manifest)

        self.assertEqual(result["created"], 2)
        self.assertEqual(result["resources"][-1], {"key": "group.new", "action": "created"})


if __name__ == "__main__":
    unittest.main()
