# AWX UI Enhancements

Planned and in-progress UI/UX improvements for this AWX fork.

Legend: ⬜ Not started · 🔄 In progress · ✅ Done

---

## Already Completed

| # | Enhancement | Notes |
|---|-------------|-------|
| ✅ | Live system usage bar in navbar | Polls `/api/v2/instances/` every 30s; shows jobs count + progress bar + % with colour coding |
| ✅ | Usage bar moved to right side of navbar | Positioned after notifications, before help menu |
| ✅ | Overview page full-width on large screens | Removed `isWidthLimited` from `PageSection` in `PageDashboard.tsx` |
| ✅ | Dashboard card side padding removed | `PageSection` set to `padding: '16px 0'` so cards touch the content edges |
| ✅ | Counts card full-width | Changed `width="xxl"` → `width="full"` in `PageDashboardCountBar` |
| ✅ | Job Activity card full-width | Changed `width="xxl"` → `width="full"` in `AwxJobActivityCard` |
| ✅ | Jobs + Projects cards half-width each | `width="half"` — side-by-side on large screens |
| ✅ | Inventories card full-width | `width="full"` |
| ✅ | Resume workflow job support | `useResumeWorkflowJob` hook added |
| ✅ | Custom logo + login page branding | Logo upload via Settings, shown on login and masthead |
| ✅ | Custom settings navigation | Reorganised settings sidebar |
| ✅ | About page version + enhanced-by credit | Version `25.0.0` shown in About modal; "Enhanced by [Ziad Saleemi](https://ziadsaleemi.com)" link added |
| ✅ | Terraform always runs in container | `hashicorp/terraform:latest` used as default EE; auto-detects `docker`/`podman`; AWX node no longer needs Terraform installed |

---

## Planned Enhancements

### Dashboard & Navigation

| # | Enhancement | Priority | Status |
|---|-------------|----------|--------|
| 1 | **Collapsible sidebar** — icon-only mode to save horizontal space on smaller screens | Medium | ✅ |
| 2 | **Dashboard card drag-to-reorder** — persist custom card order per user | Low | ✅ |
| 3 | **Dark/light mode persistence** — store theme in user profile (server-side) so it survives browser changes | Medium | ✅ |
| 4 | **Job Activity card drill-down** — clicking a date point navigates to the jobs list filtered to that day | Medium | ✅ |
| 5 | **Global search (Cmd+K)** — command palette to search jobs, templates, inventories by name | High | ✅ |

### System Usage Bar (navbar)

| # | Enhancement | Priority | Status |
|---|-------------|----------|--------|
| 6 | **Click to navigate** — clicking the usage bar opens `/infrastructure/instances` | High | ✅ |
| 7 | **Alert threshold** — bar pulses/blinks when capacity ≥ 90% | Medium | ✅ |
| 8 | **Per-node inline breakdown** — when multiple execution nodes exist, show a small bar per node (not just in tooltip) | Low | ✅ |

### Performance

| # | Enhancement | Priority | Status |
|---|-------------|----------|--------|
| 9  | **Virtual scrolling for large lists** — use PatternFly `VirtualizedTable` for job/host lists with thousands of rows | High | ✅ |
| 10 | **WebSocket-driven dashboard refresh** — replace 30s polling with real-time AWX WebSocket event stream | Medium | ✅ |
| 11 | **Prefetch navigation data** — preload sidebar resource counts (hosts, inventories, etc.) on app load | Low | ✅ |

### Operations

| # | Enhancement | Priority | Status |
|---|-------------|----------|--------|
| 12 | **Bulk job cancel** — "Cancel all running jobs" one-click action on the Jobs list | High | ✅ |
| 13 | **Job output full-screen mode** — expanded full-viewport view for the job output console | Medium | ✅ |

### Security & Administration

| # | Enhancement | Priority | Status |
|---|-------------|----------|--------|
| 14 | **Session timeout warning** — notify the user 2 min before session expiry with an option to extend | High | ✅ |
| 15 | **Audit log viewer** — surface Activity Stream in a prominent, filterable UI rather than buried under Administration | Medium | ✅ |

### Developer Experience

| # | Enhancement | Priority | Status |
|---|-------------|----------|--------|
| 16 | **OpenAPI → TypeScript types** — auto-generate TS interfaces from `make genschema` output to replace manually maintained `awx/ui/src/frontend/awx/interfaces/` files | Low | ✅ |
| 17 | **Accessibility: table header names** — add `screenReaderText` / `aria-label` to all visually-empty `<Th>` elements (expand-row, select-row, drag-handle columns) to silence the PatternFly "Th: Table headers must have an accessible name" console warning on every table page | Medium | ✅ |
| 18 | **Login page logo centering** — CSS fix so the AWX logo is properly centered in the right panel of the login page instead of being flush against the form card | Low | ✅ |
| 19 | **Login page background image** — full-page background image configurable from Settings → User Interface (below logo upload); paste URL or upload file ≤ 2 MB; stored in browser localStorage; login form card left-aligned at desktop; logo displayed inside the login card | Medium | ✅ |
| 20 | **Navbar logo size control** — S / M / L size-preset buttons in Settings → User Interface (below the logo upload); selected size stored in localStorage and applied to the masthead brand on every page load | Low | ✅ |
| 21 | **Custom login background image in DB** — upload or paste an https:// URL in Settings → User Interface; stored in `CUSTOM_LOGIN_BACKGROUND` AWX setting (database), served from `/api/` root before auth, no more localStorage | Medium | ✅ |
| 22 | **Remove first-letter icon placeholders from sidebar** — nav items without an explicit icon now show only their label text in expanded mode; first-letter fallback kept only for collapsed (icon-only) mode | Low | ✅ |
| 23 | **Catalog deploy dynamic field interpolation** — deploy form now resolves `dynamic_field_templates` placeholders (for example `{mnemonic}{cores}`) using current form values before submitting `extra_vars` | High | ✅ |

---

## Terraform & Catalog Platform

Full Terraform lifecycle support inside AWX — templates, execution, inventory population, credential injection, and a self-service Catalog for end-to-end provisioning/decommissioning.

**Guiding principles:**
- Terraform templates are first-class citizens alongside Job Templates; they share the same extra-vars system, credentials, RBAC, and workflow node model.
- Catalog items are thin wrappers around Workflow Job Templates; all provisioning/decommissioning logic lives in workflows so every step is auditable.
- The first provider target is **Proxmox**; the same credential-type pattern is then repeated for VMware, AWS, Azure, GCP, and OCI.

---

### Phase A — Terraform Template Engine (Backend)

| # | Task | Priority | Status |
|---|------|----------|--------|
| A1 | **`TerraformJobTemplate` model** — new `UnifiedJobTemplate` subclass in `awx/main/models/terraform.py`; fields: `scm_project` (FK → Project), `terraform_dir` (path within repo, default `.`), `extra_vars` (JSON/YAML same as JobTemplate), `verbosity` (0–4), `target_inventory` (FK → Inventory, nullable), `target_group` (str, nullable), `destroy_on_delete` (bool) | High | ✅ |
| A2 | **`TerraformJob` model** — `UnifiedJob` subclass; mirrors `TerraformJobTemplate` fields at launch time; adds `terraform_operation` choice field: `apply` / `destroy` / `plan` | High | ✅ |
| A3 | **Django migrations** — create initial migration for both new models; `swappable_dependency` on `UnifiedJob`/`UnifiedJobTemplate` already handled by base | High | ✅ |
| A4 | **Task runner** (`awx/main/tasks/terraform.py`) — `RunTerraformJob` task class; steps: checkout project via Receptor, write `terraform.tfvars.json` from extra_vars, inject credential env vars, run `terraform init`, run `terraform plan -out=plan.tfplan`, run `terraform apply plan.tfplan` (or `terraform destroy`); stream stdout/stderr to job event system | High | ✅ |
| A5 | **Inventory population from Terraform output** — after successful `apply`, run `terraform output -json`; for each key matching `host_ip_*` or a configurable output key pattern, create/update `Host` records in `target_inventory`; add to `target_group` if set; store `terraform_resource_id` in host variables for later `destroy` | High | ✅ |
| A6 | **Extra-vars / variable precedence** — reuse AWX's existing `process_extra_vars` pipeline; support survey specs (same `SurveySpec` model); Terraform receives merged vars as `terraform.tfvars.json` | Medium | ✅ |
| A7 | **Credential injection** — new `CredentialType` injector class `TerraformProviderInjector`; maps credential fields → env vars before `terraform` subprocess; each cloud provider credential type registers its own injector | High | ✅ |
| A8 | **DRF serializers + views** — `TerraformJobTemplateSerializer`, `TerraformJobSerializer`, `TerraformJobTemplateList/Detail`, `TerraformJobList/Detail`, `TerraformJobTemplateLaunch`, `TerraformJobCancel`; URL: `/api/v2/terraform_job_templates/`, `/api/v2/terraform_jobs/` | High | ✅ |
| A9 | **RBAC access classes** — `TerraformJobTemplateAccess`, `TerraformJobAccess` in `awx/main/access.py`; mirrors `JobTemplateAccess` permission model (admin/execute/read) | High | ✅ |
| A10 | **Workflow node type** — extend `WorkflowJobTemplateNode.unified_job_template` polymorphic FK to include `TerraformJobTemplate`; update workflow task manager to launch `TerraformJob` when a node resolves to a terraform template; update workflow visualiser API to return node type info | High | ✅ |
| A11 | **Execution Environment support for Terraform** — `TerraformJobTemplate` and `TerraformJob` inherit `execution_environment` FK from `UnifiedJobTemplate`/`UnifiedJob` base via `ExecutionEnvironmentMixin`; `RunTerraformJob._run_cmd()` detects a configured EE via `instance.resolve_execution_environment()` and wraps every `terraform` invocation in `{runtime} run --rm -v {private_data_dir}:/runner:Z --workdir {mapped_cwd} --env-file /runner/env/envvars {image} terraform {args}`; credential env vars are written to an env-file so they never appear in process listings; pull policy from `ExecutionEnvironment.pull` is honoured; **when no EE is explicitly configured the task runner automatically falls back to `hashicorp/terraform:latest`** (container runtime auto-detected: `docker` preferred, `podman` fallback) — the AWX execution node never needs Terraform installed locally | High | ✅ |

---

### Phase B — Cloud Provider Credential Types

Each credential type is a `CredentialType` fixture/data migration with `inputs` schema and `injectors` that map fields to env vars consumed by the relevant Terraform provider.

| # | Provider | Credential Fields | Env Vars Injected | Priority | Status |
|---|----------|-------------------|-------------------|----------|--------|
| B1 | **Proxmox VE** | `pm_api_url`, `pm_api_token_id`, `pm_api_token_secret`, `pm_node`, `pm_tls_insecure` (bool) | `PM_API_URL`, `PM_API_TOKEN_ID`, `PM_API_TOKEN_SECRET`, `PM_NODE`, `PM_TLS_INSECURE` | High | ✅ |
| B2 | **VMware vSphere** | `vsphere_server`, `vsphere_user`, `vsphere_password`, `vsphere_allow_unverified_ssl` (bool) | `VSPHERE_SERVER`, `VSPHERE_USER`, `VSPHERE_PASSWORD`, `VSPHERE_ALLOW_UNVERIFIED_SSL` | Medium | ✅ |
| B3 | **AWS** | `aws_access_key_id`, `aws_secret_access_key`, `aws_session_token` (optional), `aws_default_region` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_DEFAULT_REGION` | Medium | ✅ |
| B4 | **Azure** | `arm_subscription_id`, `arm_client_id`, `arm_client_secret`, `arm_tenant_id` | `ARM_SUBSCRIPTION_ID`, `ARM_CLIENT_ID`, `ARM_CLIENT_SECRET`, `ARM_TENANT_ID` | Medium | ✅ |
| B5 | **GCP** | `gcp_project`, `google_credentials` (JSON key file content) | `GOOGLE_PROJECT`, `GOOGLE_CREDENTIALS` (written to temp file, path exported) | Low | ✅ |
| B6 | **Oracle Cloud (OCI)** | `tenancy_ocid`, `user_ocid`, `fingerprint`, `private_key` (PEM), `region` | Written to `~/.oci/config` before `terraform init` | Low | ✅ |
| B7 | **Proxmox privilege separation warning** | `pm_api_token_id` help text updated (migration 0221) to warn that tokens with "Privilege Separation" enabled need `User.Audit` + `Sys.Audit` explicitly granted; includes step-by-step fix for Proxmox UI | High | ✅ |

---

### Phase C — Terraform Template UI

| # | Task | Priority | Status |
|---|------|----------|--------|
| C1 | **Terraform Templates list page** — `awx/ui/src/frontend/awx/resources/terraform/TerraformTemplates.tsx`; table with columns: Name, Project, Directory, Last Run, Actions; same PatternFly table pattern as Job Templates | High | ✅ |
| C2 | **Terraform Template detail/edit form** — tabs: Details (name, description, project, dir, verbosity), Variables (extra_vars editor, survey), Credentials (cloud provider picker), Inventory Target (inventory + group picker, output key pattern), Notifications, Schedules | High | ✅ |
| C3 | **Launch dialog** — reuse existing `LaunchPrompt` pattern; shows survey + extra-vars override before launch | High | ✅ |
| C4 | **Terraform Job output page** — real-time log streaming; ANSI colour support; separate tabs: `plan` output and `apply` output; "Download log" button | High | ✅ |
| C5 | **Terraform Job history list** — per-template job runs list; columns: status, operation (apply/destroy/plan), started, duration, triggered by | Medium | ✅ |
| C6 | **Workflow editor node type** — add Terraform Template as a selectable node type in the workflow visualiser; distinct icon (Terraform logo or wrench) to distinguish from Ansible job nodes | High | ✅ |
| C7 | **Sidebar nav entry** — add "Terraform Templates" under the Resources section of the sidebar navigation; use a suitable icon | High | ✅ |
| C8 | **Terraform templates in global search** — Terraform Job Templates appear in the `AwxGlobalSearch` Cmd+K palette (type `terraform_template`); queries `/terraform_job_templates/?name__icontains=…`; shown with `LayerGroupIcon`; navigates to the template detail page on selection | High | ✅ |
| C9 | **Terraform details + targeting UX hardening** — Terraform Job details now display `artifacts` alongside Extra Variables; Terraform template form now dynamically loads inventory groups after selecting a target inventory and persists selected group cleanly; workflow handoff can override downstream `limit` from `host_ip*` artifacts via `terraform_override_limit` toggle in workflow/deployment extra vars; survey save normalizes numeric defaults to prevent integer/float default type errors | High | ✅ |

---

### Phase D — Catalog System (Backend)

| # | Task | Priority | Status |
|---|------|----------|--------|
| D1 | **`CatalogItem` model** (`awx/main/models/catalog.py`) — fields: `name`, `description`, `icon_url`, `provision_workflow` (FK → `WorkflowJobTemplate`, nullable), `terraform_job_template` (FK → `TerraformJobTemplate`, nullable), `deprovision_workflow` (FK → `WorkflowJobTemplate`, nullable), `extra_vars_schema` (JSON Schema for user-visible parameters), `organization` (FK → Organization) | High | ✅ |
| D2 | **`CatalogDeployment` model** — fields: `catalog_item` (FK), `name` (user-supplied label), `owner` (FK → User), `status` choices: `pending` / `provisioning` / `active` / `deprovisioning` / `failed` / `destroyed`; `provision_job` (FK → WorkflowJob, nullable), `terraform_provision_job` (FK → TerraformJob, nullable), `deprovision_job` (FK → WorkflowJob, nullable), `extra_vars` (JSON, the values the user filled in at deploy time), `created`, `modified`, `deployed_hosts` (M2M → Host) | High | ✅ |
| D3 | **`catalog_user` role** — built-in role; auto-assigned to any user account that has zero explicit role assignments at login time (post-login signal); grants: read-only view of CatalogItems they have visibility to, launch provision workflow on visible items, view own CatalogDeployments | High | ✅ |
| D4 | **`catalog_admin` role** — built-in role; grants: full CRUD on CatalogItems and all CatalogDeployments within scope; cannot access non-catalog AWX resources | High | ✅ |
| D5 | **Default role assignment signal** — `post_save` / login signal on `User`: if a new user has zero explicit role assignments in a single-organization install, assign the org-scoped `catalog_user`/member role; multi-org installs require explicit org membership or direct CatalogItem grants so default onboarding cannot cross tenant boundaries | High | ✅ |
| D6 | **DRF API** — `/api/v2/catalog_items/`, `/api/v2/catalog_deployments/`; actions: `POST /catalog_items/{id}/deploy/` (creates CatalogDeployment + launches provision workflow), `POST /catalog_deployments/{id}/deprovision/` (launches deprovision workflow + sets status) | High | ✅ |
| D7 | **RBAC access classes** — `CatalogItemAccess`, `CatalogDeploymentAccess`; catalog_admin sees all in org; catalog_user sees items they've been given read access to | High | ✅ |
| D8 | **Deployment status tracking** — WorkflowJob completion signal updates `CatalogDeployment.status`; populates `deployed_hosts` from the inventory populated by the Terraform job in the workflow | Medium | ✅ |
| D9 | **Catalog ↔ Terraform integration (backend)** — `CatalogItem.terraform_job_template` FK; `CatalogDeployment.terraform_provision_job` FK; `CatalogItemDeploy.post()` launches `TerraformJob` when terraform template is set (falls back to provision workflow otherwise); serializers expose both fields with summary and related links; migrations 0220 (FKs) + 0221 (Proxmox help text) | High | ✅ |

---

### Phase E — Catalog UI

| # | Task | Priority | Status |
|---|------|----------|--------|
| E1 | **Catalog browse page** (`/catalog`) — card grid of available `CatalogItem`s; each card shows icon, name, description, "Deploy" button; PatternFly `Gallery` layout | High | ✅ |
| E2 | **Deploy form dialog** — wizard: Step 1 extra-vars (JSON Schema-driven form), Step 2 deployment name + confirm; launches provision workflow and creates `CatalogDeployment` | High | ✅ |
| E3 | **My Deployments page** (`/catalog/deployments`) — table of own deployments; columns: name, catalog item, status, deployed hosts (count), deployed date; row action: "Deprovision" | High | ✅ |
| E4 | **Deployment detail page** — shows deployment vars, workflow job link (with status), list of provisioned hosts with IPs, decommission button | Medium | ✅ |
| E5 | **Catalog Admin: Item management** (`/catalog/admin/items`) — CRUD table; create/edit item links provision/deprovision workflows; visible only to catalog_admin + superuser | High | ✅ |
| E6 | **Catalog Admin: All Deployments** (`/catalog/admin/deployments`) — same as My Deployments but shows all users' deployments across the org; allows force-deprovision | High | ✅ |
| E7 | **Sidebar nav** — new top-level "Catalog" section in sidebar with entries: Browse, My Deployments; Admin sub-section (Items, All Deployments) shown only if user has catalog_admin | High | ✅ |
| E8 | **Catalog-only login redirect** — if logged-in user has only `catalog_user` role, redirect from AWX root (`/`) to `/catalog` instead of the usual dashboard | Medium | ✅ |
| E9 | **Catalog ↔ Terraform integration (UI)** — `CatalogItemForm` includes `terraform_job_template` selector alongside workflow selectors; catalog item list "Provision" column shows terraform template name with `(Terraform)` badge or workflow name; catalog item detail page shows terraform template row; deployment detail page links to the `TerraformJobPage` output viewer; `CatalogBrowse` cards show terraform template name indicator | High | ✅ |
| E10 | **Catalog dynamic field UX hardening** — removed dynamic-field controls from Name template; survey fields are shown automatically in Catalog Item create/edit for centralized per-field control (no manual add/remove); dynamic values are stored independently in `dynamic_field_templates`; admins can set both `deploy_disabled_fields` and `deploy_hidden_fields` per catalog item to control deploy-form behavior; item form now uses Details/Form Fields tabs with consistent two-column layout and icon URL input removed | High | ✅ |
| E11 | **Catalog sidebar VM size discoverability** — updated Catalog admin nav label to "Catalog Items / VM Sizes" so VM size preset management is visible from the sidebar | Medium | ✅ |
| E12 | **Dedicated VM Sizes admin home** — new Catalog sidebar item `VM Sizes` with hypervisor/public-cloud tabs, per-item VM size add/edit/remove controls, and provider metadata fields (`cluster`, `node`) for future placement mapping | High | ✅ |
| E13 | **Public cloud provider strategy tabs** — added provider tabs under VM Sizes planning view; DigitalOcean enabled as first test provider tab while preserving hypervisor-only custom size enforcement | High | ✅ |
| E14 | **Marketplace template ingestion plan** — design phase for importing cloud marketplace images/templates and provider-native plans into a provider-mapping layer consumable by Catalog deploy flows | High | ✅ |
| E15 | **Workflow-driven post-provision configuration mapping** — design phase for chaining template deploy + AWX workflows (configure, validate, lifecycle actions) across hypervisors and public clouds | High | ✅ |
| E16 | **Cloud section with connection health** — new top-level `Cloud` sidebar area with provider tabs on `Connections`, credential selection, connect/disconnect actions, and status indicators (green connected, warning/error states for misconfigured/disconnected) | High | ✅ |
| E17 | **Dynamic cloud provider sub-navigation** — when a provider is connected, a provider-specific child item appears under `Cloud` and opens dedicated configuration controls for template pull policy, allowed templates, and network allow-lists | High | ✅ |
| E18 | **Cloud RBAC hardening** — Cloud sidebar visibility and cloud management pages now require admin-level access (superuser/system auditor); credential `use` capability is enforced before provider connection attempts | High | ✅ |
| E19 | **DigitalOcean cloud credential type** — added managed migration for `DigitalOcean (Terraform)` credential type (`digitalocean_terraform`) so users can create and select DigitalOcean credentials in AWX | High | ✅ |
| E20 | **Automated DigitalOcean image + pricing pull** — Cloud provider settings now call a backend endpoint that uses the selected DigitalOcean credential to pull all available images and droplet pricing, then renders both lists in the UI without manual source URL input | High | ✅ |
| E21 | **DigitalOcean Overview tab** — first tab on the DigitalOcean provider page shows a connection card with credential info, four stat boxes (images, droplet sizes, regions, networks) pulling from pulled data, and an info panel with provider description and last-pull timestamp | High | ✅ |
| E22 | **Azure VM Sizes pricing column** — VM Sizes tab in Azure provider now fetches live Linux on-demand prices from the Azure Retail Prices API (public, no auth) per primary region and displays a `Price/hr` column alongside CPU/memory/GPU specs | High | ✅ |
| E23 | **Provider page header layout** — action buttons (`Pull data`, `Manage connections`) moved to page header right side; `Last pull: [timestamp]` shown right-aligned below the buttons; applies to both DigitalOcean and Azure provider pages | Medium | ✅ |
| E24 | **Catalog deployment page header** — deployed date and action buttons (`Retry provision`, `Deprovision`) with inline status badge moved from the Details tab into the page header right side; Details tab now shows only data fields | Medium | ✅ |
| E25 | **Catalog browse provider logos** — show actual, borderless cloud provider logos (DigitalOcean, Azure, AWS, VMware, GCP, Proxmox) on catalog cards instead of circular abbreviations | Medium | ✅ |
| E26 | **Inventory/group targeting moved to provider Fields tabs** — Target inventory (dropdown) and Target group (text input) moved from the Cloud providers tab into each provider's dedicated Fields tab in the Catalog Item edit form; values are loaded from the linked TFT node and immediately PATCHed on change | Medium | ✅ |
| E27 | **Provisioning history workflow topology view** — expanded row in the provisioning history table now renders a full PatternFly `@patternfly/react-topology` Dagre graph matching the AWX workflow visualizer: same node styles/icons/status colors, "Run on success / failure / always" edge labels, zoom-in/out/fit control bar, and clickable nodes that navigate to the job output page | High | ✅ |
| E28 | **Azure + DigitalOcean workflow surveys and deprovision workflows** — added surveys (survey_enabled=True) to TFT 29 (Provision Azure VM: vm_name, resource_group_name, vnet_name, subnet_name, vm_size, admin_username) and WJT 33 (Azure VM Provision Workflow); created TFT 35 (Deprovision Azure VM, op=destroy) + WJT 36 (Azure VM Deprovision Workflow) with 4-field survey; added surveys to TFT 30 (Provision DigitalOcean Droplet: droplet_name, do_region, do_droplet_size, do_image, do_ssh_key_name) and WJT 34 (DigitalOcean VM Provision Workflow); created TFT 37 (Deprovision DigitalOcean Droplet, op=destroy) + WJT 38 (DigitalOcean VM Deprovision Workflow) with droplet_name survey | High | ✅ |
| E29 | **Cloud provider table UX improvements** — verbose/wide columns moved to expandable rows across all three provider pages (Azure: URN/ID on VMImages, GPU/MaxDisks/MaxNICs/Premium SSD/Accel.Net/Zones/Ultra SSD on VMSizes, SKU on Storage, Size on VMs; Proxmox: Type/Uptime on Templates; VMware: ID on VMs/Hosts/Networks/Datacenters, DatastoreID on Datastores); per-row Switch toggles replaced with compact `Allowed`/`Denied` Label badges; toolbar bulk-action buttons ("Allow selected" / "Deny selected") added to catalog-control tabs (Azure: Locations/VMImages/VMSizes; Proxmox: Templates; VMware: Datastores/Networks) using `PageActionSelection.Multiple` to enable row checkboxes | High | ✅ |
| E30 | **Deployment TTL / Auto-expiry** — `CatalogItem.default_lease_minutes` sets a default lease on every new deployment; `CatalogItem.require_lease` forces deployers to supply a TTL; `CatalogDeployment.expires_at` + `auto_deprovision` track the lease; a periodic system task scans for expired active deployments and fires the deprovision workflow; deploy form Step 2 gains an optional TTL picker (preset buttons: 2 h / 8 h / 24 h / 7 d + custom date); My Deployments table shows a colour-coded countdown badge (green > 4 h, yellow ≤ 4 h, red ≤ 1 h) | High | ✅ |


---

### Phase F — Proxmox End-to-End Reference Implementation

Complete working example: Proxmox VM → Ansible configuration → Catalog item.

| # | Task | Priority | Status |
|---|------|----------|--------|
| F1 | **Proxmox credential type** — implement B1 as a loaddata fixture (`awx/main/fixtures/credential_type_proxmox.json`) so it ships with the dev environment | High | ✅ |
| F2 | **Terraform template project** — sample Git repo (or `awx_devel` sub-path) with: `main.tf` using `telmate/proxmox` provider; variables: `vm_name`, `cores`, `memory`, `disk_gb`, `proxmox_template_name`, `ip_address`, `gateway`; outputs: `host_ip` (maps to AWX inventory population) | High | ✅ |
| F3 | **AWX Terraform template** — pre-seeded dev fixture: project pointing at F2 repo, Proxmox credential attached, `target_inventory` set, `target_group = "proxmox_vms"` | High | ✅ |
| F4 | **Ansible playbook template** — Job Template using a playbook that: installs Apache / Nginx on the newly added host; limits to `proxmox_vms` group; uses the host IP populated by F3 | High | ✅ |
| F5 | **Workflow** — two-node workflow: Node 1 = Terraform template (F3), Node 2 (on success) = Ansible template (F4); demonstrates passing inventory context between nodes | High | ✅ |
| F6 | **Catalog item** — `CatalogItem` fixture: "Apache on Proxmox VM"; provision_workflow = F5; deprovision_workflow = separate workflow that runs `terraform destroy` via a TerraformJob with `terraform_operation=destroy` | High | ✅ |
| F7 | **Documentation** — `docs/terraform_catalog.md`: architecture overview, credential setup, template configuration, inventory output mapping convention, Proxmox walkthrough | Medium | ✅ |

---

### Implementation Order (Suggested Sprint Sequence)

```
Sprint 1  →  A1–A3 (models + migrations) + B1 (Proxmox credential type)
Sprint 2  →  A4–A5 (task runner + inventory population)
Sprint 3  →  A6–A9 (extra-vars, injectors, API, RBAC)
Sprint 4  →  C1–C4 (Terraform template list, form, launch, job output UI)
Sprint 5  →  A10 + C6 (workflow node support, visualiser)
Sprint 6  →  D1–D5 (Catalog models + roles)
Sprint 7  →  D6–D8 (Catalog API + status tracking)
Sprint 8  →  E1–E4 (Catalog browse + deploy + deployments UI)
Sprint 9  →  E5–E8 (Catalog admin UI + role-based redirect)
Sprint 10 →  F1–F7 (Proxmox end-to-end + docs)
Sprint 11 →  B2–B6 (remaining cloud provider credential types)
```

---

---

## Phase G — AI & Platform Intelligence *(Future Development — AAP Parity)*

Features present in Red Hat Ansible Automation Platform (AAP) that are not yet in this AWX fork. These require significant backend and UI work and are tracked here for future planning.

### G1 — Ansible Lightspeed AI Assistant

| # | Task | Priority | Status |
|---|------|----------|--------|
| G1a | **Embedded chat assistant UI** — generative AI chat panel accessible from the masthead or a dedicated route; answers platform admin and management queries in natural language | High | ✅ |
| G1b | **Playbook / task coding assistant** — AI-generated playbook and task suggestions inline in the job template extra-vars and survey editors | High | ✅ |
| G1c | **BYOM (Bring Your Own Model) settings** — Settings page section to configure the AI provider: Red Hat AI, OpenAI, Azure OpenAI, IBM watsonx, or Google Gemini; stores endpoint URL + API key in AWX settings (encrypted) | Medium | ✅ |
| G1d | **Backend AI proxy** — Django view that forwards chat/completion requests to the configured model provider; masks credentials from the browser; enforces per-user rate limits | High | ✅ |

### G2 — Automation Insights Dashboard

| # | Task | Priority | Status |
|---|------|----------|--------|
| G2a | **ROI / value measurement dashboards** — compute and display automation ROI (hours saved, cost avoidance) based on job runtimes and configurable host/hour values | Medium | ✅ |
| G2b | **Real-time actionable insights** — AI-driven anomaly detection on job failure rates, execution times, and inventory drift; surface recommendations in the dashboard | Medium | ✅ |
| G2c | **Performance metrics panels** — expanded dashboard cards for capacity utilisation trends, slowest templates, and most-failed hosts over configurable time windows | Medium | ✅ |

### G3 — MCP Server (Model Context Protocol)

| # | Task | Priority | Status |
|---|------|----------|--------|
| G3a | **MCP server endpoint** — expose AWX resources (job templates, inventories, credentials, deployments) via the Model Context Protocol so external AI agents can discover and invoke automation without custom integrations | High | ✅ |
| G3b | **RAG policy injection** — pipeline to embed organisation policies and best-practice docs into a vector store; MCP server retrieves relevant context and injects it into AI agent prompts before execution | Medium | ✅ |
| G3c | **MCP auth + audit** — OAuth2 token scoping for MCP clients; every MCP-initiated action logged to the Activity Stream with `triggered_by: mcp_agent` | High | ✅ |

### G4 — AI-Assisted Inventory Generation

| # | Task | Priority | Status |
|---|------|----------|--------|
| G4a | **Natural-language inventory builder** — UI wizard where users describe their infrastructure in plain text; AI generates a structured AWX inventory (groups, hosts, variables) as a preview before saving | Medium | ✅ |
| G4b | **Cloud resource → inventory AI mapping** — extend the existing cloud provider pull to use an AI step that suggests inventory group structure and variable mappings from pulled resource metadata | Medium | ✅ |

### G5 — Automation Orchestrator (Multi-Mode Canvas)

| # | Task | Priority | Status |
|---|------|----------|--------|
| G5a | **Multi-mode workflow canvas** — extend the workflow visualiser to support three node types side-by-side: deterministic (existing Ansible/Terraform), event-driven (EDA rulebook activations), and AI-driven (Lightspeed-generated tasks) | High | ✅ |
| G5b | **Event-Driven Ansible (EDA) integration** — connect AWX to an EDA Controller instance; surface rulebook activations as workflow nodes; show event source status in the sidebar | High | ✅ |
| G5c | **AI-driven node type** — workflow node that delegates execution plan generation to the configured AI model at runtime; human-approval gate before execution | Medium | ✅ |

### G6 — OPA (Open Policy Agent) Guardrails

| # | Task | Priority | Status |
|---|------|----------|--------|
| G6a | **OPA policy engine integration** — backend middleware that evaluates OPA policies before any job launch; policies expressed in Rego; policy bundles stored in AWX settings or fetched from a remote OPA bundle server | High | ✅ |
| G6b | **Policy management UI** — Settings section to upload/edit Rego policy bundles; test panel to evaluate a sample launch request against current policies | Medium | ✅ |
| G6c | **AI-action guardrails** — OPA policies specifically scoped to MCP/AI-initiated actions; e.g. block AI agents from launching destructive jobs without a human-approval workflow node | High | ✅ |

---

## Phase H — Platform Hardening

### H1 — Multi-tenancy / Org Isolation

| # | Task | Priority | Status |
|---|------|----------|--------|
| H1 | **Hard namespace boundaries between orgs in Catalog and Cloud** — `CloudProviderConnection` and `CloudProviderState` gain `organization` FKs (migration 0245); cloud connection/state RBAC scopes reads and writes to system users or org admins; provider-state, validate, and pull endpoints resolve accessible org-scoped connections before touching provider data; Catalog deploy/VM-size/provider views pass organization context so cloud resources, pulled provider data, and catalog controls stay isolated per org | High | ✅ |
| H2 | **Org isolation endpoint parity matrix** — added functional coverage for org-admin Catalog item/deployment list scope, cross-org Terraform/workflow launch rejection, deprovision/retry permission boundaries, and every Cloud validate/pull endpoint rejecting foreign or mismatched connection organization context; frontend Catalog Item cloud-provider wiring now filters connections by the selected item organization | High | ✅ |
| H3 | **Catalog job-link route parity** — Catalog deployment details, My Deployments, All Deployments, and provisioning history now route workflow jobs through `/jobs/workflow/:id/output` and Terraform jobs through `/terraform-templates/jobs/:job_id/output`; Terraform history rows no longer attempt to render workflow topology and route params use `job_id` consistently | High | ✅ |
| H4 | **Marketplace ingestion org-isolation parity** — Marketplace imports now require an administered organization, never create unscoped global CatalogItems by omission, reject foreign-org workflow links during import, and the Marketplace modal posts the selected accessible organization so imported Catalog Items are properly wired into the same org boundary as the rest of Catalog | High | ✅ |
| H5 | **Catalog admin access + cancel endpoint parity** — Catalog admin sidebar entries and direct admin routes now require superuser or organization-admin access, with non-admin users receiving an unauthorized state instead of dead admin links; Catalog deployment cancel now has an explicit `cancel` access check so owners can cancel their own deployments, org admins can cancel same-org deployments, and forged or foreign-org cancel requests are rejected | High | ✅ |
| H6 | **CatalogItem direct RBAC + audit parity** — CatalogItems now register with DAB RBAC and Activity Stream, include an object-level `use_catalogitem` permission, and direct per-item `use_role` grants unlock Catalog deploy endpoints while syncing RoleUserAssignment and audit records | High | ✅ |
| H7 | **Default catalog user org-isolation hardening** — The default catalog-user signal no longer adds new users to every organization; automatic member-role assignment is limited to unambiguous single-org installs, while multi-org environments require explicit org or direct CatalogItem grants | High | ✅ |

---

## Notes

- **Build command**: `bash tools/scripts/deploy-ui.sh` from repo root
- **Container**: `tools_awx_1`, source bind-mounted at `/awx_devel/`
- **UI source**: `awx/ui/src/`
- **Framework**: React + PatternFly 5 + TypeScript
- **API**: DRF at `/api/v2/`
