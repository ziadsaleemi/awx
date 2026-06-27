# Policy Deployment Topology

This AWX fork manages two different policy systems:

- OPA, the standalone Open Policy Agent policy API used for AWX guardrails.
- Gatekeeper, the Kubernetes admission-controller integration built on OPA.

Keep them separate. OPA can run anywhere AWX can reach it. Gatekeeper only makes
sense for k3s/Kubernetes clusters, or for a direct AWX server deployment that is
explicitly managing a remote Kubernetes API.

## Placement Rules

| AWX deployment path | OPA placement | Gatekeeper placement |
| --- | --- | --- |
| Direct server, single node | Dedicated OPA VM/container or external OPA URL | Disabled by default; configure only for a remote Kubernetes API |
| Direct server, multi node | Dedicated OPA VM/container or external OPA URL | Disabled by default; configure only for a remote Kubernetes API |
| k3s | Optional standalone OPA service plus AWX settings | Gatekeeper installed into the k3s cluster |
| Existing Kubernetes | Optional standalone OPA service plus AWX settings | Gatekeeper installed into the target Kubernetes cluster |

Neither OPA nor Gatekeeper should be baked into the AWX application image or run
inside AWX web/task containers.

## Implemented Roles

- `awx_opa_server`: deploys standalone OPA on hosts in the `awx_opa` inventory
  group using a container managed by systemd.
- `awx_gatekeeper_k8s`: installs Gatekeeper from the configured upstream release
  manifest into k3s/Kubernetes.

The k3s and k8s AWX playbooks run `awx_gatekeeper_k8s` only when
`awx_gatekeeper_enabled=true`. Server playbooks keep Gatekeeper separate because
the server path has no in-cluster Kubernetes API.

## AWX Wiring

Set `awx_opa_configure_awx_settings=true` to render standalone OPA settings into
AWX:

- `MODULE_OPA_ENABLED`
- `OPA_HOST`
- `OPA_PORT`
- `OPA_SSL`
- `OPA_AUTH_TYPE`
- `OPA_AUTH_TOKEN`
- `OPA_AUTH_CLIENT_CERT`
- `OPA_AUTH_CLIENT_KEY`
- `OPA_AUTH_CA_CERT`
- `OPA_AUTH_CUSTOM_HEADERS`
- `OPA_REQUEST_TIMEOUT`
- `OPA_REQUEST_RETRIES`
- `OPA_POLICY_BUNDLE`

Set `awx_gatekeeper_configure_awx_settings=true` to render Kubernetes
Gatekeeper settings into AWX:

- `MODULE_GATEKEEPER_ENABLED`
- `GATEKEEPER_K8S_API_URL`
- `GATEKEEPER_K8S_AUTH_TOKEN`
- `GATEKEEPER_K8S_CONTEXT`
- `GATEKEEPER_K8S_CONTEXTS`
- `GATEKEEPER_K8S_VERIFY_SSL`
- `GATEKEEPER_K8S_REQUEST_TIMEOUT`

For k3s/k8s, the default Gatekeeper API URL is:

```text
https://kubernetes.default.svc
```

When `awx_gatekeeper_k8s_use_service_account_token=true`, AWX reads the mounted
Kubernetes service account token at runtime if no explicit
`GATEKEEPER_K8S_AUTH_TOKEN` was provided. When
`awx_gatekeeper_k8s_manage_rbac=true`, the deploy role grants the AWX service
account the Gatekeeper API permissions needed for read, preview, apply, delete,
and rollback flows.

## Upgrade Contract

- AWX image upgrades, OPA upgrades, and Gatekeeper upgrades are independent.
- OPA upgrades happen by changing `awx_opa_container_image` and rerunning
  `deploy-opa-server.yml`.
- Gatekeeper upgrades happen by changing `awx_gatekeeper_version` or
  `awx_gatekeeper_manifest_url` and rerunning `deploy-gatekeeper-k8s.yml` or the
  k3s/k8s AWX playbook with `awx_gatekeeper_enabled=true`.
- Run policy smoke after either side changes.

## Verification

Minimum OPA proof from an AWX host/container:

```bash
awx-manage check_external_automation --json --skip-eda --skip-gatekeeper --sync-opa-policy --opa-deny-smoke --fail-on-unavailable
```

Minimum Gatekeeper proof from an AWX host/container:

```bash
awx-manage check_external_automation --json --skip-eda --skip-opa --gatekeeper-context in-cluster --fail-on-unavailable
```

For full UI proof, run the same checks from Settings -> OPA, Settings ->
Gatekeeper, and Policy as Code -> Smoke Test.

## Safety Rules

- Do not store OPA tokens, OPA client keys, Kubernetes bearer tokens, or
  kubeconfigs in this document.
- Use environment variables, Ansible Vault, or extra vars for secrets.
- Keep Gatekeeper disabled on server deployments unless a remote Kubernetes API
  URL and token/context map are intentionally supplied.
- Prefer OPA/Gatekeeper preview and dry-run modes before live apply/delete.
