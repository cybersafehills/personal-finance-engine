# ADR 0018: Email and PDF statement ingestion

- **Status:**
  - **Slice A (PDF import): implemented** behind `PDF_STATEMENT_IMPORT_ENABLED`
    (`web/lib/pdf-statement.ts` + `/settings/sources/import`).
  - **Slice B (email ingestion): implemented** behind
    `EMAIL_STATEMENT_INGEST_ENABLED` (+ `INBOUND_EMAIL_WEBHOOK_SECRET` as an
    Edge Function secret). Provider: **Resend Inbound** (Svix-signed
    webhook). Migration `20261204000000`; Edge Function
    `supabase/functions/inbound-email`; UI panel on
    `/settings/sources/import` (`web/components/EmailIngestPanel.tsx`).
- **Date:** 2026-09-06
- **Closes:** audit gap **G10**, master prompt §5 / §14 / §87.
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

### Slice A — PDF statement import (implemented)

**As built** (simpler than the original sketch — no AI, no server work):

1. `/settings/sources/import` accepts `.pdf` when
   `PDF_STATEMENT_IMPORT_ENABLED` is `"true"`.
2. **The browser** runs `pdf.js` (`pdfjs-dist`, loaded on demand) to read
   the text layer; `web/lib/pdf-statement.ts` (pure, deno-tested) turns
   positioned text items into visual lines, keeps lines carrying both a
   date and a money amount, and splits each into
   `[Date, Description, Amount]` — the same `string[][]` the CSV
   column-mapping + live-preview UI already consumes. A second trailing
   amount (running balance) is ignored.
3. Confirmed rows → `import_statement_transactions` (**unchanged**).
4. No new table, no new RPC, no new `channel` value, no AI provider.
   Scanned-image PDFs are unsupported (no OCR) — CSV stays the fallback,
   and an empty extraction tells the user to use CSV.
5. Tests: `web/lib/pdf_statement_test.ts` (line reconstruction, amount
   detection, row splitting). No e2e — driving `pdf.js` in the flaky CI
   browser isn't worth it; the pure logic is covered.

Rejected: the Bills AI extractor. It is invoice-shaped, needs
`AI_PROVIDER` + a key, and costs per import; a text-layer heuristic covers
the common case for free.

### Slice B — email statement ingestion (implemented)

**As built** (Resend Inbound; simpler than the original sketch — it reuses
the statement-import RPC directly instead of the raw-events queue):

1. A per-**source** ingest address `u+<token>@<domain>` (default domain
   `in.oneledger.me`). `financial_sources.ingest_email_token` (nullable,
   unique) + four owner-gated RPCs —
   `set_/rotate_/clear_source_ingest_email` (authenticated) and
   `resolve_ingest_email_source` (service-role) — in migration
   `20261204000000`. The token is a 32-hex `gen_random_uuid()` with no
   dashes.
2. **Provider: Resend Inbound.** The webhook (`inbound-email` Edge
   Function) verifies the **Svix** signature against
   `INBOUND_EMAIL_WEBHOOK_SECRET`, rejects a timestamp outside ±5 min,
   pulls the token from the *recipient* (never `From:`), resolves it to a
   source, turns CSV/TSV attachments (column-guessed, ≤5 MB each) and the
   plain-text body (`<date> … <amount>` lines) into normalized rows, and
   imports them.
3. **Import path:** `import_statement_transactions`'s body was extracted
   into a service-role core `_import_statement_rows(source, rows,
   actor?)`; the webhook calls it via
   `import_statement_rows_for_source` with a **null actor**. The
   authenticated `import_statement_transactions` is now a thin
   `auth.uid()` + `owns_financial_source` check over the same core — the
   manual CSV flow is byte-for-byte unchanged. Per-line de-dupe
   (`raw_financial_events.payload_hash`) and ledger-fingerprint matching
   (`possible_duplicate`) are inherited for free; a forwarded statement
   already in OneLedger imports nothing.
4. **Parsing that stays on the web:** PDF attachments are **not** parsed
   in the Edge Function (pdf.js is unreliable outside a browser) — the
   panel tells senders to use the web PDF import for those.
5. Flag `EMAIL_STATEMENT_INGEST_ENABLED` (web panel) + the same flag and
   `INBOUND_EMAIL_WEBHOOK_SECRET` as Edge Function secrets; a missing
   config is a clean HTTP 200 no-op so a half-configured webhook never
   wedges Resend's retry queue. UI: an "Email statements in" panel on
   `/settings/sources/import` with generate / rotate / disable + the
   address.
6. Tests: `supabase/functions/inbound-email/tests/lib_test.ts` (Svix
   round-trip, timestamp window, recipient-token extraction, Resend
   payload normalization, CSV/body row extraction, oversize guard);
   `supabase/functions/_shared/tests/statement_parse_test.ts` (the ported
   pure parsers); migration tests for the token lifecycle + owner-gating +
   the service-role core writing with no `auth.uid()`.

Deferred (not blockers for dark ship): a dedicated per-token rate limit
(today: Resend's own inbound throttle + the signature gate + the
32-hex-token search space), and a quarantine table for parse failures
(today: a `no_rows` / `no_source` response is logged with counts only,
nothing is dropped silently because nothing was ever queued).

## Consequences

- Neither slice needs the connector cutover or touches device pairing.
- Slice A is a contained follow-up (extractor + one flag). Slice B adds one
  external dependency (Resend Inbound + its Svix signing secret) and one
  Edge Function; its migration refactors `import_statement_transactions`
  into a shared core without changing the manual-upload behaviour.
- Both flags are dark by default. Until they are turned on, the onboarding
  "connect a source" step keeps offering device pairing + CSV/Excel import
  + manual entry only, and does **not** advertise email/PDF (master prompt
  §14: never show a method that isn't actually supported). Turning
  `EMAIL_STATEMENT_INGEST_ENABLED` on also requires the Resend Inbound MX
  records for the domain and the webhook secret to be live.
