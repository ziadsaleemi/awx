import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).parents[3]
ROLES = REPO_ROOT / "tools" / "awx-deploy" / "ansible" / "roles"


class KubernetesResilienceTests(unittest.TestCase):
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
