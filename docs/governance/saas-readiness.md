# Capstan SaaS Readiness

Owner: Capstan maintainers
Status: Foundation implemented; production enablement blocked
Last reviewed: 2026-07-31

## Release Boundary

Capstan 25.1.12 supports the existing self-hosted profiles and includes a disabled SaaS
registration foundation. It does not claim a production-ready multi-tenant SaaS execution plane.
All existing deployments remain in `on_prem` mode.

SaaS registration is reachable only when both settings are deployed consistently to every web
and controller replica:

```text
CAPSTAN_PRODUCT_MODE=saas
CAPSTAN_SAAS_REGISTRATION_ENABLED=true
```

The registration endpoint creates an organization and its first non-system organization
administrator atomically. It applies the local password policy, enforces unique tenant, username,
and email identifiers, and throttles by client address. SaaS public ping responses omit node and
installation topology.

## Required Invariants

- The tenant is derived from the authenticated organization context, never from an untrusted
  request field alone.
- Tenant users cannot read, mutate, launch against, approve, audit, export, or restore another
  tenant's resources.
- SaaS jobs never fall back to Capstan-hosted task workers.
- Each tenant enrolls its own execution instances and those instances are assigned only to that
  tenant's instance groups.
- Credentials, projects, inventories, execution events, artifacts, logs, caches, notifications,
  backups, and support exports retain tenant scope.
- Registration remains disabled until identity verification, abuse controls, recovery, tenant
  deletion/export, and the negative isolation matrix pass.

## Completed Foundation

- Deployment-owned `on_prem` and `saas` product modes with strict value validation.
- Explicit registration and external-execution flags, disabled by default.
- SaaS tenant metadata on organizations with a stable unique slug and lifecycle status.
- Throttled public registration with transactional organization/user creation.
- Organization-scoped administrator assignment without system-administrator privilege.
- Public topology redaction in SaaS mode.
- API and UI tests for availability gates, registration, duplicates, password policy, and
  topology redaction.

## Production Blockers

- Enforce external execution in scheduler placement and reject every local-worker fallback.
- Implement tenant execution-instance enrollment, authentication, rotation, suspension, and
  retirement.
- Complete the cross-tenant API, RBAC, scheduler, WebSocket, audit, backup, restore, and deletion
  test matrix.
- Add verified email or federated onboarding, MFA policy, recovery, bot defense, and legal terms.
- Define tenant lifecycle operations and support access with approval and audit.
- Establish SaaS SLO, capacity, incident, key-custody, backup, restore, and disaster-recovery
  evidence.

Public SaaS registration or tenant job execution must not be enabled while any blocker remains.
