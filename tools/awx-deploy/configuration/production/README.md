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
```

Copy `awx-ziadsaleemi.env.example` to `awx-ziadsaleemi.env` for local use. The
real `.env` file is ignored by the repository. Repeat reconciliation after any
manifest change; unchanged resources are left intact and encrypted credential
values are preserved.

The production k8s deployment also needs to resolve the private vCenter name
from both web and task pods. Pass
`ansible/vars/awx-ziadsaleemi.yml.example` (or an environment-specific copy) to
Capstan Deploy so the `awx_k8s_host_aliases` entry is rendered into both pod
specifications. This keeps TLS hostname verification intact while allowing the
provider pull to reach the private vCenter address.
