# Deployment And Update Contract

Owner: Capstan maintainers
Status: Active
Last reviewed: 2026-07-31

## Supported Release Profiles

| Profile | Current state | Execution | Release path |
| --- | --- | --- | --- |
| Direct server | Supported | Local or connected execution nodes | Capstan Deploy server playbook |
| Multi-node server | Supported | Receptor/task nodes | Capstan Deploy server playbook |
| Managed k3s | Supported | Kubernetes task pods and connected nodes | Capstan Deploy k3s playbook |
| Kubernetes | Supported | Kubernetes task pods and connected nodes | Capstan Deploy k8s playbook |
| SaaS control plane | Foundation only | Tenant-owned external execution required | Not production supported |

## Release Identity

A release uses one Git tag, top-level `VERSION`, About version, UI package and lock versions,
Capstan Deploy default tag, and immutable container tag. The release script rejects mismatched
metadata, a dirty or unpushed branch, or an existing tag before building a linux/amd64 image.

## Upgrade Procedure

1. Run source, migration, backend, frontend, deploy syntax, and browser checks.
2. Commit and push the exact release source.
3. Build and push the exact image, verify its registry digest, then create the Git tag.
4. Create and verify a deployment backup before each target upgrade.
5. Upgrade one deployment profile at a time using its retained inventory and exact image tag.
6. Verify public ping, authenticated identity, migrations, workers, and enabled integrated
   services before continuing.
7. Record failed or unreachable targets without claiming rollout completion.

## Rollback

Application rollback uses a verified pre-release backup plus the prior immutable image tag.
Database schema rollback is not assumed safe merely because an older image starts. Restore must
follow the Capstan Deploy backup/restore path and be verified through authenticated API and job
execution smoke tests.

## SaaS Restriction

25.1.12 may ship the disabled registration foundation, but existing deployments remain
`CAPSTAN_PRODUCT_MODE=on_prem`. Enabling SaaS is a separate controlled deployment requiring every
blocker in `saas-readiness.md` to close.
