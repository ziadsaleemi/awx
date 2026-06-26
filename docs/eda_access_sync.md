# AWX to EDA Access Sync

AWX can manage Event-Driven Ansible (EDA) access from AWX RBAC without taking
over EDA internals. AWX stores the intended access model. EDA keeps enforcing
access inside EDA. The AWX facade reconciles the two through public EDA APIs.

## Ownership model

- AWX is the source of intent for EDA access.
- EDA is the source of enforcement for direct EDA API/UI access.
- The sync layer uses EDA public APIs only. It must not write to the EDA
  database or depend on private EDA tables.
- EDA native access management remains available as a break-glass path.

## Managed scope

The first implementation manages organization-scoped EDA role assignments.

| AWX role source | EDA role target |
| --- | --- |
| Organization Admin | Admin |
| EDA Administrator | Admin |
| EDA Operator | Operator |
| Organization Auditor | Auditor |

The sync layer matches objects by stable human identifiers:

- AWX organization name to EDA organization name
- AWX username to EDA username
- AWX team name inside the organization to EDA team name inside the EDA organization
- EDA role name plus `shared.organization` content type

## Modes

`observe`
: Read-only. Builds the desired state from AWX RBAC, reads live EDA state, and
  reports missing identities, missing assignments, and extra assignments.

`sync`
: Creates missing EDA organizations, users, teams, and missing role
  assignments. It does not remove extra EDA assignments.

`enforce`
: Performs `sync`, then removes extra EDA assignments inside the AWX-managed
  scope for AWX-known users and teams.

## API

Preview:

```bash
curl -u admin:password http://awx.example.com/api/v2/eda/rbac-sync/
```

Sync missing:

```bash
curl -u admin:password \
  -H 'Content-Type: application/json' \
  -d '{"mode":"sync","create_missing_identities":true}' \
  http://awx.example.com/api/v2/eda/rbac-sync/
```

Enforce drift:

```bash
curl -u admin:password \
  -H 'Content-Type: application/json' \
  -d '{"mode":"enforce","create_missing_identities":true}' \
  http://awx.example.com/api/v2/eda/rbac-sync/
```

The UI route is Automation Decisions -> Access -> Access Sync.

## Upgrade contract

When updating EDA from upstream git, verify:

- `/api/eda/v1/organizations/`
- `/api/eda/v1/users/`
- `/api/eda/v1/teams/`
- `/api/eda/v1/role_definitions/`
- `/api/eda/v1/role_user_assignments/`
- `/api/eda/v1/role_team_assignments/`

The sync layer resolves role definitions by name and content type rather than
hardcoded role IDs. If upstream renames managed roles or changes assignment
payload fields, update `awx/main/utils/eda_rbac.py` and the live smoke wrapper
before marking the EDA upgrade successful.

## Safety rules

- Never store EDA passwords or tokens in this document.
- Keep at least one break-glass EDA administrator outside AWX sync.
- Use `observe` before `sync` or `enforce` during upgrades.
- Use `enforce` only after reviewing extra assignments; it deletes EDA role
  assignments in the managed scope.
- Do not delete EDA users, teams, or organizations from sync. Only role
  assignments are removed by `enforce`.
