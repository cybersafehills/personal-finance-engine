# Operational health and initial SLOs

OneLedger derives operational health from its existing durable state. It does
not copy payloads into another logging product. The service-only
`get_operational_health_snapshot(window_minutes)` RPC returns aggregate counts
and queue ages for ingestion, duplicate review, report jobs, transactional
email, and payment reconciliation. It returns no tenant/customer identifiers,
payloads, credentials, destinations, provider references, or financial values.

`GET /api/admin/operational-health?window_minutes=60` exposes that snapshot to
operators behind the same constant-time `X-Report-Cron-Secret` check as the
existing cron and email-health routes. A critical assessment returns HTTP 503,
making the endpoint suitable for a read-only uptime check.

## Initial objectives

These thresholds are deliberately simple beta SLOs and should be revisited
after four representative weeks:

| Domain | Healthy | Attention | Critical |
| --- | --- | --- | --- |
| Ingestion | failure rate under 1%; no item processing for over 5 minutes | failure rate 1–5% | failure rate at least 5%, or any stale message/raw-event backlog |
| Duplicate review | oldest candidate under 24 hours | 24–72 hours | at least 72 hours |
| Report jobs | due runs/deliveries complete without failures | no scheduled work in the window is reported as `insufficient_data` | any failed delivery/run, or a run overdue by 15 minutes |
| Email | combined failed/skipped rate under 2%; queue under 5 minutes | 2–5% failure or queue age 5–15 minutes | at least 5% failure or queue age at least 15 minutes |
| Reconciliation | oldest review item under 24 hours | 24–72 hours | at least 72 hours |

`insufficient_data` is not treated as proof of health. It is neutral in the
aggregate response so naturally quiet domains do not page an operator, but a
release gate must still require a representative observation window.

Example:

```sh
curl --fail --silent --show-error \
  -H "X-Report-Cron-Secret: $REPORT_CRON_SECRET" \
  "https://www.oneledger.me/api/admin/operational-health?window_minutes=60"
```

## Structured logging convention (audit F10)

The snapshot above is the aggregate, PII-free signal. Line-level logs are for
after-the-fact debugging and for building a scheduler heartbeat. Both sides of
the codebase now share one shape:

- `web/lib/log.ts` — route handlers (`app/api/cron/*`), server actions,
  server-only services.
- `supabase/functions/_shared/log.ts` — Edge Functions.

Each `logEvent(stage, outcome, fields)` call emits **exactly one JSON object
per line**:

```json
{ "ts": "2026-09-05T00:00:00.000Z", "stage": "cron.generate-reports",
  "outcome": "ok", "correlation_id": "…", "duration_ms": 812, "considered": 4 }
```

| Field | Meaning |
| --- | --- |
| `ts` | ISO-8601, always present, set by the logger |
| `stage` | dotted namespace: `cron.<name>`, `ingest.momo`, `capture.pair`, `webhook.deliver`, … |
| `outcome` | `start` \| `ok` \| `skipped` \| `error` \| `retry` |
| `correlation_id` | one id per request / per scheduled tick (`newCorrelationId()`), threaded through every line of that unit of work |
| `request_id` | inbound request id when there is one |
| `duration_ms`, `retry_count` | when meaningful |
| `workspace`, `source`, `adapter` | **opaque surrogates the caller passes** — the logger never resolves tenant data |
| extra fields | any safe scalars (counts, statuses, codes) |

`error` outcomes go to stderr; everything else to stdout, so existing
error-only drains keep working.

### Redaction

Every field passes through `redact()` before it is written. It blanks a value
when **the key name** looks sensitive (`secret`, `token`, `password`,
`credential`, `authorization`, `api_key`, `pin`, `otp`, `raw_message`,
`raw_payload`, …) **or the value itself** is secret-shaped (`olp_…` pairing
tokens, `pfe_…` device secrets, JWTs, long hex blobs). Never pass a raw
provider SMS, a credential, a PIN/OTP, or an auth header to the logger even
under an innocent key — but the redactor is the backstop if someone does.

### Scheduler heartbeat

`withLoggedRun("cron.<name>", …, run)` wraps a tick so it always emits a
`start` then an `ok`/`error` line under one correlation id.
`app/api/cron/generate-reports/route.ts` is the reference adoption. An
operator (or a follow-up `cron_heartbeats` view) reconstructs "did this job
run in the last window?" from the `stage:"cron.*"` stream: a `start` with no
matching `ok`/`error` is a stuck tick; **no `start` at all** for a job's
expected interval is a dead scheduler. Remaining `app/api/cron/*` routes
adopt `withLoggedRun` as they are next touched.

