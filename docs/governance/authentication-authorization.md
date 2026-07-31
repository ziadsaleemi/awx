# SaaS Authentication And Authorization Contract

Owner: Capstan maintainers
Status: Draft for SaaS; self-hosted behavior unchanged
Last reviewed: 2026-07-31

## Identity

The canonical human identity is the Capstan user. A SaaS tenant is an Organization with
`is_saas_tenant=true`, a unique `tenant_slug`, and an active lifecycle state. Registration creates
one local user and grants only that organization's Member and Admin roles. It never grants system
administrator or system auditor privileges.

LDAP and Microsoft Entra ID remain deployment-configured authentication providers. They do not
by themselves grant organization access; Capstan RBAC remains authoritative.

## Authorization Rules

- API collections must use existing access classes and RBAC-filtered querysets.
- Resource existence outside the caller's scope must not be disclosed.
- Organization administrators can manage only resources authorized within their organization.
- Execution placement must bind organization, inventory, credentials, project, template,
  instance group, and execution instance before launch.
- Approval and execution must recheck current access; stale grants cannot authorize work.
- System administration is reserved for platform operators and is never assigned by public
  registration.

## Current Verification

Functional tests prove registration gating, password policy, uniqueness, transactional creation,
organization-role assignment, and absence of system privilege. These tests do not constitute the
full negative cross-tenant matrix required for production SaaS.

## Open Gates

- Verified identity, MFA/federation policy, recovery, and anti-automation controls.
- Negative tests for every enhanced endpoint and integrated-service facade.
- Tenant-scoped execution enrollment and scheduler enforcement.
- Tenant lifecycle, deletion, export, support, and break-glass procedures.
