# Connector model cutover runbook (ADR 0007 Stage D → E)

The canonical connector model (`connector_installations` / `financial_sources`
/ `accounts` / `device_credentials`) is built and dual-writing behind
`ingestion_connections` (ADR 0007 Stages A–D, migrations `20261011`–`20261023`).
Authentication and routing are still authoritative in the legacy aggregate;
Stage C verifies the equivalent canonical route on every request and **fails
closed on drift**.

This runbook is the sequence to finish the cutover **when a representative
production observation window is clean** — not before. Each step is
independently reversible until Stage E.

## 0. Preconditions (do not start until all true)

| Gate | Where to check |
| --- | --- |
| Every active `ingestion_connections` row has a Stage B backfill mapping (installation id + credential id on the legacy row) | `get_connector_canonical_read_cutover_status()` → `blocking_count = 0` |
| Zero unexplained Stage C shadow mismatches across ≥ 1 representative window (all active connections seen, every lifecycle op — pause/resume/rotate/revoke — exercised) | `20261014` shadow-health counters; `mtn_momo` canary panel `ready_for_broader_rollout = true` |
| Adapter route (`mtn_momo_sms_v1`) observed with `mismatch_count = 0`, `resolver_error_count = 0`, `envelope_error_count = 0` over the window | `20261019` adapter route health |
| `get_connector_canonical_read_cutover_status()` → `ready = true` for a representative sample of real users | the RPC |
| Rollback verified in staging: flip each flag back, confirm legacy path resumes with no data loss | staging |

## 1. Stage D.1 — adapter route on (ingestion)

- Set the Edge Function secret `ONELEDGER_MTN_MOMO_ADAPTER=enabled`.
- Effect: `ingest-momo` routes through `_shared/connector-adapter.ts` +
  `ingest-momo/adapter.ts`. Legacy `ingestion_connections` auth/routing is
  still verified in shadow; a drift still rejects the event.
- Watch for 48–72h: adapter route health counters stay clean; ingestion
  success rate and duplicate rate unchanged in `operational-health`.
- **Rollback:** unset the secret. Instant; no data migration.

## 2. Stage D.2 — canonical credential resolver (auth)

- Enable the default-off Stage D canonical credential resolver
  (`20261017` — `resolve_canonical_ingestion_credential` becomes the
  primary path; legacy hash lookup becomes the shadow).
- Effect: `/capture` and `ingest-momo` authenticate against
  `device_credentials`; legacy `ingestion_connections.credential_hash` is
  the fallback/shadow.
- Watch: zero `INVALID_DEVICE_CREDENTIAL` regressions; `last_used_at`
  advancing on the canonical rows for every active device.
- **Rollback:** disable the resolver flag; legacy hash lookup resumes.

## 3. Stage D.3 — canonical reads (UI)

- Set `ONELEDGER_CANONICAL_CONNECTIONS_UI=enabled` (server-only).
- The per-user readiness gate (`get_connector_canonical_read_cutover_status`)
  still falls back to the legacy projection for any user whose canonical
  mapping is missing or unreadable — so this is safe to flip globally and
  let individual users cut over as their mapping verifies.
- `/integrations/connections` renders `ConnectorInstallationItem`
  (Installation → Source → Account(s) → Device credential(s)) with the
  canonical 7-state status; `/settings/connections` follows.
- Lifecycle (pause/resume/rename/rotate/revoke) already routes through the
  owner-scoped canonical RPCs that maintain Stage C compatibility rows.
- **Rollback:** unset the flag; UI returns to the legacy `ConnectionItem`
  projection. No data change.

## 4. Ingestion convergence (parity before retiring `ingest-momo`)

Before Stage E, the legacy inline pipeline in `ingest-momo/index.ts`
(~1285 lines) and the shared `_shared/ingestion-pipeline.ts` +
`process-raw-events` path must be proven equivalent:

- Parity fixtures: run the same corpus of real (redacted) MTN SMS through
  both paths and diff `{parse, exact-dedupe decision, accounting effect,
  live-account re-check, categorization policy result, transaction-level
  fingerprint state, final result code}`.
- Verify budget-threshold sweep, payment-reconciliation hook, and
  category-history finalization fire identically.
- Only when parity holds for the full corpus: route `ingest-momo` to
  delegate to the shared pipeline, keep the old code path behind a
  kill-switch for one release, then delete it.

## 5. Stage E — retire the legacy aggregate (separate deliberate migration)

**Never combined with the first production cutover** (assessment section 73).
A distinct migration, after Stages D.1–D.3 have been stable in production:

1. Stop creating `ingestion_connections` rows (enrollment writes canonical
   only).
2. Make canonical provenance columns (`raw_financial_events.connector_
   installation_id`, `device_credential_id`) `NOT NULL` for automated
   channels.
3. Drop the Stage C compatibility mirroring from the canonical lifecycle
   RPCs.
4. In a **later** migration still: drop the legacy columns / table once no
   read path references them and a full backup window has passed.

## Telemetry to keep watching throughout

`operational-health` ingestion domain (failure rate, duplicate rate,
processing lag), adapter route health, shadow-health mismatch counters,
`INVALID_DEVICE_CREDENTIAL` rate, and the per-user cutover-readiness
distribution.

## Rollback summary

| Step | Rollback | Data impact |
| --- | --- | --- |
| D.1 adapter route | unset `ONELEDGER_MTN_MOMO_ADAPTER` | none |
| D.2 canonical auth | disable resolver flag | none |
| D.3 canonical UI | unset `ONELEDGER_CANONICAL_CONNECTIONS_UI` | none |
| Stage E | not reversible in place — restore from backup | destructive; do not attempt without a verified backup |
