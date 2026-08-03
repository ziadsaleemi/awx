import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).parents[3]
ROLES = REPO_ROOT / "tools" / "awx-deploy" / "ansible" / "roles"


class KubernetesResilienceTests(unittest.TestCase):
    def test_capstan_runtime_uid_and_project_volume_contract(self):
        dockerfile = (REPO_ROOT / "tools" / "ansible" / "roles" / "dockerfile" / "templates" / "Dockerfile.j2").read_text()
        deployment = (ROLES / "awx_k8s" / "templates" / "30-awx.yml.j2").read_text()

        self.assertIn("useradd --uid 1000 --gid 0", dockerfile)
        self.assertIn('getent passwd 1000 | cut -d: -f1,3,4,6', dockerfile)
        self.assertIn("name: init-project-permissions", deployment)
        self.assertIn("chown -R 1000:0 /var/lib/awx/projects", deployment)
        self.assertIn("runAsUser: 0", deployment)

    def test_control_plane_execution_image_has_runtime_uid_contract(self):
        containerfile = (REPO_ROOT / "tools" / "awx-deploy" / "support" / "control-plane-ee" / "Containerfile").read_text()
        common_defaults = (ROLES / "awx_deploy_common" / "defaults" / "main.yml").read_text()
        server_settings = (ROLES / "awx_deploy_common" / "templates" / "settings.py.j2").read_text()
        k8s_settings = (ROLES / "awx_k8s" / "templates" / "00-core.yml.j2").read_text()

        self.assertIn("getent passwd 1000", containerfile)
        self.assertIn("USER 1000", containerfile)
        self.assertIn("awx_control_plane_ee_image:", common_defaults)
        self.assertIn('CONTROL_PLANE_EXECUTION_ENVIRONMENT = "{{ awx_control_plane_ee_image }}"', server_settings)
        self.assertIn('CONTROL_PLANE_EXECUTION_ENVIRONMENT = "{{ awx_control_plane_ee_image }}"', k8s_settings)

    def test_eda_operator_single_replica_resilience_defaults(self):
        role_defaults = (ROLES / "awx_eda_k8s" / "defaults" / "main.yml").read_text()
        common_defaults = (ROLES / "awx_deploy_common" / "defaults" / "main.yml").read_text()

        for defaults in (role_defaults, common_defaults):
            self.assertIn("awx_eda_k8s_operator_leader_election_enabled: false", defaults)
            self.assertIn("awx_eda_k8s_operator_liveness_timeout_seconds: 5", defaults)
            self.assertIn("awx_eda_k8s_operator_readiness_timeout_seconds: 5", defaults)

    def test_eda_operator_patch_is_applied_by_kustomize(self):
        kustomization = (ROLES / "awx_eda_k8s" / "templates" / "kustomization.yaml.j2").read_text()
        operator_patch = (ROLES / "awx_eda_k8s" / "templates" / "operator-patch.yml.j2").read_text()
        tasks = (ROLES / "awx_eda_k8s" / "tasks" / "main.yml").read_text()

        self.assertIn("path: operator-patch.yml", kustomization)
        self.assertIn("name: {{ awx_eda_k8s_operator_deployment }}", kustomization)
        self.assertIn("- operator-patch.yml", tasks)
        self.assertIn("name: eda-manager", operator_patch)
        self.assertIn("awx_eda_k8s_operator_leader_election_enabled", operator_patch)
        self.assertIn("timeoutSeconds:", operator_patch)
        self.assertIn("failureThreshold:", operator_patch)


if __name__ == "__main__":
    unittest.main()
