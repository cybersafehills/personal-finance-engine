# ADR 0004: The directory models payment networks as first-class entities, governed by granular `directory.*` permissions

- **Status:** Proposed (Pay & Services Phase P, PR 1 of 4)
- **Date:** 2026-08-27
- **Context:** The Phase M USSD directory models every entry as a standalone
  `service_codes` row gated by a single boolean `profiles.is_platform_admin`.
  The eKash implementation brief requires representing an *interoperable
  national payment network* — regulated by one body, operated by another,
  reached through many participating institutions, each exposing its own
  verified access routes — and requires maker–checker separation between
  authoring and verification. Neither is expressible today. Builds on
  ADR 0001 (non-custodial), ADR 0002/0003 (payment lifecycle).

## Decision

### 1. Payment networks are their own entity graph, not a USSD code

`eKash` is a `payment_networks` row, **never** a `service_codes` row. Its
structure:

```
payment_networks ──regulatory_authority_id──▶ regulatory_authorities   ("regulated by")
       │
       ├── payment_network_operators (versioned) ──▶ service_operators  ("operated by")
       │
       ├── institution_network_participation (versioned, per-institution,
       │      own verification state) ──▶ service_providers
       │
       └── access_routes (institution-specific, channel-typed, may reference
              a service_codes USSD entry) ──┬── route_supported_flows
                                            ├── route_menu_steps
                                            ├── route_fees   (scope network|institution)
                                            └── route_limits (scope network|institution)
```

Consequences:

- "Regulated by" and "operated by" are **distinct** foreign keys. The seed
  records the National Bank of Rwanda as authority and RSwitch Ltd as
  operator; neither column is allowed to stand in for the other.
- A `service_providers` row appearing in the directory does **not** imply
  network participation. Participation is an explicit
  `institution_network_participation` row with its own `state` /
  `verified_at` / evidence. Every route likewise.
- Network-level fee (RWF 20) and capacity (RWF 10,000,000) are stored as
  `route_fees` / `route_limits` rows with `scope='network'` and
  `fee_type='published_maximum'` / `is_published_maximum=true` — carrying
  the "published maximum, not a guaranteed or eKash-charged fee"
  distinction in data, not prose. Institution-scope rows override
  network-scope rows in the read layer.
- **No universal eKash USSD code exists or is seeded.** The RSwitch notice
  contains no bank USSD strings or menu option numbers; inventing them is
  forbidden (brief §5). `access_routes` / `route_menu_steps` are added
  later, one institution at a time, each with separate verified evidence.

### 2. `directory.*` granular permissions supersede the binary admin flag for the directory

A `directory_role_grants` table maps a user to any of 14 permission slugs
(`directory.create`, `directory.edit_draft`, `directory.submit_review`,
`directory.review`, `directory.publish`, `directory.suspend`,
`directory.deprecate`, `directory.archive`, `directory.restore`,
`directory.view_admin`, `directory.view_evidence`,
`directory.manage_evidence`, `directory.view_audit`,
`directory.resolve_reports`). `has_directory_permission(perm)` — SECURITY
DEFINER, STABLE, mirroring `is_workspace_member()` — is the single
authorization primitive for every directory RLS policy and admin RPC.

- **`is_platform_admin()` implies every `directory.*` permission.** This is
  the Platform Owner fallback the brief explicitly allows at the current
  single-operator stage (brief §8): one person can author *and* verify.
  Because the implication is total, the Phase M RPCs, seed, and tests are
  behaviourally unchanged by the guard swap.
- The state-transition RPCs check a **different** permission per
  transition (`draft→pending_review` needs `directory.submit_review`;
  `pending_review→published` needs `directory.review` **and**
  `directory.publish`). Once grants are narrowed, maker–checker is
  enforced with **no schema change** — only `directory_role_grants` rows
  change.
- Authoring and verification are always written as **separate audit
  events** regardless of whether one person did both.
- Directory permissions are **platform-level and global**, orthogonal to
  `workspace_memberships.role`. An organization admin gains nothing in the
  directory automatically (brief §9).

### 3. Verification evidence is private by default

`directory_sources` (the citation) is public only when `is_public=true`;
`directory_evidence` (the uploaded file) has **no `authenticated` grant at
all** and lives in a private `directory-evidence` Storage bucket with no
`storage.objects` policies — byte access is always a signed URL issued by
a server route that first checks `directory.view_evidence`, exactly as
Phase K does for `report-artifacts`. Public directory pages may surface
only source organization, title, publication date, and an approved link.

## How this honours ADR 0001

- No new table stores, and no RPC parameter accepts, a PIN / OTP /
  password / secret / credential / security answer / card CVV.
  `admin_upsert_access_route` rejects those parameter kinds in-function,
  matching the Phase M/N allowlist rule.
- `route_menu_steps` can instruct "authorise with your provider's secure
  process" but has no field capable of holding a PIN prompt.
- eKash is presented as a network with a regulator and an operator —
  never as something OneLedger operates, and never as a code that
  "completes" a payment.

## Consequences

- Phase M's `admin_upsert_service_code` / `admin_set_service_code_state` /
  `admin_resolve_service_code_report` are re-issued (`create or replace`)
  with `has_directory_permission()` guards. Reversible; bodies otherwise
  unchanged.
- `service_directory_audit_events` gains nullable `subject_type` /
  `subject_id` columns so one audit trail covers all directory entity
  types. `service_codes` keeps its dedicated `service_code_versions`; the
  new entities use a generic `directory_versions`.
- The migration-test privilege counters (`authenticated` table-grant and
  function-EXECUTE counts) move up by a known amount, with the reasoning
  block extended in the existing Phase M/N/O style. This is the
  deliberate review checkpoint for privilege expansion.
- A future engagement that adds real provider routes to eKash still sits
  behind ADR 0001's production-enablement gate — this ADR adds directory
  structure, not money movement.
