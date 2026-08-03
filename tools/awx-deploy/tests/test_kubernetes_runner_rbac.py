import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
CORE_MANIFEST = REPO_ROOT / "tools/awx-deploy/ansible/roles/awx_k8s/templates/00-core.yml.j2"


class KubernetesRunnerRbacTests(unittest.TestCase):
    def test_runner_streaming_subresources_are_allowed(self):
        manifest = CORE_MANIFEST.read_text()

        self.assertIn('"pods/exec"', manifest)
        self.assertIn('"pods/attach"', manifest)


if __name__ == "__main__":
    unittest.main()
