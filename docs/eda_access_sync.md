# Capstan to Event Engine Access and Credential Projection

Capstan manages Event-Driven Ansible (EDA) access from its native RBAC model.
Capstan stores the intended organizations, users, teams, roles, and
assignments. Capstan also owns credential types, encrypted credential values,
and credential object access. EDA continues enforcing access internally, while
the Event Engine adapter projects Capstan intent into EDA through public APIs.

## Ownership model

- Capstan Access Management is the only normal management surface for EDA
  identities and organization-scoped access.
- Capstan Infrastructure -> Credential Types and Credentials are the only
  normal management surfaces for Event Engine credential definitions and
  values.
- EDA is the source of enforcement for direct EDA API/UI access.
- The projection uses EDA public APIs only. It must not write to the EDA
  database or depend on private EDA tables.
- EDA organization, user, team, role-definition, assignment, credential type,
  and credential resources are read-only through the Capstan EDA facade.
- Keep one EDA-native administrator outside the managed scope for emergency
  recovery. It is not part of the normal operator workflow.

## Managed scope

Capstan manages organization-scoped EDA role assignments and credential
object access.

| Capstan role source | EDA role target |
| --- | --- |
| Organization Admin | Organization Admin |
| Event Engine Administrator | Organization Admin |
| Event Engine Operator | Organization Operator |
| Organization Auditor | Organization Auditor |
| Organization Credential Administrator | Organization EDA Credential Admin |

Credential object roles are projected independently:

| Capstan credential role | EDA credential role |
| --- | --- |
| Credential Admin | EDA Credential Admin |
| Credential Use | EDA Credential Use |

The adapter also accepts older short EDA role names (`Admin`, `Operator`,
and `Auditor`) as aliases during lookup so older EDA deployments keep working.

The projection matches objects by stable human identifiers:

- Capstan organization name to EDA organization name
- Capstan username to EDA username
- Capstan team name inside the organization to EDA team name inside the EDA organization
- EDA role name plus `shared.organization` content type
- Capstan credential type namespace, or name when no native namespace match exists
- Capstan-managed credential marker, type, organization, and name

Manage membership and assignments from:

- Access Management -> Organizations
- Access Management -> Users
- Access Management -> Teams
- Access Management -> Roles
- Access Management -> Credential Types (`/access/credential-types`)
- Access Management -> Credentials (`/access/credentials`)

Saving the Event Engine connection queues the initial projection. Later Capstan
identity, RBAC, credential type, credential, and access changes reconcile
automatically after their database transaction commits. Secured reconciliation
and drift endpoints remain available for deployment automation and
troubleshooting, but Event Engine does not expose a second access-management UI.

## Initial Event Engine adoption

Existing Event Engine credential types and credentials can be adopted into
Capstan once during deployment bootstrap before normal reconciliation begins.
The secured adoption API is restricted to system administrators and is intended
for configuration-as-code and recovery workflows, not routine UI management.

Preview the adoption without changing either system:

```bash
curl -u admin:password \
  http://capstan.example.com/api/v2/eda/credential-import/
```

Import compatible native resources:

```bash
curl -u admin:password \
  -H 'Content-Type: application/json' \
  -d '{}' \
  http://capstan.example.com/api/v2/eda/credential-import/
```

The importer:

1. Ignores credential types and credentials already projected from Capstan.
2. Reuses an exactly compatible Capstan custom credential type or creates a
   new custom type with the Event Engine fields and injectors.
3. Converts Event Engine `eda.filename` injector references to the equivalent
   Capstan `tower.filename` form.
4. Normalizes Event Engine-only presentation and dynamic-input metadata to the
   Capstan credential type schema while preserving field IDs, labels, types,
   choices, defaults, help text, multiline flags, secret flags, and supported
   file/URL formats.
5. Requires an existing Capstan organization with the same name. It never
   creates an organization implicitly.
6. Creates a Capstan credential shell containing only non-secret values.
7. Records the exact secret fields that an administrator must enter in Capstan.
8. Marks imported objects with their original Event Engine IDs so the operation
   is repeat-safe and later reconciliation updates the same resources.
9. Reports incompatible names or schemas as conflicts and never overwrites
   existing Capstan objects.

Event Engine returns secret fields as masked values. Masked values are never
copied, guessed, returned by the import API, or written to Capstan. Open each
imported credential in Infrastructure -> Credentials, enter every reported
secret field, and save it. Until those fields are supplied, credential
reconciliation reports the object as blocked and leaves the working Event
Engine credential unchanged. After that one-time completion, Capstan is the
authoritative management surface and normal reconciliation projects all future
changes to Event Engine.

## Automatic reconciliation

After a committed organization, user, team, role-membership, role-parent,
credential type, or credential change, Capstan queues one deduplicated
background reconciliation. The reconciler:

1. Reads every Capstan organization.
2. Creates missing EDA organizations, users, and teams.
3. Creates missing organization-scoped role assignments.
4. Creates or updates custom EDA credential types and credentials owned by
   Capstan.
5. Projects credential Admin and Use assignments for native users and teams.
6. Removes stale assignments only when the actor and organization are already
   in the Capstan-managed scope.
7. Leaves unrelated EDA identities, credentials, types, and assignments
   untouched.

Missing EDA users receive a generated random unusable-for-Capstan credential
because current EDA APIs require a password field. Authentication to Capstan
remains governed by Capstan local, LDAP, or Entra login.

The queue operation is skipped when the Event Engine module or controller URL
is disabled. Changes remain stored in Capstan and reconcile after the
integration is restored.

Credential secrets remain encrypted in the Capstan database. Secret values are
decrypted only while constructing an authenticated EDA create/update request.
They are not logged, returned by the sync API, stored in activity metadata, or
included in the status report. Dynamic credential input sources and `ASK`
values are reported as incompatible because they cannot be resolved safely
outside a launch context.

Capstan and Event Engine use equivalent but differently named template
namespaces for credential file injectors. The adapter translates
`tower.filename` references to `eda.filename` only in the outbound EDA payload.
The native Capstan credential type definition is not modified.

Capstan writes ownership markers into the descriptions of projected custom
types and credentials. Enforce mode updates or deletes only marker-owned
objects. An exact unmarked EDA object is reported as a conflict and is never
silently adopted.

## Recovery API

The API remains available for inspection, upgrade canaries, and manual recovery.
Normal operators should use the RBAC Status page instead.

Preview without mutation:

```bash
curl -u admin:password http://capstan.example.com/api/v2/eda/rbac-sync/
curl -u admin:password http://capstan.example.com/api/v2/eda/credential-sync/
curl -u admin:password http://capstan.example.com/api/v2/eda/credential-import/
```

Reconcile immediately:

```bash
curl -u admin:password \
  -H 'Content-Type: application/json' \
  -d '{"mode":"enforce","create_missing_identities":true}' \
  http://capstan.example.com/api/v2/eda/rbac-sync/

curl -u admin:password \
  -H 'Content-Type: application/json' \
  -d '{"mode":"enforce","refresh_secrets":true}' \
  http://capstan.example.com/api/v2/eda/credential-sync/
```

`sync` remains accepted for backward-compatible additive reconciliation.
`enforce` is the production mode used by the automatic task.

## Module switch

EDA access sync requires `MODULE_EDA_ENABLED=true` in Settings -> Modules.
When disabled, Capstan keeps Settings -> Event-Driven Ansible and Settings ->
Modules available for administrators, but hides Automation Decisions navigation
and rejects EDA operational API calls with `403 disabled`. This lets operators
pause the non-native integration without losing its saved connection settings.

## Upgrade contract

EDA remains independently upgradeable. Before changing its pinned release,
run the adapter capability check and verify:

- `/api/eda/v1/organizations/`
- `/api/eda/v1/users/`
- `/api/eda/v1/teams/`
- `/api/eda/v1/role_definitions/`
- `/api/eda/v1/role_user_assignments/`
- `/api/eda/v1/role_team_assignments/`
- `/api/eda/v1/credential-types/`
- `/api/eda/v1/eda-credentials/`

The adapter resolves role definitions by name and content type rather than
hardcoded role IDs. Credential types and credentials are matched through native
type namespaces or Capstan ownership markers rather than upstream database IDs.
If upstream renames managed roles or changes assignment, credential schema, or
credential payload fields, update `awx/main/utils/eda_rbac.py`,
`awx/main/utils/eda_credentials.py`, and the live smoke wrapper before rollout.
Use `observe` against the candidate first, reconcile a canary organization and
non-production credential, verify direct EDA access for an Admin, Operator,
Auditor, Credential Admin, and Credential Use actor, then promote. Roll back
the EDA release if the public contract changes; do not bypass the adapter with
direct database writes.

## Safety rules

- Never store EDA passwords or tokens in this document.
- Keep at least one break-glass EDA administrator outside Capstan-managed sync.
- Use `observe` before `enforce` during upgrades.
- `enforce` deletes only stale EDA role assignments in the managed Capstan
  scope.
- Do not delete EDA users, teams, or organizations from sync. Only role
  assignments are removed by `enforce`.
- Credential cleanup is limited to objects carrying a valid Capstan ownership
  marker. Unmarked EDA credentials and credential types are never changed or
  deleted.
- Never include decrypted credential input values in sync reports, task return
  values, logs, Activity Stream metadata, tests, or documentation.
