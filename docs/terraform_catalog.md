# Terraform Catalog — Architecture & Walkthrough

This document covers the Terraform + Catalog platform built into AWX: how
Terraform templates are executed, how cloud provider credentials are injected,
how inventory hosts are populated from Terraform outputs, and how the self-
service Catalog ties everything together.

---

## Table of contents

1. [Architecture overview](#1-architecture-overview)
2. [Credential setup](#2-credential-setup)
3. [Terraform template configuration](#3-terraform-template-configuration)
4. [Inventory output mapping](#4-inventory-output-mapping)
5. [Workflow nodes](#5-workflow-nodes)
6. [Catalog items](#6-catalog-items)
7. [Proxmox end-to-end walkthrough](#7-proxmox-end-to-end-walkthrough)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Architecture overview

```
   User (catalog_user)
        │
        ▼
   CatalogItem
        │  provision_workflow
        ▼
   WorkflowJobTemplate
   ┌─────────────────┐
   │ Node 1          │  TerraformJobTemplate (apply)
   │  ├─ terraform init
   │  ├─ terraform plan
   │  └─ terraform apply ──► reads outputs ──► adds Hosts to Inventory
   │         │ on_success
   │ Node 2  ▼            │
   │  JobTemplate         │  Ansible playbook (configure_proxmox_vm.yml)
   │   runs against       │  hosts = proxmox_vms group
   └─────────────────┘
```

### Key models

| Model | Purpose |
|-------|---------|
| `TerraformJobTemplate` | Stores Terraform configuration: SCM project, working directory, operation (apply/plan/destroy), target inventory, target group |
| `TerraformJob` | Immutable run record created each time a template is launched |
| `CredentialType` | Defines provider-specific input schema and env-var injectors |
| `Credential` | Stores credential values; injected into `TerraformJob` subprocess env |
| `CatalogItem` | Self-service entry point: links provision + deprovision workflows, stores JSON Schema for user-visible parameters |
| `CatalogDeployment` | Created when a user deploys an item; tracks status and links back to the workflow jobs |

---

## 2. Credential setup

AWX ships with built-in credential types for each Terraform cloud provider.  
Create credentials at **Credentials → Add** or `POST /api/v2/credentials/`.

### Proxmox VE

| Field | Description |
|-------|-------------|
| Proxmox API URL | Full endpoint URL, e.g. `https://proxmox.example.com:8006/api2/json` |
| API Token ID | Token in `user@realm!tokenname` format, e.g. `root@pam!awx` |
| API Token Secret | UUID secret returned when the token was created |
| Node Name | Proxmox node name, e.g. `pve` |
| Skip TLS Verification | Check only for self-signed certs in lab environments |

AWX injects these as the environment variables `PM_API_URL`, `PM_API_TOKEN_ID`,
`PM_API_TOKEN_SECRET`, `PM_NODE`, and `PM_TLS_INSECURE` before running any
`terraform` command so they never appear in process listings or log output.

### Other supported providers

| Provider | Credential type name | Key env vars |
|----------|---------------------|--------------|
| VMware vSphere | VMware vSphere | `VSPHERE_SERVER`, `VSPHERE_USER`, `VSPHERE_PASSWORD` |
| AWS | Amazon Web Services (Terraform) | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION` |
| Azure | Microsoft Azure (Terraform) | `ARM_SUBSCRIPTION_ID`, `ARM_CLIENT_ID`, `ARM_CLIENT_SECRET`, `ARM_TENANT_ID` |
| GCP | Google Cloud Platform (Terraform) | `GOOGLE_PROJECT`, `GOOGLE_CREDENTIALS` |
| OCI | Oracle Cloud Infrastructure | Written to `~/.oci/config` |

---

## 3. Terraform template configuration

Terraform templates live under **Resources → Terraform Templates** in the
sidebar. Each template points to a **Project** (git or manual SCM) and a
**directory** inside that project where the Terraform root module lives.

### Required fields

| Field | Description |
|-------|-------------|
| Name | Human-readable name |
| Project | SCM project containing `.tf` files |
| Terraform Directory | Path within the project to the root module (default: `.`) |
| Operation | `apply`, `plan`, or `destroy` |

### Optional fields

| Field | Description |
|-------|-------------|
| Target Inventory | AWX Inventory to populate after a successful `apply` |
| Target Group | Group within the inventory to add provisioned hosts to |
| Extra Variables | JSON / YAML key-value pairs written as `terraform.tfvars.json` |
| Verbosity | 0–4 (controls `-v` flags passed to Terraform) |
| Execution Environment | Container image with `terraform` binary (see §3.1) |

### 3.1 Execution environments

If an Execution Environment is attached, AWX wraps every `terraform` invocation
with `podman run`.  The EE image must have `terraform` ≥ 1.5 installed.
Credential env vars are written to an env-file inside the job private data
directory so they are never visible in `ps` output.

If no EE is configured, `terraform` must be installed on the AWX execution node
(or in the AWX container in dev mode).

---

## 4. Inventory output mapping convention

After a successful `terraform apply`, AWX runs `terraform output -json` and
inspects the output object.  Any output key that **starts with `host_ip_`**
is treated as a new host:

```
host_ip_<hostname_suffix> = "<ip_address>"
```

- The **hostname** in the AWX inventory is set to `<hostname_suffix>`.
- `ansible_host` is set to `<ip_address>` so Ansible connects to the right IP.
- The host is added to the **Target Group** (created automatically if absent).

**Example** — for the Proxmox VM example module:

```hcl
output "host_ip_proxmox_vm" {
  value = var.ip_address
}
```

This produces a host named `proxmox_vm` in the target inventory with
`ansible_host = <ip_address>`.

To provision multiple hosts from a single `apply`, add one output per host:

```hcl
output "host_ip_web01" { value = "192.168.1.101" }
output "host_ip_web02" { value = "192.168.1.102" }
```

---

## 5. Workflow nodes

Terraform templates can be used as nodes in Workflow Job Templates alongside
regular Ansible Job Templates.  In the workflow visualiser, Terraform nodes
are displayed with a distinct Terraform icon.

### Passing inventory context between nodes

The Terraform node populates hosts into the target inventory.  The downstream
Ansible node should:

1. Set **Inventory** to the same inventory.
2. Set **Limit** to the target group (e.g. `proxmox_vms`).

AWX evaluates the limit at job launch time, so hosts added by the upstream
Terraform node are visible to the Ansible node even though they did not exist
when the workflow was launched.

---

## 6. Catalog items

The Catalog is a self-service portal that exposes Workflow Job Templates to
users who don't need (or shouldn't have) access to the full AWX interface.

### CatalogItem fields

| Field | Description |
|-------|-------------|
| Name | Display name shown in the catalog browser |
| Description | Rich text description of what gets provisioned |
| Icon URL | Optional URL to an image shown on the catalog card |
| Organization | Scopes visibility to an AWX Organization |
| Provision Workflow | Workflow to run when a user clicks "Deploy" |
| Deprovision Workflow | Workflow to run when a user decommissions the deployment |
| Extra Vars Schema | JSON Schema defining the parameters shown in the deploy form |

### Extra Vars Schema

The JSON Schema is rendered in the **Deploy** wizard as a form.  Required
fields are presented first; optional fields with defaults are shown collapsed.

Example schema:

```json
{
  "type": "object",
  "properties": {
    "vm_name":   { "type": "string", "title": "VM Name" },
    "ip_address":{ "type": "string", "title": "IP Address" },
    "cores":     { "type": "integer", "title": "CPU Cores", "default": 2 }
  },
  "required": ["vm_name", "ip_address"]
}
```

The values entered by the user are stored on `CatalogDeployment.extra_vars`
and passed to the provision workflow as extra variables.

### Deployment status lifecycle

```
pending → provisioning → active
                      ↘ failed
active  → deprovisioning → destroyed
```

Status transitions are driven by WorkflowJob completion signals:

- `provision_job` complete + success → `active`
- `provision_job` complete + failure → `failed`
- `deprovision_job` complete + success → `destroyed`

---

## 7. Proxmox end-to-end walkthrough

This walkthrough uses the bundled example at `awx/terraform_examples/proxmox-vm/`.

### Prerequisites

- A running Proxmox VE cluster reachable from the AWX execution environment
- A cloud-init-enabled VM template on Proxmox (Ubuntu 22.04 recommended)
- An API token on Proxmox with VM creation permissions
- An SSH key pair whose public key you will pass as `ssh_public_key`

### Step 1 — Seed the dev fixtures

```bash
# From inside the AWX container
awx-manage seed_proxmox_example
```

This creates:
- **Inventory**: Proxmox VMs (with group `proxmox_vms`)
- **Terraform template**: Provision Proxmox VM (apply)
- **Terraform template**: Deprovision Proxmox VM (destroy)
- **Job template**: Configure Proxmox VM (Apache/Nginx install)
- **Workflow**: Proxmox VM Provision Workflow (Terraform → Ansible)
- **Workflow**: Proxmox VM Deprovision Workflow (Terraform destroy)
- **Catalog item**: Apache on Proxmox VM

### Step 2 — Create the Proxmox credential

1. Navigate to **Credentials → Add**
2. Select type **Proxmox VE**
3. Fill in your Proxmox API URL, token ID, and token secret
4. Save

### Step 3 — Attach the credential to the Terraform templates

1. Open **Provision Proxmox VM** → **Credentials** tab → add the Proxmox VE credential
2. Repeat for **Deprovision Proxmox VM**

### Step 4 — Deploy from the Catalog

1. Navigate to **Catalog** (top-level sidebar entry)
2. Find **Apache on Proxmox VM** and click **Deploy**
3. Fill in the form:
   - **VM Name** — e.g. `test-vm-01`
   - **IP Address** — a free static IP on your network
   - **Default Gateway** — your network's gateway
   - **Proxmox Template Name** — name of your cloud-init template
4. Click **Launch**

AWX will:
1. Create a `CatalogDeployment` record with status `provisioning`
2. Launch the Provision workflow
3. Terraform apply provisions the VM on Proxmox
4. AWX reads the `host_ip_proxmox_vm` output and adds a host to **Proxmox VMs**
5. The Ansible job installs Apache on the new host
6. On workflow success, `CatalogDeployment.status` → `active`

### Step 5 — Verify

```bash
curl http://<ip_address>/
# Returns the AWX Catalog provisioned index page
```

### Step 6 — Deprovision

1. Go to **Catalog → My Deployments**
2. Click **Deprovision** on the deployment row
3. AWX launches the deprovision workflow, which runs `terraform destroy`
4. `CatalogDeployment.status` → `destroyed`

---

## 8. Troubleshooting

### Terraform cannot find the provider

The `telmate/proxmox` provider is downloaded during `terraform init`.  If the
execution environment doesn't have internet access, pre-install the provider in
the EE image or set up a local Terraform registry mirror.

### VM is provisioned but Ansible fails to connect

- Verify the IP address is routable from the AWX execution node
- Check that the cloud-init template has cloud-init installed and that your
  SSH public key was passed in `ssh_public_key`
- The `configure_proxmox_vm.yml` playbook uses `wait_for_connection` with a
  5 min timeout; increase `timeout` if boot takes longer

### CatalogDeployment stuck in `provisioning`

If the workflow job fails, the deployment will show `failed`.  Check
**Activities → Workflow Jobs** for the failed job and inspect the individual
node logs.

### Idempotency of `seed_proxmox_example`

The management command uses `get_or_create` throughout so it is safe to re-run.
WorkflowJobTemplateNodes are only created on first run (when the workflow itself
is created).  To reset, delete the objects from the AWX UI and re-run the
command.
