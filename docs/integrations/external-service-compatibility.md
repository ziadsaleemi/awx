# External Service Compatibility

Capstan integrates with independently released services such as Event-Driven
Ansible (EDA), Open Policy Agent (OPA), Gatekeeper, Galaxy NG, and Project
Quay. These integrations must survive service upgrades without making an
external service the owner of Capstan configuration.

## Ownership model

Capstan owns operator intent and source configuration. External services own
only the runtime objects required to execute that intent.

For Event Engine projects:

- A Capstan Git Project is the source of truth for repository URL, branch,
  refspec, update behavior, organization, and access control.
- Capstan creates a marker-owned EDA Project mirror because upstream EDA
  rulebook discovery and activation APIs require an EDA Project identifier.
- Operators create and edit the Capstan Project. The Event Engine Projects
  page reports mirror state and reconciles it on demand.
- A repository URL change recreates only the managed EDA mirror because the
  current EDA API does not expose URL as a mutable project field.
- Deleting or recreating an EDA mirror never deletes the Capstan Project.

Credentials are not copied between products. If a Capstan Project uses a
private SCM credential, the EDA Controller must contain a credential with the
same exact name. Reconciliation fails closed when that mapping is missing or
ambiguous.

## Compatibility contract

An integration mutation must be gated by required API capabilities, not only
by a product version string. The EDA adapter reads the controller OpenAPI
document and verifies the exact project operations required by reconciliation:

- list and create projects
- read, update, and delete one project
- synchronize one project

The adapter reports one of these states:

| State | Meaning | Mutation behavior |
| --- | --- | --- |
| `compatible` | Required capabilities exist and the API version is in the tested range. | Allowed |
| `compatible_untested` | Required capabilities exist but the API version is outside the tested range or cannot be parsed. | Allowed with explicit status visibility |
| `incompatible` | One or more required capabilities are missing. | Blocked before changing external state |

The tested EDA API range is intentionally separate from the EDA operator or
Helm release version. Deployment tooling must pin both values explicitly and
must not use floating `latest` tags.

Galaxy NG now uses the same pattern. Its adapter reads the live Galaxy OpenAPI
document, reports route/method capabilities for every managed resource, and
blocks collection approval and repository synchronization before changing
external state when the required capability is missing. See
`docs/integrations/galaxy-ng.md` for its ownership and upgrade contract.

OPA, Gatekeeper, and Project Quay adapters should use the same pattern as
their management APIs evolve: a health/version probe, an explicit capability
map for every mutation, and a clear incompatible response before external
state is changed. Until each adapter has that contract, its upgrade must
remain behind a canary and integration smoke gate.

## Current release gaps

EDA project reconciliation and Galaxy NG content mutations are
capability-gated. The same guarantee does not yet exist for every integrated
service. The current deployment defaults still contain floating OPA, Galaxy
NG, and Project Quay `latest` image references, and the direct EDA Server
deployment checks out `main`. Those defaults are not an acceptable production
upgrade contract.

AP209 tracks the remaining work:

- publish one Capstan release manifest containing immutable service image tags
  or digests, operator versions, UI versions, and tested API versions;
- reject floating service references in production deployment validation;
- add operation-level capability maps for OPA, Gatekeeper, and Project Quay;
- run adjacent-version upgrade and rollback canaries for direct-server, k3s,
  and Kubernetes topologies; and
- expose the deployed and proved service matrix through status and About
  surfaces.

## Upgrade procedure

1. Record the current Capstan version, external service image/operator
   versions, API versions, and capability reports.
2. Back up Capstan PostgreSQL, external service databases, persistent content
   and registry storage, settings, credentials metadata, and Kubernetes
   manifests. Do not record decrypted secret values in the report.
3. Deploy the candidate versions to a canary environment using the same
   deployment topology and pinned images as production.
4. Run health and OpenAPI probes. Stop when a required capability is missing.
5. Run read-only smoke tests for inventory, details, filtering, pagination,
   and RBAC visibility.
6. Run reversible mutation tests: reconcile an EDA project, import content,
   evaluate a policy, and push a disposable image where applicable.
7. Upgrade production only after canary evidence passes. Keep the previous
   images, manifests, database backup, and VM or volume snapshot available.
8. Observe imports, activations, policy decisions, admission denials, content
   tasks, image pushes, and Capstan audit events through the agreed soak
   period.
9. Roll back application images and external services together when a schema
   migration, capability loss, or runtime smoke fails. Restore persistent
   state only when the vendor migration is not backward compatible.

## Release validation

Every Capstan release that changes an integration adapter must test:

- the currently pinned service version;
- the proposed service version;
- one rollback to the previous pinned version;
- RBAC and organization isolation on all new facade endpoints;
- reconciliation idempotency;
- unavailable, incompatible, and partially configured service states;
- no secret values in API responses, logs, audit records, or test artifacts.

The release evidence must identify which service versions were proved. A
passing unit test without a live canary is not a production upgrade proof.
