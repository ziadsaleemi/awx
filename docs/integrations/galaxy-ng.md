# Galaxy NG Integration

Capstan is the operator-facing control plane for Galaxy NG. It does not copy
Galaxy NG into Capstan or make operators maintain the same setting in two
places.

## Ownership

| Concern | Source of truth | Capstan behavior |
| --- | --- | --- |
| Connection URL, authentication, TLS, timeout, API/content prefixes | Capstan Settings > Galaxy NG | Stores the integration configuration and uses it for all Galaxy API calls. |
| Source-controlled collection code | Capstan Projects | Validates a synced Project and its `galaxy.yml` before generating a collection build/publish plan. |
| User, team, organization, and role intent | Capstan RBAC | Controls who can view Hub content, generate project import plans, approve content, and start repository syncs. |
| Namespaces, collections, repositories, remotes, signing services, approvals, and tasks | Galaxy NG/Pulp | Reads live runtime state through the Capstan API facade. Capstan does not create shadow database records for these objects. |
| Collection approval and repository synchronization | Capstan-authorized operation against Galaxy NG | Validates Capstan RBAC and the live Galaxy API capability before changing Galaxy state. |
| Execution environment images | Project Quay | Galaxy NG stores Ansible collections. Container repositories and EE image builds remain in the Quay integration. |

The legacy `/galaxy-ng/api-token` route redirects to the Galaxy NG Settings
category. Connection credentials must not be exposed as a second operational
page.

## API compatibility contract

Galaxy NG, Pulpcore, pulp-ansible, and the Galaxy UI can be upgraded
independently from Capstan. Product version strings are useful diagnostics,
but they are not sufficient evidence that an operation remains compatible.

Capstan reads the connected service's OpenAPI document at
`/api/galaxy/v3/openapi.json` and records:

- Galaxy/Pulp component versions;
- OpenAPI and schema versions;
- supported read capabilities for every Galaxy page;
- supported collection publish, collection approval, and repository sync
  mutations; and
- missing capabilities that require operator attention.

Mutations fail closed. Before Capstan approves or rejects a collection or
starts a repository sync, it refreshes the OpenAPI document and verifies the
exact route and HTTP method. A missing capability returns HTTP `409` with
status `incompatible`; Capstan does not send the mutation to Galaxy.

The `_ui/v1` collection approval and remote registry APIs are treated as
explicit capabilities because they are more likely to change than the
versioned public API. Their absence degrades only the affected Capstan page
and does not change ownership of other Galaxy content.

## Upgrade procedure

1. Pin the current and candidate Galaxy NG, Pulpcore, pulp-ansible, UI, Redis,
   and PostgreSQL images or releases. Do not promote a floating `latest`
   reference to production.
2. Back up the Galaxy database and Pulp content storage. Record Capstan
   settings without decrypted credentials.
3. Deploy the candidate stack to a canary matching the production topology.
4. Open a Capstan Galaxy page with `refresh=1` on the status API and confirm
   the capability state is `compatible`.
5. Verify namespaces, collections, repositories, remotes, signature keys,
   approvals, and tasks with the same Capstan user roles used in production.
6. Publish a disposable collection from a synced Capstan Project, approve it
   when staging is enabled, install it, and run a reversible repository sync.
7. Promote only after the canary passes. Keep previous images, database
   backup, content snapshot, and manifests available through the soak period.
8. If a capability disappears or a data migration is not backward compatible,
   stop Capstan mutations and roll back the Galaxy stack and persistent state
   according to the vendor migration guidance.

## Release evidence

Every Capstan release that changes the Galaxy adapter must record:

- Capstan and adapter contract versions;
- Galaxy NG, Pulpcore, pulp-ansible, pulp-container, and UI versions;
- the live capability report;
- read-only page and RBAC results;
- project build, publish, approval, install, and repository sync results; and
- upgrade and rollback results for direct-server, managed k3s, and Kubernetes
  deployments.

Unit tests prove adapter behavior. They do not replace the live canary.
