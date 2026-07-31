# SaaS Delivery Tracker

Owner: Capstan maintainers
Status: Active
Last reviewed: 2026-07-31

| Slice | Status | Acceptance evidence | Remaining limit |
| --- | --- | --- | --- |
| Explicit product mode | Done | Strict settings validation and API exposure tests | Replica consistency is deployment-owned |
| Tenant registration foundation | Done | Backend and component tests | Must remain disabled outside controlled development |
| Public topology redaction | Done | SaaS ping functional test | Additional public endpoints need isolation audit |
| Tenant execution enrollment | Planned | None | Enrollment/authentication/lifecycle not implemented |
| Scheduler external-only enforcement | Planned | None | Local fallback is still possible and blocks SaaS execution |
| Cross-tenant isolation matrix | Planned | None | All APIs, facades, jobs, events, backup/restore, and deletion need proof |
| Production identity/onboarding | Planned | None | Verification, MFA, recovery, abuse defense, and terms are open |
| SaaS operations | Planned | None | SLO, support, incident, capacity, backup, restore, and DR are open |

## Current Release Decision

25.1.12 can include the disabled foundation because the default remains self-hosted, registration
requires two explicit deployment settings, and SaaS execution is not represented as supported.
Public SaaS enablement remains blocked by findings CAPSTAN-SaaS-002 through CAPSTAN-SaaS-005.
