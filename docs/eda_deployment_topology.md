# EDA Deployment Topology

This AWX fork manages Event-Driven Ansible (EDA) from AWX, but EDA is not part
of native upstream AWX. Keep the deployment boundary explicit so upgrades and
support remain understandable.

## Placement Rules

| AWX deployment path | EDA placement | Reason |
| --- | --- | --- |
| Direct server, single node | Dedicated EDA VM/container stack | Keeps AWX process/container lifecycle separate from EDA and avoids overloading the controller node. |
| Direct server, multi node | Dedicated EDA VM/container stack | Matches AAP-style separation: AWX web/task/LB nodes stay AWX-only, EDA scales independently. |
| k3s | EDA pods in the same cluster | k3s already provides the orchestrator; EDA runs as separate Kubernetes workloads. |
| Existing Kubernetes | EDA pods in the same cluster | Use Kubernetes-native lifecycle, upgrades, service discovery, and storage. |

EDA should not be baked into the AWX application image or run inside the AWX
web/task containers.

## Implemented Roles

- `awx_eda_server`: deploys EDA Server on hosts in the `awx_eda` inventory
  group using the upstream `ansible/eda-server` Docker Compose deployment.
- `awx_eda_k8s`: deploys the upstream `ansible/eda-server-operator` and an
  `EDA` custom resource into Kubernetes.

The k3s and k8s AWX playbooks run `awx_eda_k8s` when `awx_eda_enabled=true`.
Server playbooks keep EDA separate; run `deploy-eda-server.yml` against the
`awx_eda` group and configure AWX with the resulting EDA API URL.

## AWX Wiring

Set `awx_eda_configure_awx_settings=true` to render EDA settings into the AWX
settings file:

- `EDA_SERVER_URL`
- `EDA_USERNAME`
- `EDA_PASSWORD`
- `EDA_VERIFY_SSL`
- `EDA_REQUEST_TIMEOUT`

For k3s/k8s, the default URL is the in-cluster EDA service:

```text
http://<eda-name>-service.<eda-namespace>.svc.cluster.local
```

For server deployments, set `awx_eda_server_url` or define an `awx_eda`
inventory host so AWX can infer:

```text
http://<eda-vm>:8000
```

## Upgrade Contract

- AWX image upgrades and EDA upgrades are independent.
- For k3s/k8s, EDA upgrades should happen through the EDA Server Operator by
  changing `awx_eda_k8s_operator_ref` or image/operator variables, then rerunning
  the EDA playbook.
- For server deployments, EDA upgrades should happen by changing
  `awx_eda_server_repo_version` and rerunning `deploy-eda-server.yml`.
- Run AWX EDA smoke after either side changes.

## Verification

Minimum proof after deployment:

```bash
export AWX_PASSWORD='password'
python3 tools/awx-deploy/scripts/smoke_eda.py \
  --url http://awx.example.com \
  --username admin
```

Use project and activation options for full E2E proof when a live EDA Controller
has reachable SCM, decision environment, organization, and rulebook IDs. Add
`--start-project-rulebook --project-rulebook-name <safe-rulebook.yml>` to prove
create project -> sync -> discover imported rulebook -> launch activation ->
inspect events -> cleanup activation -> delete project through AWX. Smoke JSON
evidence includes per-URL and total durations for upgrade/failback comparisons.

## Safety Rules

- Do not store EDA credentials or vCenter credentials in this document.
- Keep EDA admin credentials in environment variables or vault.
- Keep at least one direct EDA admin as break-glass access.
- Use AWX-to-EDA RBAC sync in observe mode before sync/enforce.
