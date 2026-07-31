# Capstan-managed Terraform state in Git

Capstan can persist Terraform local state in a Git project without requiring an
Azure, S3, GCS, Terraform Cloud, or other remote backend. The state lifecycle is
owned by the Terraform Job Template and is visible through the template's
**State** tab.

This is not Terraform's native Git backend; Terraform does not provide one.
Capstan restores and publishes local state around each Terraform run.

## Security model

Terraform state can contain passwords, private keys, tokens, generated
credentials, IP addresses, and other sensitive resource attributes. Capstan
therefore never commits plaintext `terraform.tfstate`.

For every managed template Capstan:

1. creates a unique Fernet data-encryption key;
2. encrypts that key using the Capstan `SECRET_KEY`;
3. encrypts the Terraform state before committing it to Git;
4. commits only encrypted state and non-secret structural metadata; and
5. exposes only redacted state structure through the API and UI.

The State tab shows revisions, commits, Terraform version, lineage, serial,
resource identities and counts, and output names/types. It does not expose
resource attributes or output values.

## Template configuration

On a Terraform Job Template, set **State Management** to **Capstan managed
Git**, then configure:

| Field | Purpose |
|-------|---------|
| State Project | Git-backed Capstan Project used for encrypted state. If omitted, the Terraform source Project is used. The Project SCM credential must be able to fetch and push. |
| State Branch | Dedicated state branch. The default is `capstan-terraform-state`. |
| State Key | Stable logical identity for one Terraform state. The default is `template-<template_id>`. |

State keys may contain letters, numbers, `.`, `_`, `-`, and `/`. They may also
contain launch-time placeholders:

```text
organizations/{organization_id}/templates/{template_id}/{environment}
```

`template_id`, `organization_id`, and scalar extra variables are available.
Every placeholder must resolve at launch. Use the same key for apply and destroy
templates that manage the same infrastructure.

Do not configure Capstan-managed Git state for a root module that declares a
non-local Terraform backend. Capstan rejects that combination instead of
silently creating two competing state owners.

## Job lifecycle

Before `terraform init`, Capstan:

1. acquires a database lock for the state Project and branch;
2. checks out the configured state branch;
3. locates the encrypted file by a hash of the state key;
4. decrypts and validates the state; and
5. writes `terraform.tfstate` into the ephemeral Terraform working directory.

After Terraform runs, Capstan encrypts and pushes the new state, records an
immutable `TerraformStateRevision`, and links the restored and published
revisions from the Terraform job details page.

The branch lock serializes writers across all templates sharing a Project and
branch. This is intentionally broader than one state key because a Git push
updates the shared branch head.

If an apply fails after changing infrastructure, Capstan still attempts to
publish the state Terraform produced. If Git publication fails, it stores an
encrypted recovery copy under:

```text
<JOBOUTPUT_ROOT>/terraform_state_recovery/
```

Treat recovery files as sensitive backups. Correct the Git or credential
problem before another job uses the same state.

## Inspection and audit

Open a Terraform Job Template and select **State**. The revision table is
paginated and can be filtered by operation or job status. Expanding a revision
shows:

- Git commit and encrypted repository path;
- state key, Project, and branch;
- plaintext checksum;
- Terraform version, state lineage, and serial;
- resource mode, type, name, provider, and instance count; and
- output name, type, and sensitivity flag.

The job **Details** tab identifies the revision restored before the run and the
revision published after it.

The plaintext checksum allows operators to prove state continuity without
making the state downloadable.

## Backup, restore, and key rotation

A usable backup requires all three:

- the state Git repository;
- the Capstan PostgreSQL database; and
- the matching Capstan `SECRET_KEY`.

Restoring only the Git repository leaves the per-template data keys
unavailable. Restoring a database and Git repository with the wrong
`SECRET_KEY` makes those data keys undecryptable.

Use the supported `regenerate_secret_key` management command when rotating the
Capstan secret. It re-encrypts managed Terraform data keys along with other
encrypted model fields. Back up the database and state repositories before
rotation and run a plan-only canary afterward.

## Moving existing infrastructure

Do not simply switch an active template from Azure, S3, or another remote
backend to managed Git. That starts from an empty local state and Terraform may
try to recreate existing resources.

Use a controlled migration:

1. stop launches for the template;
2. back up the current remote state;
3. migrate or import the state into a local `terraform.tfstate`;
4. validate it with `terraform plan`;
5. publish it through a non-destructive managed-state canary; and
6. verify the State tab before enabling normal apply/destroy launches.

Keep external backends selected for teams that need native Terraform locking,
cross-tool state access, or existing backend governance.
