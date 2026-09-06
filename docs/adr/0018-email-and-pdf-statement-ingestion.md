# ADR 0018: Email and PDF statement ingestion

- **Status:** Accepted (design). **Not yet implemented** — this ADR records
  the plan and the seams so a future session ships it in bounded slices.
- **Date:** 2026-09-06
- **Closes (design):** audit gap **G10**, master prompt §5 / §14 / §87.
- **Related:** ADR 0007 (provider-neutral connector model), ADR 0009 (async
  capture), the raw-events processor (`20261106`), statement import
  (`20260925` + `/settings/sources/import`), the Bills extraction pipeline
  (`web/lib/bills/extraction/`).

## Context

A Connection today is one of: device capture (iPhone Shortcut / Android
companion → `/capture`), or a manual CSV/Excel statement upload
(`import_statement_transactions`). The master prompt wants two more
first-class sources — **email** (forward or auto-receive statement /
transaction mails) and **PDF statements** — surfaced in the same
"How should transactions get in?" step as device pairing.

## Seams that already exist (no migration needed for either)

- **`raw_financial_events.channel`** already permits `'email'`,
  `'statement'`, `'receipt'` (Phase Q, `20260910`). Both features write
  here; the `process-raw-events` worker already drains it into
  transactions via `_shared/ingestion-pipeline.ts`.
- **`import_statement_transactions(p_financial_source_id, p_rows jsonb)`**
  (`20260925`) is the row-writer for any statement source: it fingerprints,
  dedupes against the ledger, and writes `source='statement'` transactions.
  PDF and email statement rows feed the *same* RPC.
- **`web/lib/statement-import.ts`** — the pure normalizers
  (`parseAmount` / `parseStatementDate` / `normalizeStatementRow` /
  `guessMapping`) are format-agnostic once you have `string[][]` rows.
- **`web/lib/bills/extraction/`** — a working PDF→structured-fields
  pipeline behind `AI_PROVIDER` (+ `AI_PROVIDER=mock` for tests). Its
  text-layer + table heuristics are reusable for statements; only the
  target schema differs (transaction rows, not invoice header fields).
- **`connector_installations` / `financial_sources`** — the ADR 0007 model
  already represents a non-device source; an email or PDF source is a
  `financial_sources` row with `provider` + a new `source_type`
  (`'email_statement'` / `'pdf_statement'`), no schema change.

## Decision — two slices

### Slice A — PDF statement import (ship first; lower risk)

1. `/settings/sources/import` accepts a `.pdf` alongside CSV/Excel.
2. A server action runs the Bills extractor's text/table layer over the
   PDF → `string[][]` candidate rows (best-effort; the existing
   column-mapping + live-preview UI lets the user fix the mapping, and CSV
   stays the fallback when a layout defeats extraction).
3. Confirmed rows → `import_statement_transactions` (unchanged).
4. Flag `PDF_STATEMENT_IMPORT_ENABLED` (needs `AI_PROVIDER`). No new
   table, no new RPC, no new channel value.
5. Tests: extractor unit tests with `AI_PROVIDER=mock` fixtures for 2–3
   real bank layouts; an e2e that uploads a fixture PDF and reaches the
   result screen.

### Slice B — email statement ingestion (ship second)

1. A per-user **ingest address** (`u+<opaque-token>@in.oneledger.me`),
   stored on `financial_sources` (new nullable `ingest_email_token`,
   unique) — one small migration.
2. An inbound-mail webhook — **decision required**: Resend Inbound vs a
   Cloudflare Email Worker vs SES. It authenticates the provider
   signature, resolves the token → `financial_source`, extracts the body
   / attachment (reusing Slice A's extractor for PDF attachments, a text
   parser for plain-text bank alerts), and writes one
   `raw_financial_events` row per detected transaction
   (`channel='email'`, `ingestion_origin='email_v1'`,
   `parse_status='pending'`). The existing worker takes it from there.
3. Security review: the endpoint is unauthenticated by nature — rate-limit
   per token, verify the provider signature, never trust `From:`, cap
   attachment size, quarantine on parse failure (no silent drops).
4. Flag `EMAIL_STATEMENT_INGEST_ENABLED`. UI: show the ingest address +
   "how to forward" on the source's Connections tab.
5. Tests: signature-verification + token-resolution + one-mail→one-raw-
   event fixtures; a migration test for the token column + uniqueness.

## Consequences

- Neither slice needs the connector cutover or touches device pairing.
- Slice A is a contained follow-up (extractor + one flag). Slice B carries
  a genuine external dependency (inbound-mail provider) and a security
  review, so it is explicitly its own PR with its own sign-off.
- Until shipped, the onboarding "connect a source" step continues to offer
  device pairing + CSV/Excel import + manual entry, and does **not**
  advertise email/PDF (master prompt §14: never show a method that isn't
  actually supported).
