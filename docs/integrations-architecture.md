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
| `/integrations/imports` | Import Studio. **PR 2-4 live**: upload -> detect -> profile -> map -> validate -> review -> commit -> undo (interactive mapping, saved templates, per-row validation, duplicate signals, staging review with bulk actions, `commit_import_batch` / `rollback_import_batch`). |
| `/integrations/exports` | Export Center. **PR 5 live**: config (format / relative or custom period / account + direction filters / XLSX sheet picker), inline generation for small exports + a cron for large ones, saved templates, history with signed-URL download. |
| `/integrations/activity` | Consolidated activity / health feed | **live (PR 1)** |
| `/integrations/sync` | Sync & Automation — connector sync health + recurring scheduled exports | **live (PR 6)**, opt-in flag, default off |

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
  `/integrations/imports/[id]` (detected structure, mapping, preview).

## Import Studio — map / validate / templates (PR 3)

- `web/lib/integrations/mapping.ts` — **pure** column-mapping engine
  (runs in the client for the live preview *and* on the server for the
  authoritative apply). Canonical target fields, `suggestMapping` from
  header names, `missingRequiredFields`, `normalizeImportRow` (signed /
  split / all-out / all-in amount modes, direction from amount or a
  column), and `headerSignature` / `signatureSimilarity` for template
  matching (`TEMPLATE_AUTO_APPLY_THRESHOLD = 0.85`).
- `web/lib/integrations/validation.ts` — **pure** per-row validation
  classifying each issue `blocking | warning | info` and mapping to a
  row status (`invalid` / `needs_review` / `ready`): date, amount, zero
  amount, direction, unsupported/missing currency, in-batch duplicate
  external id, missing description.
- Server actions (`app/integrations/imports/actions.ts`):
  `applyImportMapping` (re-normalize + re-validate every staged row,
  persist per-row status + issues and batch counts, status ->
  `validated`) and `saveImportTemplate` (`integration.configure`-gated,
  versioned upsert into `import_templates`). Both write an
  `integration_events` row; `space_audit_events` integration waits for
  the PR 4 `SECURITY DEFINER` commit RPC (`record_space_audit_event` is
  not service-role-callable).
- `web/components/ImportMappingForm.tsx` — interactive mapping: per-field
  column selects, amount-mode + direction-mode radios, date-format,
  default currency, a live "N of M sample rows parse" count, and inline
  "save as template". Desktop two-column, mobile stacked, 16px controls.
- `/integrations/imports/[id]` pre-fills the mapping from a matched saved
  template (when similarity ≥ threshold) else from `suggestMapping`, and
  after `validated` shows ready/review/invalid counts + a per-row status
  and issue list in the preview.

## Import Studio — staging review, commit, rollback (PR 4, migration 20261029000000)

- `commit_import_batch(p_batch_id)` / `rollback_import_batch(p_batch_id)` —
  `SECURITY DEFINER`, `integration.import_approve`-gated, caller must own
  the batch's financial source. Commit mirrors
  `import_statement_transactions`: deterministic `import|batch|row`
  `payload_hash` makes a repeat run a no-op, a Space fingerprint match
  lands `dedupe_state='possible_duplicate'` for `/transactions/review`
  (never auto-merged). Rollback removes only the batch's transactions
  that have not been merged / hand-edited / referenced elsewhere (FK
  violation caught per row); retained rows are reported and the batch
  stays `imported`. Both call `record_space_audit_event`
  (`import.committed` / `import.rolled_back`) — now reachable because
  these are SECURITY DEFINER RPCs.
- `web/lib/integrations/matching.ts` — **pure, unit-tested** explainable
  confidence model (`exact | likely | possible | distinct`) over external
  id, reference, amount+currency+direction+time window, and counterparty
  overlap. `applyImportMapping` enriches each staged row's `match` and
  bumps a `ready` row with a likely/exact match to `needs_review`.
- Actions: `setImportBatchTarget`, `setImportRecordsStatus` (bulk
  approve / ignore / re-open), `commitImportBatch`, `rollbackImportBatch`.
- `web/components/ImportStagingReview.tsx` — status-filter chips,
  per-row checkboxes + bulk bar, target-account selector, Commit / Undo /
  Re-import, and a "download invalid rows" CSV
  (`/api/integrations/imports/[id]/errors`, CSV-injection guarded).
- Financial Inbox: an `import_review` item for a batch sitting in
  `validated` with rows still to decide (`web/lib/financial-inbox.ts`,
  gated on `isIntegrationsEnabled`).

## Export Center (PR 5, migration 20261030000000)

- Private bucket `integration-exports` (public = false, service-role
  only, keyed `{workspace_id}/{export_job_id}/{filename}`). Downloads go
  out only as a 5-minute signed URL from
  `GET /api/integrations/exports/[id]` (session-authed, RLS-scoped,
  `integration.export` required) which 302-redirects to it.
- `web/lib/integrations/export/`:
  - `csv-safe.ts` (**pure, tested**) — formula-injection neutralisation
    (`= + - @ TAB CR` -> `'`-prefixed) for CSV fields and exceljs string
    cells; `csvDocument` assembles CRLF output.
  - `period.ts` (**pure, tested**) — resolves relative presets
    (`previous_month`, `current_month`, `previous_week`, `last_30_days`,
    `fiscal_year`, `all`) and absolute ranges to UTC `{from,to,label}`.
  - `query.ts` (server-only) — service-role, workspace-pinned paged fetch
    of transactions + accounts into an `ExportDataset`; `countExportRows`
    for the inline/queued decision.
  - `workbook.ts` (server-only, exceljs) — `buildCsv` (Transactions) and
    `buildXlsx` with Summary / Transactions / Income / Expenses /
    Categories / Accounts sheets (only the picked, non-empty ones),
    frozen bold header, `#,##0` number formats, column widths, workbook
    metadata; no internal ids or secrets.
  - `run.ts` (server-only) — `runExportJob(jobId)`: resolve period, build
    dataset, render bytes, upload, mark `completed` / `failed`, write an
    `integration_events` `export.completed` / `export.failed` row.
- `createExportJob` action (`integration.export`-gated): insert a
  `queued` `export_jobs` row, then run inline when the estimate is
  ≤ 20 000 rows, else leave it for the cron. `saveExportTemplate` upserts
  a versioned `export_templates` row.
- `web/app/api/cron/run-export-jobs/route.ts` — cron-secret auth,
  claim/lease via `claim_token` / `claimed_at` (15-min lease), runs
  queued + stuck jobs, and purges the stored file (not the history row)
  of completed exports older than 7 days. Not yet wired to a scheduler.
- `web/app/integrations/exports/page.tsx` + `ExportConfigForm` —
  format / period / account + direction filters / XLSX sheet picker /
  template load + save, and a download history list.
- `space_audit_events` integration is deferred here as elsewhere in the
  Export/Import non-RPC paths — `integration_events` is the audit surface
  until a write moves behind a `SECURITY DEFINER` RPC.

## Sync & Automation, health (PR 6, migration 20261031000000)

- `export_schedules` table (workspace-scoped, RLS SELECT on
  `integration.view`; writes via `integration.sync_manage` actions). A
  schedule stores a **coarse cadence** (`daily` / `weekly` / `monthly` +
  local hour + day) and an explicit `next_run_at` — no cron expression.
- `web/lib/integrations/schedule.ts` (**pure, tested**) — `computeNextRun`
  for the three cadences with a numeric UTC offset (DST not modelled in
  Phase 1; `timezone` is stored but always `UTC` for now).
- `run-export-jobs` cron additionally materialises every due schedule
  into an `export_jobs` row, runs it, advances `next_run_at`, and (on
  failure) writes an in-app `notifications` row for the schedule owner.
- `get_operational_health_snapshot` gains an `integrations` block
  (import batches created / failed / review backlog + age, export jobs
  created / failed / stuck, schedules enabled / overdue) — still
  identifier-free and service-role only. The prior body is split into
  `get_operational_health_snapshot_core` so the wrapper can append.
- `/integrations/sync` (gated `isSyncEnabled`, default off) — connector
  sync health + a schedule list (`ExportScheduleList`) and create form
  (`ExportScheduleForm`). Dashboard shows a Sync & Automation card when
  the flag is on.
- Analytics: this codebase wires no analytics provider — `integration_events`
  is the durable product-event store for the Integrations area, the same
  role `service_recent_usage` plays for the directory.

# Phase 2 — Spreadsheet & Destination Connections

The Phase 1 ingestion connector model is **inbound-only**. Phase 2 adds a
parallel **outbound / bidirectional** layer, same conventions (RLS SELECT on
`integration.view`, service-role / capability-gated writes, `integration_events`
activity, the cron claim/lease pattern). Real OAuth providers (Google Sheets /
Excel-365 / Drive / OneDrive / Dropbox) are **capability-stubbed and dark**
until their `*_CLIENT_ID/SECRET` env is set; the **webhook** destination and a
**`manual_file`** workbook mode are built for real.

## Data model (P2-PR1, migration 20261101000000)

| Table | Purpose |
| --- | --- |
| `integration_destinations` | An outbound delivery target: `download` / `webhook` / `cloud_storage` / `connected_workbook`. `config` redacted. |
| `integration_destination_secrets` | **Service-role only, zero authenticated/anon grants** — hashed webhook secret + (later) encrypted OAuth tokens. |
| `connected_workbooks` | Persistent link to an external spreadsheet; `direction` `export`/`import`/`two_way`, `source_of_truth` default `oneledger`. |
| `integration_sync_runs` | One traceable delivery / sync execution; counts, cursor movement, retry state (`attempt`, `next_attempt_at`, claim/lease). |
| `integration_conflicts` | Field-level OneLedger↔external disagreement awaiting a human decision; never auto-resolved. |

`export_jobs` + `export_schedules` gain `destination_id` (null = download). The
closed capability catalog + grant CHECK gain `integration.destination_manage`,
`integration.workbook_manage`, `integration.conflict_resolve` (owner/admin only).
Pure types + vocabularies: `web/lib/integrations/destinations/model.ts`;
RLS-scoped reads in `web/lib/integrations/queries.ts`.

## Destinations: download + signed webhook (P2-PR2)

- `web/lib/integrations/destinations/webhook.ts` (**pure, tested**) —
  `signWebhookPayload` (HMAC-SHA256 of `{timestamp}.{body}`),
  `buildWebhookHeaders` (`X-OneLedger-Signature` / `X-OneLedger-Timestamp`),
  and `isSafeWebhookUrl` — an **SSRF guard** rejecting non-https, embedded
  credentials, and literal loopback / private / link-local / metadata hosts.
- `web/lib/integrations/destinations/deliver.ts` (server-only) —
  `deliverExportToDestination`: `download` is a no-op; `webhook` POSTs a signed
  JSON envelope (`oneledger.export.ready` + a 1-hour signed download URL,
  `redirect: "error"`, 15s timeout); `cloud_storage` / `connected_workbook`
  record a `partial` run (`provider_not_configured`) until P2-PR3/PR4. Every
  attempt writes an `integration_sync_run` and updates the destination's
  `status` / `last_delivery_at` / `last_error_code`.
- `run-export-jobs` calls it after a job completes; the schedule cron copies
  `destination_id` onto the job it materialises.
- Actions (`web/app/integrations/sync/actions.ts`, `integration.destination_manage`):
  `createDestination` (webhook secret is reveal-once, SHA-256 stored in
  `integration_destination_secrets`), `updateDestination`, `deleteDestination`,
  `rotateWebhookSecret`, `testDestination` (sends a signed `oneledger.test`).
- UI: `/integrations/sync` "Destinations" section (`DestinationManager`);
  `ExportConfigForm` + `ExportScheduleForm` gain a "Deliver to" `<select>`.

## Cloud-storage destination — dark adapter (P2-PR3)

- `destinations/cloud-storage/contract.ts` (**pure, tested**) — provider keys
  (`google_drive` / `onedrive` / `dropbox`), `CLOUD_STORAGE_PROVIDER_META`
  (auth/token URLs, scopes, PKCE, the two env-var names), a
  `CloudStorageClient` interface, `normalizeFolderPath`, and
  `ProviderNotConfiguredError`.
- `destinations/cloud-storage/registry.ts` (server-only) —
  `isCloudProviderConfigured` (both `*_CLIENT_ID` + `*_SECRET` present),
  `configuredCloudProviders`, `getCloudStorageClient`. An **unconfigured**
  provider's client throws `ProviderNotConfiguredError` from every method; a
  **configured** one gets a real OAuth `authUrl` / `exchangeCode` / `refresh`,
  but `listFolders` / `uploadFile` still throw `provider_upload_not_implemented`
  — a delivery is never faked.
- `web/app/api/integrations/oauth/[provider]/{start,callback}/route.ts` —
  session-authed + `integration.destination_manage`; **501** with a clear
  message while the provider is dark; otherwise a state-cookie + PKCE consent
  flow. Tokens land in `integration_destination_secrets`
  (`secret_kind='oauth_token'`; encryption at rest is a follow-up — the table
  is service-role-only).
- `createCloudStorageDestination` action (`integration.destination_manage`,
  `INTEGRATIONS_CLOUD_STORAGE_ENABLED`) creates a `needs_auth` destination and
  returns the OAuth start URL only when the provider is configured.
- `deliver.ts` cloud-storage branch resolves the token, fetches the export
  file via a signed URL, and calls `uploadFile` — `provider_not_configured` /
  `provider_upload_not_implemented` are recorded as **partial** runs (honest
  dark state), real errors as **failed**.
- `DestinationManager` shows cloud providers only when
  `INTEGRATIONS_CLOUD_STORAGE_ENABLED` is on, labels unconfigured ones
  "(not configured yet)", and never shows a dark provider as connected.

## Connected workbooks — export direction (P2-PR4, migration 20261102000000)

- `workbooks/contract.ts` (**pure, tested**) — providers (`manual_file` real;
  `google_sheets` / `excel_365` stubs), `WorkbookAdapter` interface
  (`getRevision` / `writeAllSheets` / `readAllSheets`), `defaultSheetMap`,
  `normalizeSheetMap`, `WorkbookProviderNotConfiguredError`.
- `workbooks/registry.ts` (server-only) — `getWorkbookAdapter`. `manual_file`
  is real: `writeAllSheets` builds an .xlsx (exceljs, formula-neutralised
  cells) and upserts it to the private `integration-workbooks` bucket at
  `{workspace_id}/{connected_workbook_id}.xlsx`; `readAllSheets` parses it
  back. Stub providers throw `provider_not_configured`.
- `workbooks/sync.ts` (server-only) — `runWorkbookSync`: for
  `direction in (export, two_way)` builds the full-ledger `ExportDataset`
  (`resolvePeriod('all')` + `buildExportDataset`), shapes it with
  `datasetToSheetRows` (exported from `export/workbook.ts`), and calls
  `writeAllSheets`. Every run is an `integration_sync_run`; `import` direction
  and the dark providers record a `partial` run (`inbound_not_wired` /
  `provider_not_configured`). Updates `connected_workbooks.last_sync_run_id` +
  `status`, writes `workbook.synced` / `workbook.sync_failed`.
- Actions (`integration.workbook_manage`, `INTEGRATIONS_WORKBOOKS_ENABLED`):
  `connectWorkbook` (creates the `connected_workbook` + its
  `connected_workbook`-kind destination), `syncWorkbookNow`,
  `setWorkbookStatus`, `updateWorkbookSheetMap`, `disconnectWorkbook`.
- UI: `/integrations/sync` "Connected workbooks" (`WorkbookManager`) + "Recent
  sync runs" list; `/integrations/sync/runs/[id]` run detail;
  `GET /api/integrations/workbooks/[id]` → 10-min signed download of the
  `manual_file` xlsx.

## Inbound changes + conflict review (P2-PR5, migration 20261103000000)

- `workbooks/diff.ts` (**pure, tested**) — `diffWorkbookAgainstLedger`:
  matches each external "Transactions" sheet row to a ledger row (by
  external id, else amount+direction+day+description), emits a
  `field_changed` conflict for a differing `category`/`description` and a
  `row_only_in_workbook` conflict for an unmatched external row. **No
  ledger write.**
- `runWorkbookSync` now handles `import` / `two_way`: `readAllSheets` →
  `diffWorkbookAgainstLedger` → insert `integration_conflicts` (status
  `open`). `manual_file` reads the stored file; the `uploadWorkbookFile`
  action lets the user re-upload an edited copy and re-runs the diff.
- `apply_integration_conflict(p_conflict_id)` — `SECURITY DEFINER`,
  `integration.conflict_resolve`-gated. Only `ref_type='transaction'` +
  `field in ('category','description')`; sets that one field to the
  external value (`category` also sets `category_source='manual'`), marks
  the conflict `accepted_external`, audits `integration.conflict_resolved`.
- Actions (`integration.conflict_resolve`): `resolveConflict`
  (`kept_oneledger` / `ignored` — plain status update, no ledger write),
  `applyConflict` (calls the RPC).
- Surfaces: a `sync_conflict` Financial Inbox item (new
  `FinancialInboxKind`), `/integrations/sync/conflicts` (`ConflictResolver`),
  a banner + count on `/integrations/sync`.
- `get_operational_health_snapshot` `integrations` block gains
  `sync_runs_failed`, `sync_runs_stuck`, `open_conflicts`,
  `oldest_open_conflict_age_seconds`, `destinations_needing_auth`.

## Sync-engine hardening + polling cron (P2-PR6, no migration)

- `web/lib/integrations/sync-engine.ts` (**pure, tested**) —
  `classifyFailure` (`transient` / `permanent` / `needs_auth`),
  `backoffSeconds` (`60·2ⁿ`, capped at 1h), `nextAttemptState(attempt,
  code)` → re-queue with `next_attempt_at` up to `MAX_SYNC_ATTEMPTS` (5),
  or terminal `failed` (+ `markNeedsAuth` for the auth class).
- `runWorkbookSync` applies that on failure: dark-provider codes stay a
  `partial` run; real failures re-queue (`status='queued'`, `attempt++`,
  `next_attempt_at`) or fail, and a `needs_auth` failure flips the
  workbook + destination to `needs_auth` and writes an in-app
  `notifications` row for the owner. `runWorkbookSync` now takes an
  `attempt` so a retry chain is tracked across runs.
- `web/app/api/cron/run-integration-syncs/route.ts` — cron-secret auth;
  fails runs stuck in `running` past a 15-min lease, and re-invokes
  `runWorkbookSync` for due `queued` workbook runs (claim = mark the
  queued run `superseded_by_retry`, then run a fresh one at the carried
  attempt). Not yet scheduler-wired.
- Docs: `integrations-destinations.md`,
  `integrations-connected-workbooks.md`; `authorization-matrix.md` +3
  rows; `integrations-connector-howto.md` outbound-adapter section.

# Phase 3 — Reconciliation, Accountant Handoff & Accounting Connectors

## Reconciliation Center (P3-PR1, no migration; P3-PR2, migration 20261117000000)

A read-only hub at `/integrations/reconciliation` that unifies the four
existing "these disagree, a human decides" queues — balance drift, payment
matches, possible duplicates, connected-workbook sync conflicts — each row
linking to the surface that already resolves it. Pure ranked-summary engine
`web/lib/integrations/reconciliation/summary.ts`; server-only assembler
`queries.ts` over the existing readers. P3-PR2 adds the balance-drift data
source: an authenticated `SELECT` policy on the pre-existing
`balance_reconciliations` (scoped `account → workspace`), the
`reconcile-balances` Edge Function (imports the canonical `_shared`
accounting/reconciliation engines, upserts one checkpoint per transaction by
`transaction_id`), and the `run-balance-reconciliation` cron. See
`integrations-reconciliation-center.md`.

## Ready-for-Accountant package (P3-PR3, migration 20261118000000; P3-PR4)

`accountant_packages` (RLS SELECT on `integration.view`, writes service-role)
+ private bucket `integration-accountant-packages` + capability
`integration.accountant_package`. `accountant/build.ts` reuses the Export
Center engine (`buildExportDataset` / `buildCsv` / `buildXlsx`), adds a
`@react-pdf/renderer` cover and a redacted `MANIFEST.json`, zips with `jszip`,
and hands the ZIP out only through a 300-second signed URL
(`GET /api/integrations/accountant/[id]`). Small builds run inline in
`createAccountantPackage`; `build-accountant-packages` cron handles large /
stuck ones + a 30-day retention purge. See
`integrations-accountant-package.md`.

## Accounting connectors (P3-PR5, migration 20261119000000; P3-PR6)

A parallel to connected workbooks for accounting systems — QuickBooks / Xero
/ Zoho Books / Odoo — **export direction only**, every provider **dark**.
`integration_destinations` widened (`kind='accounting'`, four provider keys);
`connected_ledgers` (`account_map` jsonb: OneLedger category key → external
account id; RLS SELECT on `integration.view`); `integration_sync_runs` gains
`connected_ledger_id`; capabilities `integration.ledger_manage` /
`integration.ledger_sync`.

- `accounting/contract.ts` (**pure, tested**) — `AccountingAdapter`
  (`authUrl` / `exchangeCode` / `refresh` / `listAccounts` / `pushEntries` /
  `getRevision`), `normalizeAccountMap`, `AccountingProviderNotConfiguredError`.
- `accounting/registry.ts` — configured vs dark from `*_CLIENT_ID` /
  `*_SECRET`; a dark adapter throws `provider_not_configured` from every
  method, a configured one gets real OAuth but `pushEntries` /
  `listAccounts` / `getRevision` throw `provider_push_not_implemented`.
- `accounting/sync.ts` → `runLedgerSync` mirrors `runWorkbookSync`: builds the
  full dataset, maps each transaction's category via `account_map`, calls
  `pushEntries`; a dark provider is a `partial` run (no retry), a real
  failure runs through `sync-engine.ts:nextAttemptState`.
- The OAuth routes `oauth/[provider]/{start,callback}` branch by provider
  family (cloud-storage OR accounting) via `resolveFlow`; tokens land in the
  service-role-only `integration_destination_secrets`.
- `/integrations/sync` gains an "Accounting ledgers" section
  (`LedgerManager.tsx`). See `integrations-accounting-connectors.md`.

## Cron, health & notifications (P3-PR7, migration 20261120000000)

- `run-integration-syncs` also retries due `queued` runs tied to a
  `connected_ledger_id`.
- `get_operational_health_snapshot`'s `integrations` block gains
  `accountant_packages_created` / `_failed`,
  `oldest_pending_accountant_package_age_seconds`, `ledger_syncs_failed`,
  `ledgers_needing_auth` — still identifier-free, service-role only.
- Notifications (in-app outbox): accountant package failed to build; ledger
  sync flipped to `needs_auth`.
- Activity: `integration_events` gains `accountant_package.created` /
  `.completed` / `.failed`, `ledger.connected` / `.synced` / `.sync_failed`.

# Phase 4 — Developer Platform

Phase 4 opens the platform to third parties: a **read-only** public REST
API, outbound webhook subscriptions, a documented inbound connector SDK,
and a marketplace surface. It is the first non-session attack surface in
the codebase, so every part is key-authenticated, scoped, rate-limited,
request-logged, and **dark behind a flag by default**.

## Read-only REST API (P4-PR1/P4-PR2, migrations 20261121000000, 20261122000000)

| Table / fn | Purpose |
| --- | --- |
| `api_keys` | `olk_`-prefixed key, SHA-256 `key_hash` (unique), `scopes text[]` ⊆ the six `*:read` scopes, `status` `active`/`revoked`, `expires_at?`. RLS SELECT on `integration.view`; writes service-role only. |
| `api_request_log` | One redacted row per `/api/v1` request (method, path, status, `ip_hash`, `response_ms`). **Zero authenticated/anon grants.** 30-day `purge-api-logs` cron. |
| `api_rate_buckets` + `api_rate_take(key, limit, window_s)` | Fixed-window limiter. `SECURITY DEFINER`, service-role execute only. Fails **open** on error. |

- **Auth model.** An API key has no Supabase session, so `auth.uid()` /
  `has_space_capability` are unusable. `/api/v1` handlers run a
  **service-role client pinned to the key's `workspace_id`**; the key's
  `scopes[]` is the authorization primitive.
- `web/proxy.ts` matcher excludes `api/v1/` so key-authed requests reach
  the handler instead of a 307 to `/login`.
- `web/lib/api/handler.ts:withApiV1(scope, fn)` is the one wrapper every
  route uses: deployment-dark check → bearer auth → per-workspace enable →
  scope check (403 `insufficient_scope`) → rate limit (429 `rate_limited`)
  → handler → always writes one `api_request_log` row (never blocks the
  response).
- Endpoints (all `GET`, cursor-paginated, redacted):
  `/api/v1/ping`, `/transactions`, `/transactions/[id]`, `/accounts`,
  `/categories`, `/exports`, `/exports/[id]` (+ 300 s signed download URL),
  `/sync-runs`, `/events`.
- Management UI: `/integrations/developer` (`ApiKeyManager` — create with
  scope checkboxes, reveal-once secret, rename, revoke). Capability
  `integration.developer_manage`.

## Outbound webhooks (P4-PR4/P4-PR5, migration 20261123000000)

| Table | Purpose |
| --- | --- |
| `webhook_subscriptions` | `url` (https CHECK), `event_types text[]` ⊆ the known set, `status` `active`/`paused`/`failing`. RLS SELECT on `integration.view`. |
| `webhook_subscription_secrets` | Plaintext `whsec_` signing secret in a **separate service-role-only table** (zero authenticated grants) so the RLS-readable subscription row never carries a signing-usable value. |
| `webhook_deliveries` | One row per (event × active subscription); `payload jsonb` + `payload_digest` fixed at enqueue so every retry signs the identical body. Service-role only. |

- `dispatch.ts:fireWebhookEvent` fans out from the existing emit sites
  (`export/run.ts`, `accountant/build.ts`, `accounting/sync.ts`).
  `deliver.ts` POSTs with `buildWebhookHeaders` (HMAC-SHA256 over
  `timestamp + "." + body`), `isSafeWebhookUrl` SSRF re-check, no
  redirects, 15 s timeout; `nextAttemptState` retry (≤ 5, `min(60·2ⁿ,
  3600)` s). After 3 terminal failures/hour the subscription flips to
  `failing`, its owner gets an in-app notification, and an
  `integration_events` `webhook.delivery_failed` is written.
- `deliver-webhooks` cron: cron-secret + claim/lease + 30-day purge of
  delivered rows. Not scheduler-wired.
- UI: `WebhookManager` on `/integrations/developer` (create with
  event-type checkboxes, Send test → `webhook.ping`, pause/resume, rotate
  secret, delete, recent deliveries).

## Inbound connector SDK (P4-PR6, no migration)

- `_shared/connector-adapter.ts` += `CONNECTOR_ADAPTER_VERSION`,
  `defineConnectorAdapter<C,R,N>()` identity helper, lifecycle JSDoc.
- `_shared/connectors/example-csv/` — a complete, deno-tested **reference**
  adapter over a public CSV URL, **inert** (no Edge Function, migration,
  or `connector_installations` row references it). Network is behind an
  injectable `fetchImpl`; `csv.ts` + `toRawEvents` are the pure seam.
- `docs/integrations-connector-sdk.md` is the contract + "turn a copy into
  a real connector" checklist.

## Marketplace + developer-platform health (P4-PR7, migration 20261124000000)

- `web/lib/integrations/marketplace/catalog.ts` — pure, deno-tested static
  catalogue of every integration (real + dark), each `{ key, name,
  category, status: available|beta|coming_soon, docHref, configHref? }`. A
  `coming_soon` entry always has `configHref: null` (asserted) so a
  non-functional integration is never made to look reachable.
- `/integrations/marketplace` — browse by category; gated
  `INTEGRATIONS_MARKETPLACE_ENABLED` (on unless `"false"`). Replaces the
  old inline "Available later" array on `/integrations`.
- `get_operational_health_snapshot`'s `integrations` block gains
  `api_requests_last_hour`, `api_keys_active`, `webhook_deliveries_failed`,
  `webhook_subscriptions_failing` — wrapper-only `create or replace`,
  still identifier-free / service-role only.
- Activity: `integration_events` gains `api_key.created` / `.revoked`
  (P4-PR3), `webhook.created` (P4-PR5) / `webhook.delivery_failed`
  (P4-PR4).

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
| `INTEGRATIONS_DESTINATIONS_ENABLED` | on | Destinations (download + webhook), downstream of sync |
| `INTEGRATIONS_WORKBOOKS_ENABLED` | **off** | Connected Workbooks + conflict review |
| `INTEGRATIONS_CLOUD_STORAGE_ENABLED` | **off** | Cloud-storage destination type |
| `GOOGLE_DRIVE_*` / `MICROSOFT_*` / `DROPBOX_*` | absent = provider dark | enables one OAuth provider |
| `INTEGRATIONS_RECONCILIATION_CENTER_ENABLED` | on | Reconciliation Center |
| `BALANCE_RECONCILIATION_ENABLED` | **off** | `run-balance-reconciliation` cron → `reconcile-balances` fn (fn also needs its own `=enabled` Edge secret) |
| `INTEGRATIONS_ACCOUNTANT_PACKAGE_ENABLED` | on | Ready-for-Accountant package + cron |
| `INTEGRATIONS_ACCOUNTING_CONNECTORS_ENABLED` | **off** | `accounting` destination type + connected ledgers |
| `QUICKBOOKS_*` / `XERO_*` / `ZOHO_BOOKS_*` / `ODOO_*` | absent = provider dark | enables one accounting OAuth provider |
| `INTEGRATIONS_DEVELOPER_API_ENABLED` | **off** | `/api/v1/*` + `/integrations/developer` |
| `INTEGRATIONS_WEBHOOKS_DEV_ENABLED` | **off** | webhook subscriptions + delivery cron (also needs the developer API on) |
| `INTEGRATIONS_MARKETPLACE_ENABLED` | on | `/integrations/marketplace` |
| `API_RATE_LIMIT_PER_MINUTE` | 120 | per-key read rate cap |

## Authorization

Integration actions are gated by the closed Spaces capability catalog
(`space_role_has_capability` + the `space_member_capability_grants` CHECK,
migration `20261010000000`). Phase 1 adds `integration.*` capabilities:
`view`, `import`, `import_approve`, `export`, `configure`, `connection_manage`,
`sync_manage`, `logs_view`; Phase 2 adds `destination_manage`,
`workbook_manage`, `conflict_resolve`; Phase 3 adds `accountant_package`,
`ledger_manage`, `ledger_sync`; Phase 4 adds `developer_manage` (API keys +
webhook subscriptions). All owner+admin only except `integration.view`
(also member). Unknown capability names still fail closed for every role
including owner/admin. Because Phase 3, Phase 4 and the Bills & Expenses
work landed concurrently, each `create or replace` of
`space_role_has_capability` must carry the **union** of every phase's
capability set — re-declaring the function must never silently drop one.

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

Real accounting-provider push implementations (adapters ship dark);
import-direction accounting sync (pull from QuickBooks/Xero/…); **write**
endpoints (POST/PATCH/DELETE) on the developer API; OAuth2
client-credentials / third-party app authorization; a hosted developer
portal; billing / quotas beyond the flat per-key rate limit; accepting
real third-party connector submissions; unrestricted two-way sync without
conflict review; per-member `grant_space_capability` support for the
`integration.*` capability family (the RPC's allowlist currently stops at
Phase 2 + `bill.*`).
