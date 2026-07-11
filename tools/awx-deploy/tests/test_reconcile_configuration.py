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


if __name__ == "__main__":
    unittest.main()
