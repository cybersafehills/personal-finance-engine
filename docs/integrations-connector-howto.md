# Adding a connector

Phase 1 ships one real ingestion connector (MTN MoMo SMS, ADR 0007) and
the file-import path. This note is the checklist for the next one, so a
new provider is an addition, not a redesign.

For the code-level `ConnectorAdapter` contract and a complete, deno-tested
reference implementation to copy, see
[`integrations-connector-sdk.md`](integrations-connector-sdk.md).

## What a connector is not

- Not a new transaction model. Everything normalises into the canonical
  `transactions` shape via `raw_financial_events` (see
  `integrations-import-export-lifecycle.md`).
- Not provider logic in business services. It lives behind the adapter
  boundary in `supabase/functions/_shared/connector-adapter.ts` and the
  canonical connector tables (`connector_installations`,
  `financial_sources`, `device_credentials`).

## Steps

1. **Provider adapter** — implement the capability subset the provider
   supports (`fetchRecords` / `handleWebhook` / `mapRecord` / …) against
   `_shared/connector-adapter.ts`. Declare capabilities; do not stub
   unsupported ones.
2. **Normalisation** — map the provider payload to the canonical event
   shape. Reuse `web/lib/integrations/mapping.ts` primitives
   (`parseAmount`, `parseStatementDate`, direction inference) where the
   data is statement-like.
3. **Dedup** — key raw evidence on a deterministic `payload_hash` that
   includes the `financial_source_id` (tenant-scoped, per the standing
   invariant); let the Space `compute_transaction_fingerprint` match do
   transaction-level dedup and land ambiguity in `/transactions/review`.
4. **Auth config** — pick an `auth_mode` (`device_secret` / `oauth` /
   `api_key` / `mailbox`). Credentials are reveal-once, hashed, scoped,
   rotatable, revocable, audited — never stored in a user-facing table.
5. **Capability + rollout gate** — add an env flag following
   `web/lib/pay/gate.ts` conventions; keep it default-off with an
   allowlist until an observation window passes.
6. **Tests** — fixtures for the provider payload, a two-tenant collision
   test, and a migration-chain assertion for any new table/RLS.
7. **Health + activity** — emit `integration_events` rows
   (`connection.error`, `sync.completed`, …) so `/integrations/activity`
   and `get_operational_health_snapshot` see it. No raw payloads, no
   secrets, no financial values in `context`.

## Outbound adapters (Phase 2)

Delivery *out* of OneLedger uses a separate, parallel set of contracts —
the inbound `connector-adapter.ts` is not involved:

- **Cloud storage** — `destinations/cloud-storage/contract.ts`
  (`CloudStorageClient`: `authUrl` / `exchangeCode` / `refresh` /
  `listFolders` / `uploadFile`). `registry.ts` decides configured vs dark
  from the provider's `*_CLIENT_ID` / `*_SECRET`. A dark provider's client
  throws `ProviderNotConfiguredError` from every method; the OAuth routes
  turn that into a 501 and the delivery path records a `partial` run.
- **Spreadsheets** — `workbooks/contract.ts` (`WorkbookAdapter`:
  `getRevision` / `writeAllSheets` / `readAllSheets`). `manual_file` is
  the reference real implementation; `google_sheets` / `excel_365` are
  stubs.
- **Webhook** — no adapter; `destinations/webhook.ts` (signer + SSRF
  guard) + `destinations/deliver.ts`.
- **Accounting** (Phase 3) — `accounting/contract.ts` (`AccountingAdapter`:
  `authUrl` / `exchangeCode` / `refresh` / `listAccounts` / `pushEntries` /
  `getRevision`) + `accounting/registry.ts`. QuickBooks / Xero / Zoho Books
  / Odoo are all **dark**: unconfigured → `provider_not_configured`;
  configured → real OAuth but `pushEntries` throws
  `provider_push_not_implemented`. `accounting/sync.ts:runLedgerSync` maps a
  transaction's category to an external account id via the ledger's
  `account_map`, then calls `pushEntries`; a dark result is a `partial`
  sync run.

Adding a real cloud/spreadsheet/accounting provider = implement its client
against the interface, register the env-var gate, wire the real methods, and
never let it report success it didn't achieve
(`provider_upload_not_implemented` / `provider_push_not_implemented` are the
honest placeholders).

## Where NOT to start

Do not add Airtel / bank API / email / receipt connectors as enums or
half-adapters. Each needs a real adapter, fixtures, monitoring,
onboarding, and production verification before it is a shipped connector
— drive it from a design-partner use case, not a catalogue.
