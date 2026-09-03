# Accounting connectors

_Integrations Phase 3, P3-PR5 (model) + P3-PR6 (flow) + P3-PR7 (cron/health)._

Push OneLedger transactions into an external accounting system —
**QuickBooks Online, Xero, Zoho Books, Odoo**. Export direction only; every
provider ships **dark**.

## Data model (migration `20261119000000`)

- `integration_destinations` widened: `kind` gains `accounting`; `provider`
  gains `quickbooks` / `xero` / `zoho_books` / `odoo`.
- `connected_ledgers` — `destination_id`, `external_ref` (opaque provider
  handle, e.g. a QuickBooks realmId), `account_map` jsonb, `direction` fixed
  `export`, `status` `active|paused|needs_auth|error|disconnected`,
  `last_sync_run_id`. RLS `SELECT` on `integration.view`; every write is
  service-role only.
- `integration_sync_runs` gains `connected_ledger_id`.
- Capabilities `integration.ledger_manage` / `integration.ledger_sync`
  (owner/admin), and the OAuth token lands in the service-role-only
  `integration_destination_secrets` (`secret_kind = 'oauth_token'`).

### `account_map`

`{ "category:Meals": "4000", "category:Travel": "4010", … }` — a OneLedger
category key (`category:<name>`, `category:uncategorised` fallback — see
`ledgerMapKeyForCategory`) mapped to an opaque external account id. A
transaction whose category has no mapping is **skipped** and counted
`unmapped` on the sync run. `normalizeAccountMap` bounds it (string→string,
trimmed, ≤ 500 entries, ≤ 200 chars each).

## Adapters (all dark)

`accounting/contract.ts` — `AccountingAdapter`: `authUrl` / `exchangeCode` /
`refresh` / `listAccounts` / `pushEntries` / `getRevision`.
`accounting/registry.ts` decides configured vs dark from the provider's
`*_CLIENT_ID` + `*_SECRET`:

| state | `authUrl` / `exchangeCode` / `refresh` | `listAccounts` / `pushEntries` / `getRevision` |
| --- | --- | --- |
| unconfigured | throw `provider_not_configured` | throw `provider_not_configured` |
| configured | real OAuth (PKCE for Xero/Odoo) | throw `provider_push_not_implemented` |

The OAuth routes `oauth/[provider]/{start,callback}` branch by provider
family via `resolveFlow`; while a provider is dark, `start` returns **501**
and the UI shows it as "Connect (coming soon)", never connected.

## Sync

`accounting/sync.ts:runLedgerSync(admin, {ledgerId, workspaceId, trigger,
attempt?})` mirrors `runWorkbookSync`:

1. Insert a `running` `integration_sync_run` (`connected_ledger_id` set).
2. Build the full export dataset (`buildExportDataset`, preset `all`).
3. Map each transaction to an `AccountingEntry` via `account_map`; skip the
   unmapped.
4. Load the stored OAuth token; call `adapter.pushEntries`.
5. Dark result (`provider_not_configured` / `provider_push_not_implemented`)
   → **`partial`** run, no retry, ledger → `needs_auth`. A real failure runs
   through `sync-engine.ts:nextAttemptState` (≤ 5 attempts, exp backoff);
   `needs_auth` flips the ledger + destination and notifies the owner.
6. Emits `integration_events` `ledger.synced` / `ledger.sync_failed`.

Triggers: `syncLedgerNow` action (manual), and `run-integration-syncs` cron
(retries due `queued` ledger runs — P3-PR7). Not scheduler-wired.

## Gating

`INTEGRATIONS_ACCOUNTING_CONNECTORS_ENABLED` (**off** unless exactly `"true"`;
requires `INTEGRATIONS_SYNC_ENABLED`). `gate.ts:isAccountingConnectorsEnabled`.

## Operational health

`get_operational_health_snapshot`'s `integrations` block →
`ledger_syncs_failed` (window), `ledgers_needing_auth`. Identifier-free.
