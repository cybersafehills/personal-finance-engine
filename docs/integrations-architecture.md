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
| `/integrations/imports` | Import Studio. **PR 2 live**: upload -> detect -> profile (list, `/new` upload, `[id]` detected structure + preview). Map / validate / duplicate review / commit / rollback: PR 3-4. |
| `/integrations/exports` | Export Center (filters, Excel/CSV, history, templates) | PR 5 |
| `/integrations/activity` | Consolidated activity / health feed | **live (PR 1)**, enriched PR 6 |
| `/integrations/sync` | Sync & Automation (scheduled deliveries) — opt-in flag, default off | PR 6 |

## Data model (PR 1, migration 20261027000000)

Six workspace-scoped tables, all RLS-enabled with a SELECT policy gated on
the `integration.view` capability (Space viewers see nothing). Every write
goes through a service-role client or a `SECURITY DEFINER` RPC (PR 2-5)
that checks the specific `integration.*` capability — there are no
`authenticated` INSERT/UPDATE policies.

| Table | Purpose |
| --- | --- |
| `import_templates` | Reusable column mapping + parsing profile, matched to a file by `header_signature`. |
| `import_batches` | One uploaded CSV/XLSX file and its 9-state lifecycle (`uploaded`…`imported`/`rolled_back`). |
| `import_records` | Per-row staging (the Integration Inbox); 10-state `status`, `validation` + `match` JSON. |
| `export_templates` | Reusable export config (filters, relative period, format). |
| `export_jobs` | One export request; `queued`/`processing`/`completed`/`failed` + `claim_token` for the PR5 cron. |
| `integration_events` | Append-only, redacted activity/health feed (no secrets, no raw financial text, no stack traces). |

`transactions` gains `import_batch_id uuid` (FK, `on delete set null`,
partial index); the `source` CHECK now allows `'import'`; a new
`transactions_import_batch_only_for_import` CHECK keeps the batch id off
non-import rows.

Read models: `web/lib/integrations/queries.ts` (RLS-scoped list/get),
`web/lib/integrations/activity.ts` + `activity-model.ts` (the
`/integrations/activity` feed), `web/lib/integrations/model.ts` (pure
types + status vocabularies).

## Import Studio — upload / detect / profile (PR 2, migration 20261028000000)

- Private storage bucket `integration-imports` (public = false, no
  `storage.objects` policies — same model as the Phase K report-artifacts
  bucket). Objects keyed `{workspace_id}/{import_batch_id}/{sanitized_name}`.
- `web/lib/xlsx-read.ts` — reads `.xlsx` into the `{ headers, rows }` shape
  of `web/lib/csv.ts` via **exceljs** (server-only; added to
  `web/package.json`). `.xls` is rejected with a clear message. (exceljs
  pulls a transitive `uuid` advisory GHSA-w5hq-g745-h8pq — only relevant to
  a code path we never hit, read-only; not downgrading to the breaking 3.x.)
- `web/lib/integrations/profile.ts` — **pure, unit-tested** data profiling:
  row count, date range, currency guess, likely column roles, and
  invalid / repeated-header / blank / ready-row counts. Reuses the
  `statement-import` heuristics.
- `web/app/integrations/imports/actions.ts` — `uploadImportFile` server
  action: gate + `has_space_capability('integration.import')` check, then
  MIME/extension/size/parse validation (nothing is written until the file
  parses), filename sanitize, service-role writes of the `import_batches`
  row + `import_records` staging rows (capped at 5000 in this phase) + the
  file + an `integration_events` `import.uploaded` row.
- Pages: `/integrations/imports` (list), `/integrations/imports/new`
  (`ImportUploadForm` — drag/drop, 16px controls, retryable), and
  `/integrations/imports/[id]` (detected structure, suggested column
  mapping, first-20-row preview; "map & import" is a labelled placeholder
  until PR 3).

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
