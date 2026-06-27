# AWX Deploy Roles

This tree deploys this repository's AWX build. It does not merge or pull AWX
application code from upstream.

Supported paths:

- `server`: containerized services on VMs, managed by systemd.
- `k3s`: install k3s, then deploy AWX into the cluster.
- `k8s`: deploy AWX into an existing Kubernetes cluster.
- `eda-server`: deploy EDA on a dedicated VM for server deployments.
- `eda-k8s`: deploy EDA beside AWX in k3s or Kubernetes.
- `opa-server`: deploy standalone OPA on a dedicated VM/container host.
- `gatekeeper-k8s`: deploy Gatekeeper into k3s or Kubernetes.

Server roles are componentized. A single host can belong to every group, or
components can be split across multiple hosts:

- `awx_database`
- `awx_redis`
- `awx_web`
- `awx_task`
- `awx_receptor`
- `awx_lb`

For a single-node install, put the same host in `awx_database`, `awx_redis`,
`awx_web`, `awx_task`, and `awx_receptor`. The Receptor role runs from the AWX
image so local execution has `ansible-runner` and the same mounted project,
media, and container storage paths as AWX.

Secrets must be passed through environment variables, vault, or extra vars.
Do not commit `group_vars/all.yml` with real passwords.

EDA is intentionally a separate workload. For k3s/k8s, EDA runs as separate
pods in the same cluster through the upstream EDA Server Operator. For direct
server deployments, EDA runs on hosts in the `awx_eda` inventory group as its
own Docker Compose/systemd stack. See
`docs/eda_deployment_topology.md` for the non-native AWX topology contract.

Policy services are intentionally split. OPA is a standalone policy engine and
can run on hosts in the `awx_opa` inventory group or any external OPA endpoint.
Gatekeeper is Kubernetes-only and is deployed only in k3s/k8s paths unless a
server AWX install is explicitly configured to manage a remote Kubernetes API.
See `docs/policy_deployment_topology.md`.

VMware/vCenter provisioning is intentionally separate from the AWX deployment
roles. The `server`, `k3s`, and `k8s` paths do not depend on VMware variables
or collections. Use the VMware-only requirements and vars example only when
running `playbooks/vcenter-lab.yml`.

## Quick Start: Server

```bash
cd tools/awx-deploy/ansible
cp group_vars/all.yml.example group_vars/all.yml
export AWX_ADMIN_PASSWORD='change-me'
export AWX_POSTGRES_PASSWORD='change-me'
ansible-playbook -i inventories/example.ini playbooks/deploy-server.yml
```

## Quick Start: Existing Kubernetes

```bash
cd tools/awx-deploy/ansible
export KUBECONFIG=/path/to/kubeconfig
export AWX_ADMIN_PASSWORD='change-me'
export AWX_POSTGRES_PASSWORD='change-me'
ansible-playbook -i localhost, playbooks/deploy-k8s.yml
```

To expose AWX through a node port instead of an ingress, set:

```bash
ansible-playbook -i localhost, playbooks/deploy-k8s.yml \
  -e awx_k8s_service_type=NodePort \
  -e awx_k8s_node_port=30813
```

## Quick Start: k3s

```bash
cd tools/awx-deploy/ansible
export AWX_ADMIN_PASSWORD='change-me'
export AWX_POSTGRES_PASSWORD='change-me'
ansible-playbook -i inventories/example.ini playbooks/deploy-k3s.yml
```

To install k3s without deploying AWX, use:

```bash
ansible-playbook -i inventories/example.ini playbooks/install-k3s.yml
```

To deploy EDA alongside AWX on k3s, enable EDA:

```bash
export EDA_ADMIN_PASSWORD='change-me'
ansible-playbook -i inventories/example.ini playbooks/deploy-k3s.yml \
  -e awx_eda_enabled=true \
  -e awx_eda_configure_awx_settings=true
```

## Quick Start: EDA on Server VM

For direct server AWX deployments, put EDA on a dedicated VM in the `awx_eda`
inventory group:

```bash
cd tools/awx-deploy/ansible
export EDA_ADMIN_PASSWORD='change-me'
ansible-playbook -i inventories/example.ini playbooks/deploy-eda-server.yml
```

Then configure AWX to point at that VM and rerun the AWX server deployment or
upgrade:

```bash
ansible-playbook -i inventories/example.ini playbooks/deploy-server.yml \
  -e awx_eda_configure_awx_settings=true
```

## Quick Start: EDA on Existing Kubernetes

```bash
cd tools/awx-deploy/ansible
export KUBECONFIG=/path/to/kubeconfig
export EDA_ADMIN_PASSWORD='change-me'
ansible-playbook -i localhost, playbooks/deploy-eda-k8s.yml
ansible-playbook -i localhost, playbooks/deploy-k8s.yml \
  -e awx_eda_enabled=true \
  -e awx_eda_configure_awx_settings=true
```

## Quick Start: OPA on Server VM

For direct server AWX deployments, put OPA on a dedicated VM in the `awx_opa`
inventory group:

```bash
cd tools/awx-deploy/ansible
ansible-playbook -i inventories/example.ini playbooks/deploy-opa-server.yml
```

Then configure AWX to point at that VM and rerun the AWX server deployment or
upgrade:

```bash
ansible-playbook -i inventories/example.ini playbooks/deploy-server.yml \
  -e awx_opa_enabled=true \
  -e awx_opa_configure_awx_settings=true
```

## Quick Start: Gatekeeper on k3s/Kubernetes

Gatekeeper is a Kubernetes admission controller. Enable it only for k3s/k8s
deployments or when AWX is managing a remote cluster through an explicit API
URL/token.

```bash
cd tools/awx-deploy/ansible
export KUBECONFIG=/path/to/kubeconfig
ansible-playbook -i localhost, playbooks/deploy-gatekeeper-k8s.yml
ansible-playbook -i localhost, playbooks/deploy-k8s.yml \
  -e awx_gatekeeper_enabled=true \
  -e awx_gatekeeper_configure_awx_settings=true
```

For k3s, use `playbooks/deploy-k3s.yml` with the same variables. The AWX
service account receives Gatekeeper read/write RBAC only when
`awx_gatekeeper_configure_awx_settings=true`.

## Backup / Restore

```bash
ansible-playbook -i inventories/example.ini playbooks/backup.yml
ansible-playbook -i inventories/example.ini playbooks/restore.yml \
  -e awx_restore_confirm=true \
  -e awx_restore_path=/var/backups/awx/awx-20260625T010101Z
```

## EDA Live Smoke

After deploying AWX with Event-Driven Ansible enabled, run the repeatable smoke
wrapper from the repository root. It checks AWX root/static assets, authenticated
API access, EDA Controller status, live EDA Controller-backed resource list
endpoints, AWX-to-EDA RBAC sync preview, anonymous access denial, and optional
RBAC/project/activation flows.

```bash
export AWX_PASSWORD='change-me'
python3 tools/awx-deploy/scripts/smoke_eda.py \
  --url http://awx.example.com \
  --username admin
```

In local development, point `--url` at the frontend dev server, for example
`http://localhost:4012`, so the root/static asset check exercises the UI bundle
as well as proxied API calls.

To prove multiple deployment paths in one run:

```bash
export AWX_PASSWORD='change-me'
export AWX_URLS='http://direct.example.com http://k3s.example.com http://lb.example.com'
python3 tools/awx-deploy/scripts/smoke_eda.py
```

Optional checks:

- `--rbac-username` / `--rbac-password` verifies an EDA operator or non-admin
  user has the expected read status and cannot mutate EDA resources by default.
- `--project-url` creates a temporary EDA project, syncs it, polls import state,
  discovers the imported rulebooks, and deletes it.
- `--start-project-rulebook` extends `--project-url` into full E2E proof by
  launching a rulebook discovered from that temporary project, reading
  detail/events, and cleaning up the activation before deleting the project. Use
  `--project-rulebook-name` to select a known-safe rulebook.
- `--rulebook-id` launches a temporary activation, reads detail/logs, and
  deletes it. Add `--decision-environment-id`, `--organization-id`, and
  `--eda-credential-id` when the selected rulebook needs them.
- `--allow-non-controller-source` permits non-live/mock resource responses. By
  default, EDA resource list checks must report `source=eda_controller`.
- `--json-output /path/to/report.json` writes machine-readable evidence with
  per-URL and total duration fields for upgrade comparisons.

## vCenter Lab

Set credentials only in environment variables. The Ansible control node must
have `community.vmware` and a working `pyVmomi` / `pyVim` import path.

```bash
ansible-galaxy collection install -r requirements-vmware.yml
cp vars/vcenter-lab.yml.example vars/vcenter-lab.yml
export VCENTER_HOSTNAME=vcenter.example.com
export VCENTER_USERNAME='administrator@example.local'
read -rsp "vCenter password: " VCENTER_PASSWORD; export VCENTER_PASSWORD
ansible-playbook -i localhost, playbooks/vcenter-lab.yml -e @vars/vcenter-lab.yml
```

Set `awx_vcenter_datastore` to a management-local VMFS datastore. The lab role
rejects datastore names containing `truenas`, requires the selected datastore to
match `awx_vcenter_allowed_datastore_types` (default: `["VMFS"]`), and only
allows the management datastores listed in `awx_vcenter_allowed_datastore_names`
(default: `["datastore1", "datastore1 (1)"]`). It also verifies the actual
cloned disk backing after vCenter completes the clone, because a clone request
can otherwise report success while the disk lands on the wrong backing
datastore. Template disk backing is verified before clone as well; if vCenter
still creates a VM on a forbidden or unapproved datastore, the role deletes the
bad clone by default before failing the run.

By default the role writes a generated inventory to
`/tmp/awx-vcenter-lab.ini`. Use that file as the input to `deploy-server.yml`
after the cloned VM template has working SSH access:

```bash
ansible-playbook -i /tmp/awx-vcenter-lab.ini playbooks/deploy-server.yml
```
