# Integrations architecture

Status: **Phase 1 in progress.** This document grows PR by PR. See
`.claude/plans/zany-knitting-coral.md` for the full plan.

## What Integrations is

The Integrations area is OneLedger's financial data-exchange layer: a single
place to bring financial data **in** (imports, connections), keep it **clean**
(normalization, validation, dedupe, review), and send it **out** (exports,
destinations, sync). It is deliberately not "a page of third-party logos".

```
External source
      -> Connector / Import
      -> Normalization
      -> Validation
      -> Deduplication / matching
      -> Integration Inbox (staging)
      -> Approval / rules
      -> OneLedger ledger
      -> Exports / sync / destinations
      -> External system
```

Provider-specific logic stays behind the connector abstraction (ADR 0007); the
core ledger model is not reshaped per provider.

## Information architecture

Top-level area at `/integrations`, reached from the "More" sheet (phone), the
account menu (desktop), and a link in Settings.

| Route | Purpose | Status |
| --- | --- | --- |
| `/integrations` | Dashboard: connected summary, "move data" entry points, available-later categories | **live (PR 0)** |
| `/integrations/connections` | Connected devices / Shortcuts / providers (canonical connector model) — moved here from `/settings/connections`, which now redirects | **live (PR 0)** |
| `/integrations/imports` | Import Studio (upload -> detect -> map -> validate -> preview -> resolve -> import -> reconcile) | PR 2-4 |
| `/integrations/exports` | Export Center (filters, Excel/CSV, history, templates) | PR 5 |
| `/integrations/activity` | Consolidated activity / health feed | PR 6 |
| `/integrations/sync` | Sync & Automation (scheduled deliveries) — opt-in flag, default off | PR 6 |

## Feature flags

`web/lib/integrations/gate.ts`, env-var convention shared with
`web/lib/pay/gate.ts` (on unless exactly `"false"`; allowlist narrows a beta;
sync is off unless exactly `"true"`). Every route and server action checks the
gate server-side.

| Flag | Default | Effect |
| --- | --- | --- |
| `INTEGRATIONS_ENABLED` | on | whole area |
| `INTEGRATIONS_WORKSPACE_ALLOWLIST` | empty = everyone | staged beta |
| `INTEGRATIONS_IMPORT_STUDIO_ENABLED` | on | Import Studio |
| `INTEGRATIONS_EXPORT_CENTER_ENABLED` | on | Export Center + cron |
| `INTEGRATIONS_SYNC_ENABLED` | **off** | Sync & Automation |

## Authorization

Integration actions are gated by the closed Spaces capability catalog
(`space_role_has_capability` + the `space_member_capability_grants` CHECK,
migration `20261010000000`). Phase 1 adds `integration.*` capabilities:
`view`, `import`, `import_approve`, `export`, `configure`, `connection_manage`,
`sync_manage`, `logs_view`. Unknown capability names still fail closed for every
role including owner/admin.

## Reuse map

Integrations builds on existing primitives rather than duplicating them:
CSV parsing (`web/lib/csv.ts`), column mapping/normalization
(`web/lib/statement-import.ts`), bulk write + dedupe + idempotency (RPC
`import_statement_transactions`, `compute_transaction_fingerprint`,
`raw_financial_events.payload_hash`), duplicate review
(`getSpaceDuplicateReview` -> `/transactions/review`), the Financial Inbox
(`web/lib/financial-inbox.ts`), audit (`record_space_audit_event`), and the
canonical connector model (migrations `20261011…`–`20261024…`,
`web/lib/connector-read-model.ts`).

## Invariants

Integer minor units + explicit currency; RLS/RPC is the tenant boundary;
service-role code resolves explicit workspace/source/account scope; never
auto-merge duplicates; raw evidence preserved and re-processable; dedupe is
source/tenant scoped; credentials reveal-once / hashed / revocable; connector
installation != source != account != device credential.

## Deferred to later phases

Connected workbooks, cloud spreadsheet/storage connectors, two-way sync,
accounting connectors, Reconciliation Center, "Ready for Accountant" package,
developer API + outbound webhooks + connector SDK, integration marketplace.
