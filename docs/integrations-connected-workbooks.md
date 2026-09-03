# Connected workbooks

Companion to `integrations-architecture.md`. A persistent link between the
OneLedger ledger and an external spreadsheet. Phase 2, P2-PR4 / P2-PR5.

## Model

- `connected_workbooks` — one per link. `direction`
  (`export` / `import` / `two_way`), `source_of_truth` (default
  `oneledger`), `sheet_map` (`{ transactions: "Transactions", … }`),
  `external_ref` (opaque provider handle), `status`, `last_sync_run_id`.
  Each has a paired `integration_destinations` row of kind
  `connected_workbook` carrying the `provider`.
- Providers: **`manual_file`** (real) — the workbook is one `.xlsx` stored
  in the private `integration-workbooks` bucket at
  `{workspace_id}/{connected_workbook_id}.xlsx`, rewritten on every export
  sync and downloadable via `GET /api/integrations/workbooks/[id]`
  (10-min signed URL). `google_sheets` / `excel_365` are stubs that throw
  `provider_not_configured`.

## Sync lifecycle (`workbooks/sync.ts` — `runWorkbookSync`)

```
export / two_way:
  buildExportDataset (whole ledger) -> datasetToSheetRows(sheet_map)
  -> adapter.writeAllSheets  (manual_file: build .xlsx, upsert to bucket)

import / two_way:
  adapter.readAllSheets  (manual_file: parse the stored/uploaded .xlsx)
  -> diffWorkbookAgainstLedger(transactions sheet, ledger)
     match by external id, else amount+direction+day+description
     -> field_changed (category / description) conflicts
     -> row_only_in_workbook conflicts
  -> insert integration_conflicts (status 'open')   [NO ledger write]

every run -> one integration_sync_runs row (counts, cursor, retry state)
```

`manual_file` inbound only produces conflicts after the user
**downloads, edits and re-uploads** (`uploadWorkbookFile` action) — the
freshly-written file matches the ledger exactly.

## Source of truth

OneLedger stays authoritative. Inbound differences never write the
ledger; they wait in `/integrations/sync/conflicts`. Resolution:

- **Keep OneLedger** / **Ignore** — `resolveConflict` action, a status
  update only.
- **Accept workbook value** — `applyConflict` → the
  `apply_integration_conflict(p_conflict_id)` `SECURITY DEFINER` RPC
  (`integration.conflict_resolve`-gated). It only touches a whitelisted
  transaction field (`category` — also sets `category_source='manual'` —
  or `description`), marks the conflict `accepted_external`, and audits
  `integration.conflict_resolved`. `row_only_in_workbook` conflicts are
  surfaced for awareness only; importing new rows goes through the Import
  Studio.

## Retry engine (`sync-engine.ts`, `run-integration-syncs` cron)

`nextAttemptState(attempt, code)` classifies a failure:

- **transient** (network, 5xx, write blip) — re-queue with exponential
  backoff (`60·2^n` s, capped at 1h), up to `MAX_SYNC_ATTEMPTS` (5).
- **permanent** (`provider_not_configured`, 4xx, unsafe URL) — `failed`,
  no retry.
- **needs_auth** (`no_secret`, `oauth_exchange_failed`, …) — `failed`,
  flip the workbook + destination to `needs_auth`, notify the owner
  (`notifications` in-app row).

`run-integration-syncs` (cron-secret + claim/lease): fails runs stuck in
`running` past a 15-min lease, and re-invokes `runWorkbookSync` for
`queued` workbook runs whose `next_attempt_at` is due.

## Flag

`INTEGRATIONS_WORKBOOKS_ENABLED` — **off** unless exactly `"true"`.
Gates connected workbooks and the whole conflict-review surface.
