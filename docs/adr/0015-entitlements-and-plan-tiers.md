# ADR 0015: Entitlements and plan tiers

- **Status:** Accepted, implemented behind `ENTITLEMENTS_ENABLED` (schema
  + engine + gate + Billing & Plan page; no enforcement call sites yet).
- **Date:** 2026-09-06
- **Builds on:** ADR 0011 (experience modes), ADR 0005 (workspace as the
  ownership boundary). Realises `ONELEDGER_PLATFORM_ASSESSMENT.md` §6.6
  and closes gap G2 of `docs/oneledger-onboarding-architecture-audit.md`.
- **Context:** The assessment names a monetisation path — plan tiers that
  charge for automation volume, collaboration, and operational control,
  never for a user's own data, export, deletion, or security (§7). The
  master prompt (§52) requires a *central* entitlement check, not
  `if (plan === "premium")` scattered through the UI. Nothing existed.

## Decision

### 1. The plan attaches to the workspace

`workspace_plans` — one row per `workspaces` row, `plan ∈ {free,
personal_plus, household, business}`, default `free`. A Household Space
carries the Household plan; an organization carries Business; a Personal
Space carries Free or Personal Plus. The workspace owner is the billing
contact. This lines up with experience modes (ADR 0011), which are also
derived from the active Space.

A backfill covers every existing workspace with a `free` row, and an
`AFTER INSERT` trigger (`ensure_workspace_plan`) covers every future one,
so "exactly one plan row per workspace" holds with no race against the
workspace-creation RPCs.

### 2. The tier → capability map lives in TypeScript, once

`web/lib/entitlements/plans.ts` is the single source of truth:
`PLAN_ENTITLEMENTS: Record<Plan, Entitlement[]>`, with higher tiers as
supersets of lower ones. The migration only *stores* a plan string; it
does not encode the map in SQL. Rationale: the map changes with product
packaging, not with data shape; duplicating it in a SQL function would
create a second place to keep in sync. If an RLS policy or an RPC ever
needs to gate on an entitlement, a thin `has_workspace_entitlement(uuid,
text)` SQL function can be added then, reading a small hard-coded map — but
YAGNI until a concrete call site exists.

### 3. Entitlements never gate a user's own data

Guardrail from assessment §7, enforced by a test: no entitlement key may
match `export|delete|backup|download|security|password|mfa|own_data|
ledger_access`. Free users keep the full ledger, review, security, and
data export forever. Entitlements cover only:

| Bucket | Entitlements |
| --- | --- |
| Automation volume | `automated_ingestion`, `multiple_sources`, `categorization_rules`, `scheduled_reports`, `extended_history`, `cash_flow_forecast` |
| Collaboration | `shared_space`, `space_members`, `shared_goals`, `shared_inbox`, `source_sharing` |
| Operational control | `multi_account_workspace`, `finance_roles`, `approvals`, `bills`, `reconciliation`, `professional_reports`, `audit_retention` |

### 4. Dark by default, permissive when dark

`web/lib/entitlements/gate.ts` mirrors `experience-mode/gate.ts`:

- `ENTITLEMENTS_ENABLED` (+ optional `ENTITLEMENTS_ALLOWLIST`) is the
  master switch. Off (default) ⇒ `workspaceHasEntitlement()` returns
  `true` for everything — today's behaviour, nothing restricted.
- `getWorkspacePlanState()` always reads the real row, so
  `/settings/billing` shows the truth even while enforcement is dark.
- Trials are modelled by storing the target plan on the row
  (`assigned_by = 'trial'` + `trial_ends_at`); a cron/admin downgrades
  when the window closes. The gate needs no trial special-casing.

### 5. No payment processing

There is no self-serve upgrade, no checkout, no Stripe. Plan rows are
written by `service_role` only (no `authenticated` write policy). Billing
integration is a separate future decision.

## Consequences

- Enforcement is a later, incremental step: pick a capability, replace its
  implicit "always allowed" with `await workspaceHasEntitlement(wsId,
  "<entitlement>")`, add an upgrade nudge. Each such change is small and
  independently reviewable.
- `workspace_plans` adds one table (+1 `authenticated` SELECT grant); the
  migration-suite guard counts move 118→119 tables, 149→150 grants.
- The Billing & Plan page (`/settings/billing`, added with the Settings IA
  restructure) now reads the real plan instead of a hard-coded "Free".
