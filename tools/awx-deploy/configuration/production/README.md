# awx.ziadsaleemi.com desired state

This directory is the source of truth for controller content created on
`awx.ziadsaleemi.com`. Secret values are never stored in these manifests.

Apply the foundation first. It creates projects and starts their initial SCM
updates. Wait for all three project updates to finish successfully before
applying content because Capstan validates job playbooks and EE definition
files against the synchronized project checkout.

```bash
cd tools/awx-deploy
set -a
. configuration/production/awx-ziadsaleemi.env
set +a

python3 scripts/reconcile_configuration.py --check \
  configuration/production/awx-ziadsaleemi-foundation.yml
python3 scripts/reconcile_configuration.py \
  configuration/production/awx-ziadsaleemi-foundation.yml

# Wait for R92 Terraform Demo, R92 Execution Environment Demo, and
# R92 Collections Demo project updates to report successful.
python3 scripts/reconcile_configuration.py --check \
  configuration/production/awx-ziadsaleemi-content.yml
python3 scripts/reconcile_configuration.py \
  configuration/production/awx-ziadsaleemi-content.yml

# Reconcile the independently versioned DaVault collection release pipeline.
python3 scripts/reconcile_configuration.py --check \
  configuration/production/awx-ziadsaleemi-davault.yml
python3 scripts/reconcile_configuration.py \
  configuration/production/awx-ziadsaleemi-davault.yml

# Reconcile the LINOOP DaVault organization only when its scoped secret
# environment is available. Apply once, wait for project and inventory sync,
# then apply again so playbook-backed templates can be validated.
python3 scripts/reconcile_configuration.py --check \
  configuration/production/awx-ziadsaleemi-davault-linoop.yml
python3 scripts/reconcile_configuration.py \
  configuration/production/awx-ziadsaleemi-davault-linoop.yml
```

Copy `awx-ziadsaleemi.env.example` to `awx-ziadsaleemi.env` for local use. The
real `.env` file is ignored by the repository. Repeat reconciliation after any
manifest change; unchanged resources are left intact and encrypted credential
values are preserved.

The DaVault manifest requires a repository-scoped GitHub read token and a
Galaxy NG publish token. It creates a dedicated Project, versioned credential
contract, release-sync Job Template, and daily schedule. The job reads an
immutable GitHub release artifact, uploads a missing version to staging, moves
it to published, and performs no mutations when that version is already
published.

The LINOOP DaVault manifest uses a repository-scoped read-only SSH deploy key,
not a GitHub API token, and therefore uses the SSH SCM URL. If this is changed
to token authentication, use the repository HTTPS URL. It keeps target account
material and the tenant-scoped DaVault workload token in separate encrypted
Capstan credentials. Do not substitute a browser session or human administrator
token for the workload identity. The onboarding template must not be launched
until that bounded workload identity has been issued and attached.

The vSphere Terraform module persists state in Azure Blob Storage. Supply the
`AZURE_*` values for an identity with `Storage Blob Data Contributor` access to
the configured state storage account. Both the apply and destroy templates
receive this backend credential in addition to the vCenter provider credential.

The production k8s deployment also needs to resolve the private vCenter name
from both web and task pods. Pass
`ansible/vars/awx-ziadsaleemi.yml.example` (or an environment-specific copy) to
Capstan Deploy so the `awx_k8s_host_aliases` entry is rendered into both pod
specifications. This keeps TLS hostname verification intact while allowing the
provider pull to reach the private vCenter address.

The same production vars file enables `awx_k8s_ee_builds_enabled` so saved EE
templates can run Podman/buildah and push images to Project Quay. This setting
runs the Capstan task container as privileged root and should remain disabled
on clusters that do not build images. Place task pods on nodes with enough
ephemeral storage for the base image, build context, and generated layers.
