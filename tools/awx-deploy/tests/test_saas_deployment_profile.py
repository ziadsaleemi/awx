import unittest
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

REPO_ROOT = Path(__file__).parents[3]
ROLE_ROOT = REPO_ROOT / "tools/awx-deploy/ansible/roles"


class SaasDeploymentProfileTests(unittest.TestCase):
    def test_defaults_are_on_prem_and_registration_is_closed(self):
        defaults = (ROLE_ROOT / "awx_deploy_common/defaults/main.yml").read_text()

        self.assertIn("awx_product_mode: on_prem", defaults)
        self.assertIn("awx_saas_registration_enabled: false", defaults)
        self.assertIn("awx_saas_require_external_execution:", defaults)
        self.assertIn("'control' if awx_product_mode == 'saas'", defaults)

    def test_server_receptor_has_no_work_handler_in_saas(self):
        template_dir = ROLE_ROOT / "awx_deploy_common/templates"
        environment = Environment(loader=FileSystemLoader(template_dir), autoescape=False)
        environment.filters["bool"] = bool
        template = environment.get_template("receptor.conf.j2")
        context = {
            "inventory_hostname": "control-1",
            "awx_receptor_log_level": "info",
            "awx_receptor_enable_tcp_listener": True,
            "awx_receptor_listen_port": 2222,
            "awx_receptor_peer_hosts": [],
            "hostvars": {},
            "awx_receptor_socket_file": "/var/run/receptor/receptor.sock",
            "awx_receptor_work_type": "local",
            "awx_receptor_runner_command": "/usr/bin/ansible-runner",
            "awx_receptor_enable_work_signing": False,
        }

        on_prem = template.render(awx_product_mode="on_prem", **context)
        saas = template.render(awx_product_mode="saas", **context)

        self.assertIn("work-command:", on_prem)
        self.assertIn("ansible-runner", on_prem)
        self.assertNotIn("work-command:", saas)
        self.assertNotIn("ansible-runner", saas)
        self.assertIn("control-service:", saas)

    def test_server_and_kubernetes_render_product_contract(self):
        server_settings = (ROLE_ROOT / "awx_deploy_common/templates/settings.py.j2").read_text()
        kubernetes = (ROLE_ROOT / "awx_k8s/templates/00-core.yml.j2").read_text()

        for source in (server_settings, kubernetes):
            self.assertIn("CAPSTAN_PRODUCT_MODE = {{ awx_product_mode | to_json }}", source)
            self.assertIn("CAPSTAN_SAAS_REGISTRATION_ENABLED", source)
            self.assertIn("CAPSTAN_SAAS_REGISTRATION_RATE_LIMIT", source)
            self.assertIn("CAPSTAN_SAAS_REQUIRE_EXTERNAL_EXECUTION", source)

    def test_saas_task_nodes_are_control_only(self):
        task_service = (ROLE_ROOT / "awx_task/templates/awx-task.service.j2").read_text()

        self.assertIn("--node_type {{ awx_effective_instance_node_type }}", task_service)
        self.assertNotIn("--node_type {{ awx_instance_node_type }}", task_service)

    def test_kubernetes_work_handlers_are_on_prem_only(self):
        kubernetes = (ROLE_ROOT / "awx_k8s/templates/00-core.yml.j2").read_text()
        receptor_fragment = kubernetes[kubernetes.index("  receptor.conf: |") :]
        template = Environment(autoescape=False).from_string(receptor_fragment)
        context = {
            "awx_receptor_log_level": "info",
            "awx_receptor_work_type": "local",
            "awx_receptor_runner_command": "/usr/bin/ansible-runner",
        }

        on_prem = template.render(awx_product_mode="on_prem", **context)
        saas = template.render(awx_product_mode="saas", **context)

        self.assertIn("work-command:", on_prem)
        self.assertEqual(on_prem.count("work-kubernetes:"), 2)
        self.assertNotIn("work-command:", saas)
        self.assertNotIn("work-kubernetes:", saas)
        for rendered in (on_prem, saas):
            self.assertIn("work-signing:", rendered)
            self.assertIn("work-verification:", rendered)
            self.assertIn("control-service:", rendered)


if __name__ == "__main__":
    unittest.main()
