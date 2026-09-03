# ADR 0009: Asynchronous capture ingestion & provider detection

- **Status:** Accepted for staged implementation (PR1: `op:"capture"` writer +
  provider registry)
- **Date:** 2026-09-03
- **Builds on:** ADR 0008 (consumer device pairing), ADR 0007 (connector model).
  ADR 0003 (SMS reconciliation & ledger integrity) invariants still hold.
- **Context:** A paired device (ADR 0008) can `pair` and `test` but cannot yet
  send a real transaction message over `/capture`. The parse→dedupe→transaction
  pipeline lives inline in `supabase/functions/ingest-momo/index.ts` (~1285
  lines) — the most safety‑critical function in the repo.

## Decision

### 1. `op:"capture"` is a thin, evidence‑first writer

`op:"capture"` authenticates the device credential, validates the universal
envelope, detects the provider, and writes **one** canonical
`raw_financial_events` row (`parse_status='pending'`,
`ingestion_origin='iphone_capture_v2'`, `provider_key`, full canonical
provenance) — then returns `202 { status: "queued" }`. It **never** creates a
`transactions` row.

Rationale (brief §64, §7): the capture endpoint must be lightweight, and raw
evidence must be preserved regardless of whether normalization succeeds. An
unrecognised message (`detectProvider` → null) is turned away with `422
UNKNOWN_PROVIDER` and **no** evidence written — same posture as
`ingest-momo`'s `not_rwf_message`.

Dedup is the existing `(ingestion_connection_id, payload_hash)` unique index
(`20261009000000_tenant_scoped_ingestion_dedup.sql`), on the same
normalized‑message SHA‑256 `ingest-momo` uses — so a message that reaches
OneLedger through both the legacy Shortcut and a paired device collapses to one
evidence row. A conflict → `200 { status: "duplicate" }`.

### 2. A separate processor normalizes pending capture rows

**Implemented** (`supabase/functions/process-raw-events`,
`docs/ingestion-pipeline.md`). Turning `pending` `raw_financial_events` into
`transactions` (parse, accounting effect, account re‑check, categorization,
transaction‑level dedupe, budget sweep) runs as a scheduled Edge Function that
claims a batch (`claim_pending_capture_events`, `FOR UPDATE SKIP LOCKED`),
synthesizes a `momo_messages` row per pending row, and calls
`_shared/ingestion-pipeline.ts` `normalizeInboundMessage(...)`.

`_shared/ingestion-pipeline.ts` is a new, fully fake‑tested dependency‑injected
module. **`ingest-momo/index.ts` keeps its own inline copy of this logic** —
migrating it onto the shared module is a later PR, once the module is proven on
the (dark, low‑volume) capture channel. Until then the two implementations are
kept in step by hand; the shared module + its tests are the reference. This
inverts the risk: the new path gets the new tested code; the proven live path is
untouched.

Gated by `DEVICE_PAIRING_V2=enabled` **and** a `RAW_EVENTS_PROCESSOR_SECRET`
(`X-Processor-Secret` header). Dark otherwise.

### 3. Provider detection is a registry, not a hard‑coded parser

`supabase/functions/_shared/providers.ts` — `detectProvider(message)` walks
`PROVIDER_MATCHERS`; each entry is `{ providerKey, connectorKey, channel,
detect(message) }`. Adding Airtel / a bank SMS = append one matcher. The
matcher's `detect` is deliberately permissive ("plausibly this provider's
financial SMS"): a genuine‑but‑unparseable message still becomes preserved
evidence, and the processor's provider‑specific parser makes the final
"parseable vs review" call. Unrelated SMS (OTP, marketing, airtime receipts)
are turned away without writing evidence.

MTN Rwanda MoMo is the only registered matcher: an `RWF` amount plus an
MTN‑specific token (`Y'ello`, `MobileMoney`, `TxId:`, `FT Id:`, `*RW#`/`*EN#`,
`Dial *1…`) or a MoMo transaction verb (`payment of … RWF`, `… RWF transferred
to`, `You have received … RWF`, `A transaction of … RWF`, `transaction with
amount … RWF`).

## Consequences

- `capture` gains one operation and two nullable `raw_financial_events` columns;
  `ingest-momo` is untouched.
- Between this PR and the processor PR, captured messages accumulate as
  `pending` evidence with nothing consuming them — acceptable while the feature
  is dark; visible via the `idx_raw_events_pending_capture` index.
- The processor becomes the single place provider parsing, accounting, and
  categorization happen for the capture channel — and, after migration, for the
  legacy channel too.

## Rejected alternatives

- **Extract & share the pipeline synchronously now.** One implementation, no
  latency — but a behaviour‑preserving refactor of the live money path in the
  same PR as a new endpoint is unnecessary blast radius.
- **Re‑implement the orchestration inside `capture/`.** ~300 lines of DB
  orchestration duplicated from `ingest-momo`, guaranteed to drift.
- **Have `op:"capture"` forward to `ingest-momo`.** `ingest-momo` authenticates
  with the plaintext `x-ingest-key`, which `capture` never holds.
