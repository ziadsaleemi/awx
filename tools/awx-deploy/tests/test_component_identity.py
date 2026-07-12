import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).parents[3]


class ComponentIdentityTests(unittest.TestCase):
    def test_image_entrypoints_set_component_identity(self):
        web = (REPO_ROOT / "tools/ansible/roles/dockerfile/files/launch_awx_web.sh").read_text()
        task = (REPO_ROOT / "tools/ansible/roles/dockerfile/files/launch_awx_task.sh").read_text()
        self.assertIn("export AWX_COMPONENT=web", web)
        self.assertIn("export AWX_COMPONENT=task", task)

    def test_kubernetes_workloads_set_component_identity(self):
        deployment = (REPO_ROOT / "tools/awx-deploy/ansible/roles/awx_k8s/templates/30-awx.yml.j2").read_text()
        self.assertIn("value: web", deployment)
        self.assertIn("value: task", deployment)
        self.assertEqual(deployment.count("- name: AWX_COMPONENT"), 2)

    def test_kubernetes_workloads_support_host_aliases(self):
        defaults = (REPO_ROOT / "tools/awx-deploy/ansible/roles/awx_deploy_common/defaults/main.yml").read_text()
        deployment = (REPO_ROOT / "tools/awx-deploy/ansible/roles/awx_k8s/templates/30-awx.yml.j2").read_text()

        self.assertIn("awx_k8s_host_aliases: []", defaults)
        self.assertEqual(deployment.count("hostAliases:"), 2)
        self.assertEqual(deployment.count("awx_k8s_host_aliases | to_nice_yaml"), 2)

    def test_direct_server_units_set_component_identity(self):
        web = (REPO_ROOT / "tools/awx-deploy/ansible/roles/awx_web/templates/awx-web.service.j2").read_text()
        task = (REPO_ROOT / "tools/awx-deploy/ansible/roles/awx_task/templates/awx-task.service.j2").read_text()
        self.assertIn("-e AWX_COMPONENT=web", web)
        self.assertIn("-e AWX_COMPONENT=task", task)


if __name__ == "__main__":
    unittest.main()
