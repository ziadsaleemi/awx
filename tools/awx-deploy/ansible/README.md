# Capstan Deploy Roles

This tree deploys this repository's Capstan build. It does not merge or pull Capstan
application code from upstream.

Supported paths:

- `server`: containerized services on VMs, managed by systemd.
- `k3s`: install k3s, then deploy Capstan into the cluster.
- `k8s`: deploy Capstan into an existing Kubernetes cluster.
- `eda-server`: deploy EDA on a dedicated VM for server deployments.
- `eda-k8s`: deploy EDA beside Capstan in k3s or Kubernetes.
- `galaxy-ng-server`: deploy Galaxy NG/private automation hub on a dedicated VM.
- `galaxy-ng-k8s`: deploy Galaxy NG/private automation hub beside Capstan in k3s or Kubernetes.
- `quay-server`: deploy Project Quay/EE image registry on a dedicated VM.
- `quay-k8s`: deploy Project Quay/EE image registry beside Capstan in k3s or Kubernetes.
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
`awx_web`, `awx_task`, and `awx_receptor`. The Receptor role runs from the Capstan
image so local execution has `ansible-runner` and the same mounted project,
media, and container storage paths as Capstan.

Secrets must be passed through environment variables, vault, or extra vars.
Do not commit `group_vars/all.yml` with real passwords.

## Configuration As Code

Capstan Deploy can reconcile controller configuration after any server, k3s,
or Kubernetes deployment. The same ordered manifest supports native controller
objects and Capstan extensions, including organizations, users, teams, user
types, role definitions, credential types, credentials, execution environments,
projects, inventories, sources, hosts, groups, job/workflow/Terraform/EE build
templates, schedules, notifications, catalog items, cloud connections, and
future API resources.

Start from `../configuration/example.yml`. Keep non-secret desired state in Git
and use environment variables or Ansible Vault for secret fields:

```bash
cd tools/awx-deploy/ansible
export CAPSTAN_CONTROLLER_URL=https://capstan.example.com
export CAPSTAN_CONTROLLER_USERNAME=admin
read -rsp "Capstan password: " CAPSTAN_CONTROLLER_PASSWORD
export CAPSTAN_CONTROLLER_PASSWORD

export VCENTER_HOST=vcenter.example.com
export VCENTER_USERNAME='svc-capstan@example.local'
read -rsp "vCenter password: " VCENTER_PASSWORD
export VCENTER_PASSWORD
export AUTOMATION_PROJECT_URL=https://github.com/example/automation.git
export WEB01_ADDRESS=192.0.2.10

ansible-playbook -i localhost, playbooks/configure.yml \
  -e '{"capstan_configuration_manifests":["../configuration/example.yml"]}'
```

Export an existing controller before moving its configuration into Git:

```bash
ansible-playbook -i localhost, playbooks/export-configuration.yml \
  -e capstan_configuration_export_force=true
```

The exporter writes `configuration/export.yml` plus a blank
`configuration/export.env.example`. Credential secret fields, notification
configuration, user passwords, and explicitly selected secret settings become
environment references; plaintext secret values are never written. Managed
credential types, control-plane execution resources, system schedules, and the
admin account are excluded by default. Use `capstan_configuration_export_include_users`
or `capstan_configuration_export_include_managed` only for intentional migrations.
Limit a migration with `capstan_configuration_export_resources`, and select
controller settings explicitly with `capstan_configuration_export_settings`.

Use `capstan_configuration_check=true` for a non-mutating drift preview. The
reconciler reports create/update/delete/association counts as JSON and returns a
changed Ansible result only when drift exists.

Resources are applied in file and list order. Use `{"$ref": "resource.key"}`
where the API expects the numeric ID of an earlier resource. Use an exact
association to make relationships such as template credentials authoritative:

```yaml
associations:
  - name: credentials
    exact: true
    items:
      - $ref: credential.machine
```

Child objects use a portable related endpoint, resolved after their parent is
created. This is how exported hosts, groups, inventory sources, and workflow
nodes use the API collections that actually support creation:

```yaml
endpoint:
  $related:
    ref: inventory.production
    name: hosts
```

Arbitrary child operations such as surveys and project updates are represented
by `actions`. `state: absent` removes a uniquely matched object. Existing
encrypted values are preserved by default because the API cannot return a
comparable plaintext value; set `secret_update: always` only for an intentional
rotation. Schema-aware editors can use
`../configuration/schema-v1.json`.

EDA is intentionally a separate workload. For k3s/k8s, EDA runs as separate
pods in the same cluster through the upstream EDA Server Operator. For direct
server deployments, EDA runs on hosts in the `awx_eda` inventory group as its
own Docker Compose/systemd stack. See
`docs/eda_deployment_topology.md` for the non-native Capstan topology contract.

Policy services are intentionally split. OPA is a standalone policy engine and
can run on hosts in the `awx_opa` inventory group or any external OPA endpoint.
Gatekeeper is Kubernetes-only and is deployed only in k3s/k8s paths unless a
server Capstan install is explicitly configured to manage a remote Kubernetes API.
See `docs/policy_deployment_topology.md`.

Galaxy NG is intentionally a separate content hub workload. For k3s/k8s, it
runs as API/content/worker/UI/nginx/PostgreSQL/Redis pods beside Capstan. For direct
server deployments, it runs on hosts in the `awx_galaxy_ng` inventory group as
its own Docker Compose/systemd stack with a real Galaxy NG UI at `/ui/`. Capstan
stores only connection settings and uses Galaxy NG as private automation hub
inventory/content source. Set `awx_galaxy_ng_ui_enabled=false` only for API-only
lab stacks.

Project Quay is intentionally a separate execution environment image registry.
Galaxy NG handles collection content; Project Quay handles container images
built from Capstan Projects and referenced by Capstan execution environments. For
k3s/k8s, Quay runs as Quay/PostgreSQL/Redis pods beside Capstan. For direct server
deployments, it runs on hosts in the `awx_quay` inventory group as its own
Docker Compose/systemd stack. The default local-storage configuration is for
local, lab, and proof-of-concept installs; production deployments should replace
it with durable object or shared storage supported by Project Quay.

VMware/vCenter provisioning is intentionally separate from the Capstan deployment
roles. The `server`, `k3s`, and `k8s` paths do not depend on VMware variables
or collections. Use the VMware-only requirements and vars example only when
running `playbooks/vcenter-lab.yml`.

For management-cluster labs with host-local VMFS datastores and limited free
space, set `awx_vcenter_provisioner=govc` and `awx_vcenter_linked_clone=true`.
The vCenter lab role still rejects forbidden or inaccessible datastores and
verifies cloned disk backing, but linked clones avoid requiring a full template
disk allocation for every proof VM. Keep `awx_vcenter_linked_clone=false` for
full clone capacity tests. The govc path also retries transient vCenter SDK
gateway failures through `awx_vcenter_govc_retries` and
`awx_vcenter_govc_delay`; persistent `502 Bad Gateway` responses still require
vCenter service recovery before lifecycle drills can continue.

## Quick Start: Server

```bash
cd tools/awx-deploy/ansible
cp group_vars/all.yml.example group_vars/all.yml
export Capstan_ADMIN_PASSWORD='change-me'
export Capstan_POSTGRES_PASSWORD='change-me'
ansible-playbook -i inventories/example.ini playbooks/deploy-server.yml
```

## Quick Start: Existing Kubernetes

```bash
cd tools/awx-deploy/ansible
export KUBECONFIG=/path/to/kubeconfig
export Capstan_ADMIN_PASSWORD='change-me'
export Capstan_POSTGRES_PASSWORD='change-me'
ansible-playbook -i localhost, playbooks/deploy-k8s.yml
```

To expose Capstan through a node port instead of an ingress, set:

```bash
ansible-playbook -i localhost, playbooks/deploy-k8s.yml \
  -e awx_k8s_service_type=NodePort \
  -e awx_k8s_node_port=30813
```

## Quick Start: k3s

```bash
cd tools/awx-deploy/ansible
export Capstan_ADMIN_PASSWORD='change-me'
export Capstan_POSTGRES_PASSWORD='change-me'
ansible-playbook -i inventories/example.ini playbooks/deploy-k3s.yml
```

To install k3s without deploying Capstan, use:

```bash
ansible-playbook -i inventories/example.ini playbooks/install-k3s.yml
```

To deploy EDA alongside Capstan on k3s, enable EDA:

```bash
export EDA_ADMIN_PASSWORD='change-me'
ansible-playbook -i inventories/example.ini playbooks/deploy-k3s.yml \
  -e awx_eda_enabled=true \
  -e awx_eda_configure_awx_settings=true
```

When EDA, Galaxy NG, or Project Quay is enabled on k3s, the playbook checks
node capacity before deploying those heavier services. The default minimum is
16 GB RAM and 4 vCPU. Override `awx_k3s_min_memory_mb_for_integrated_services`
or `awx_k3s_min_vcpus_for_integrated_services` for larger/smaller lab profiles;
set `awx_k3s_integrated_capacity_check_enabled=false` only when you explicitly
want to test a constrained node.

## Quick Start: EDA on Server VM

For direct server Capstan deployments, put EDA on a dedicated VM in the `awx_eda`
inventory group:

```bash
cd tools/awx-deploy/ansible
export EDA_ADMIN_PASSWORD='change-me'
ansible-playbook -i inventories/example.ini playbooks/deploy-eda-server.yml
```

Then configure Capstan to point at that VM and rerun the Capstan server deployment or
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

## Quick Start: Galaxy NG on Server VM

For direct server Capstan deployments, put Galaxy NG on a dedicated VM in the
`awx_galaxy_ng` inventory group:

```bash
cd tools/awx-deploy/ansible
export GALAXY_NG_ADMIN_PASSWORD='change-me'
export GALAXY_NG_POSTGRES_PASSWORD='change-me'
export GALAXY_NG_SECRET_KEY="$(openssl rand -base64 48)"
ansible-playbook -i inventories/example.ini playbooks/deploy-galaxy-ng-server.yml
```

Then configure Capstan to point at that VM and rerun the Capstan server deployment or
upgrade:

```bash
ansible-playbook -i inventories/example.ini playbooks/deploy-server.yml \
  -e awx_galaxy_ng_enabled=true \
  -e awx_galaxy_ng_configure_awx_settings=true
```

Module visibility is controlled from Capstan under **Settings → Modules**. Deploy
roles configure service endpoints and credentials, but they do not lock the
module enable switches in generated `settings.py`.

## Quick Start: Galaxy NG on k3s/Kubernetes

```bash
cd tools/awx-deploy/ansible
export KUBECONFIG=/path/to/kubeconfig
export GALAXY_NG_ADMIN_PASSWORD='change-me'
ansible-playbook -i localhost, playbooks/deploy-galaxy-ng-k8s.yml
ansible-playbook -i localhost, playbooks/deploy-k8s.yml \
  -e awx_galaxy_ng_enabled=true \
  -e awx_galaxy_ng_configure_awx_settings=true
```

For k3s, use `playbooks/deploy-k3s.yml` with the same variables. If password
vars are omitted on Kubernetes, the role reuses existing secrets or generates
new secrets once.

Galaxy NG mounts shared Pulp content into API, content, and worker pods. The
default `awx_galaxy_ng_pulp_access_mode: ReadWriteOnce` works for single-node
k3s/local clusters. Use `ReadWriteMany` with a compatible storage class for
multi-node Kubernetes or when scaling Galaxy NG replicas.

## Quick Start: Project Quay on Server VM

For direct server Capstan deployments, put Project Quay on a dedicated VM in the
`awx_quay` inventory group:

```bash
cd tools/awx-deploy/ansible
export QUAY_ADMIN_PASSWORD='change-me'
export QUAY_POSTGRES_PASSWORD='change-me'
export QUAY_DATABASE_SECRET_KEY="$(openssl rand -base64 32)"
export QUAY_SECRET_KEY="$(openssl rand -base64 48)"
ansible-playbook -i inventories/example.ini playbooks/deploy-quay-server.yml
```

Then configure Capstan to point at that VM and rerun the Capstan server deployment or
upgrade. `QUAY_API_TOKEN` must be a Project Quay OAuth access token with
`repo:read`, `repo:create`, `repo:write`, and `repo:admin` scopes for Capstan
repository management. `QUAY_PUSH_USERNAME` and `QUAY_PUSH_TOKEN` are used only
to generate image push commands without printing stored tokens:

```bash
export QUAY_API_TOKEN='token-from-quay'
export QUAY_PUSH_USERNAME='awx+robot'
export QUAY_PUSH_TOKEN='robot-token'
ansible-playbook -i inventories/example.ini playbooks/deploy-server.yml \
  -e awx_quay_enabled=true \
  -e awx_quay_configure_awx_settings=true
```

## Quick Start: Project Quay on k3s/Kubernetes

```bash
cd tools/awx-deploy/ansible
export KUBECONFIG=/path/to/kubeconfig
export QUAY_ADMIN_PASSWORD='change-me'
ansible-playbook -i localhost, playbooks/deploy-quay-k8s.yml
ansible-playbook -i localhost, playbooks/deploy-k8s.yml \
  -e awx_quay_enabled=true \
  -e awx_quay_configure_awx_settings=true
```

For k3s, use `playbooks/deploy-k3s.yml` with the same variables. If secret vars
are omitted on Kubernetes, the role reuses existing secrets or generates new
database/signing secrets once. The role can initialize the first Quay admin user
when `awx_quay_initialize_admin=true` and `QUAY_ADMIN_PASSWORD` is set.

For Docker Desktop or other single-node local Kubernetes testing, expose Quay
through NodePort so the local Capstan dev container can reach it without a
long-running port-forward:

```bash
QUAY_ADMIN_PASSWORD=password ansible-playbook -i localhost, -c local \
  playbooks/deploy-quay-k8s.yml \
  -e awx_quay_service_type=NodePort \
  -e awx_quay_postgres_storage_size=2Gi \
  -e awx_quay_registry_storage_size=5Gi

curl http://127.0.0.1:30881/health/instance
docker exec tools_awx_1 curl http://host.docker.internal:30881/health/instance
```

The k3s/k8s role URL-encodes database credentials in Quay's `DB_URI`, creates
the PostgreSQL `pg_trgm` extension required by Quay, and rolls the Quay pod when
the generated configuration changes. The default Quay namespace is `admin`
because the role initializes that first user; override `awx_quay_namespace` when
you create a dedicated Quay organization such as `awx`.

## Project Quay Backup / Restore / Upgrade / Failback

Project Quay lifecycle is separate from Capstan lifecycle because it owns registry
metadata and registry storage. Server backups capture `quay.sql`, rendered
Quay config/compose files, registry storage, and a manifest. Kubernetes backups
capture `quay.sql`, Quay secrets, resource inventory, registry PVC contents,
and a manifest.

For direct server Quay:

```bash
ansible-playbook -i inventories/example.ini playbooks/backup-quay-server.yml

ansible-playbook -i inventories/example.ini playbooks/restore-quay-server.yml \
  -e awx_quay_restore_confirm=true \
  -e awx_quay_restore_path=/var/backups/awx/quay-20260625T010101Z

ansible-playbook -i inventories/example.ini playbooks/upgrade-quay-server.yml \
  -e awx_quay_image_tag=v3.13.4

ansible-playbook -i inventories/example.ini playbooks/failback-quay-server.yml \
  -e awx_quay_failback_restore_path=/var/backups/awx/quay-20260625T010101Z \
  -e awx_quay_failback_image_tag=v3.13.3
```

For k3s/Kubernetes Quay:

```bash
ansible-playbook -i inventories/example.ini playbooks/backup-quay-k8s.yml

ansible-playbook -i inventories/example.ini playbooks/restore-quay-k8s.yml \
  -e awx_quay_k8s_restore_confirm=true \
  -e awx_quay_k8s_restore_path=/var/backups/awx/quay-k8s-20260625T010101Z

ansible-playbook -i inventories/example.ini playbooks/upgrade-quay-k8s.yml \
  -e awx_quay_image_tag=v3.13.4

ansible-playbook -i inventories/example.ini playbooks/failback-quay-k8s.yml \
  -e awx_quay_failback_restore_path=/var/backups/awx/quay-k8s-20260625T010101Z \
  -e awx_quay_failback_image_tag=v3.13.3
```

For image-only failback, omit `awx_quay_failback_restore_path`. For full state
failback, provide a restore path; if an image tag is also provided the playbook
restores state first, then reapplies the requested image tag.

For local Docker Desktop smoke tests without sudo, override the backup owner
and write to a temporary directory:

```bash
ansible-playbook -i localhost, -c local playbooks/backup-quay-k8s.yml \
  -e ansible_become=false \
  -e awx_quay_k8s_backup_dir=/tmp/awx-quay-backup-smoke \
  -e awx_quay_k8s_backup_owner="$(id -un)" \
  -e awx_quay_k8s_backup_group="$(id -gn)" \
  -e awx_quay_k8s_backup_collect_storage=false
```

## Quick Start: OPA on Server VM

For direct server Capstan deployments, put OPA on a dedicated VM in the `awx_opa`
inventory group:

```bash
cd tools/awx-deploy/ansible
ansible-playbook -i inventories/example.ini playbooks/deploy-opa-server.yml
```

Then configure Capstan to point at that VM and rerun the Capstan server deployment or
upgrade:

```bash
ansible-playbook -i inventories/example.ini playbooks/deploy-server.yml \
  -e awx_opa_enabled=true \
  -e awx_opa_configure_awx_settings=true
```

## Quick Start: Gatekeeper on k3s/Kubernetes

Gatekeeper is a Kubernetes admission controller. Enable it only for k3s/k8s
deployments or when Capstan is managing a remote cluster through an explicit API
URL/token.

```bash
cd tools/awx-deploy/ansible
export KUBECONFIG=/path/to/kubeconfig
ansible-playbook -i localhost, playbooks/deploy-gatekeeper-k8s.yml
ansible-playbook -i localhost, playbooks/deploy-k8s.yml \
  -e awx_gatekeeper_enabled=true \
  -e awx_gatekeeper_configure_awx_settings=true
```

For k3s, use `playbooks/deploy-k3s.yml` with the same variables. The Capstan
service account receives Gatekeeper read/write RBAC only when
`awx_gatekeeper_configure_awx_settings=true`.

When multiple Gatekeeper contexts are configured through the Capstan settings API,
`GATEKEEPER_K8S_CONTEXTS` is encrypted JSON text keyed by context name. The
deploy roles may still render a native Python dictionary in file-based settings,
and Capstan keeps reading legacy `OrderedDict` text from earlier builds during
upgrades.

## Backup / Restore

```bash
ansible-playbook -i inventories/example.ini playbooks/backup.yml
ansible-playbook -i inventories/example.ini playbooks/restore.yml \
  -e awx_restore_confirm=true \
  -e awx_restore_path=/var/backups/awx/awx-20260625T010101Z
```

For k3s or Kubernetes deployments, use the Kubernetes-native lifecycle
playbooks. They dump PostgreSQL through the `awx-postgres` pod, export Capstan
secrets/config maps/resource inventory, and archive projects/media from the
projects PVC through a temporary helper pod.

```bash
ansible-playbook -i inventories/example.ini playbooks/backup-k8s.yml \
  -e awx_backup_name=awx-k8s-20260625T010101Z

ansible-playbook -i inventories/example.ini playbooks/restore-k8s.yml \
  -e awx_k8s_restore_confirm=true \
  -e awx_k8s_restore_path=/var/backups/awx/awx-k8s-20260625T010101Z

ansible-playbook -i inventories/example.ini playbooks/failback-k8s.yml \
  -e awx_failback_restore_path=/var/backups/awx/awx-k8s-20260625T010101Z \
  -e awx_failback_image_tag=25.1.4
```

Use the server lifecycle playbooks for direct or multi-node server deployments,
and the Kubernetes lifecycle playbooks for k3s/existing-k8s. For vCenter
snapshot rollback drills, snapshot the current state first, revert to the
chosen snapshot, smoke-test the old state, then run the matching deploy or
upgrade playbook to fail forward and smoke-test again.

## Lifecycle Evidence Verification

After a deploy, backup, restore, upgrade, or failback drill, collect the smoke
reports and backup paths into one repeatable evidence check. This does not run
destructive operations; it verifies that the expected Capstan/Quay database dumps,
Kubernetes exports, manifests, optional storage archives, and smoke JSON reports
exist and passed.

To run the standard Capstan/Galaxy NG/Project Quay and EDA smoke checks, write a
manifest, and verify everything in one step:

```bash
export Capstan_PASSWORD='change-me'
python3 ../scripts/run_lifecycle_evidence.py \
  --url http://awx.example.com \
  --username admin \
  --artifact awx-k8s:/var/backups/awx/awx-k8s-20260625T010101Z \
  --artifact quay-k8s:/var/backups/awx/quay-k8s-20260625T010101Z \
  --require-storage
```

The runner writes `content-smoke.json`, `eda-smoke.json`,
`evidence-manifest.json`, and `evidence-result.json` under an ignored
`output/awx-lifecycle-<timestamp>/` directory. Use `--skip-eda-smoke`,
`--skip-content-smoke`, `--allow-galaxy-unconfigured`,
`--allow-quay-unconfigured`, and `--allow-eda-unconfigured` for partial lab
proof while integrations are intentionally disabled.

To verify a manifest produced elsewhere:

```bash
python3 ../scripts/verify_lifecycle_evidence.py \
  --evidence-file /tmp/awx-k8s-upgrade-evidence.json \
  --require-storage \
  --json-output /tmp/awx-lifecycle-evidence.json
```

Example evidence manifest:

```json
{
  "name": "k8s-upgrade-drill",
  "require_storage": true,
  "artifacts": [
    {
      "profile": "awx-k8s",
      "path": "/var/backups/awx/awx-k8s-20260625T010101Z"
    },
    {
      "profile": "quay-k8s",
      "path": "/var/backups/awx/quay-k8s-20260625T010101Z"
    }
  ],
  "smoke_reports": [
    "/tmp/awx-content-smoke.json",
    "/tmp/awx-eda-smoke.json"
  ]
}
```

To prove multiple paths in one run, use a top-level `scenarios` array with the
same fields for each scenario. Relative artifact and smoke paths are resolved
from the manifest file directory.

Supported artifact profiles are `awx-server`, `awx-k8s`, `quay-server`, and
`quay-k8s`. Use `--require-storage` for storage-inclusive Quay and
projects/media proof. The old one-off flags also remain available:
`--artifact PROFILE:PATH` and `--smoke-report PATH`.

## EDA Live Smoke

After deploying Capstan with Event-Driven Ansible enabled, run the repeatable smoke
wrapper from the repository root. It checks Capstan root/static assets, authenticated
API access, EDA Controller status, live EDA Controller-backed resource list
endpoints, Capstan-to-EDA RBAC sync preview, anonymous access denial, and optional
RBAC/project/activation flows.

```bash
export Capstan_PASSWORD='change-me'
python3 tools/awx-deploy/scripts/smoke_eda.py \
  --url http://awx.example.com \
  --username admin
```

In local development, point `--url` at the frontend dev server, for example
`http://localhost:4012`, so the root/static asset check exercises the UI bundle
as well as proxied API calls.

To prove multiple deployment paths in one run:

```bash
export Capstan_PASSWORD='change-me'
export Capstan_URLS='http://direct.example.com http://k3s.example.com http://lb.example.com'
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

Set credentials only in environment variables. The lab role defaults to
`awx_vcenter_provisioner: auto`: it uses `community.vmware` when the local
Python VMware SDK import path works and falls back to `govc` when available.
Set `awx_vcenter_provisioner` to `community.vmware` or `govc` to force a
specific backend.

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
(default: `["datastore1", "datastore1 (1)", "datastore1 (2)"]`). It also verifies the actual
cloned disk backing after vCenter completes the clone, because a clone request
can otherwise report success while the disk lands on the wrong backing
datastore. Template disk backing is verified before clone as well; if vCenter
still creates a VM on a forbidden or unapproved datastore, the role deletes the
bad clone by default before failing the run.

When using host-local VMFS datastores, set `awx_vcenter_host` to the ESXi host
that owns the selected datastore. This pins the clone target and avoids DRS
placing the VM on another host before the post-clone storage guard verifies the
actual backing.

By default the role writes a generated inventory to
`/tmp/awx-vcenter-lab.ini`. Use that file as the input to `deploy-server.yml`
after the cloned VM template has working SSH access:

```bash
ansible-playbook -i /tmp/awx-vcenter-lab.ini playbooks/deploy-server.yml
```
