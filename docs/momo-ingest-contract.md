# MoMo ingestion contract (`ingest-momo`)

The reference for wiring any device — an iPhone Shortcut, an Android
SMS-forwarder, a test script — to a OneLedger **ingestion connection**.
The Edge Function at `supabase/functions/ingest-momo/` is the source of
truth for behaviour; this document and `web/lib/ingest.ts` mirror the
request shape so the Connections screen never drifts from a hand-copied
path.

## Endpoint

```
POST https://<project-ref>.supabase.co/functions/v1/ingest-momo
```

`<project-ref>` is the same host the app's Supabase client uses
(`SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`). The Connections screen
renders the fully-resolved URL per environment; `web/lib/ingest.ts`
→ `buildIngestEndpointUrl()` builds it.

## Authentication — key only, no Supabase JWT

`supabase/config.toml` sets `[functions.ingest-momo] verify_jwt = false`.
The **only** credential is the per-connection ingestion key:

| | |
|---|---|
| Header | `x-ingest-key: pfe_…` |
| Issued by | Settings → Connections → *Connect a device* (shown once), or *Rotate credential* |
| Stored as | SHA-256 hash + 8-char prefix in the legacy connection and canonical device credential, never plaintext |
| Resolves | the connection's `workspace_id` + bound `account_id` — never anything the client sends |

A missing, blank, malformed, **revoked**, **paused**, or simply unknown
key all fail **identically** with `401 unauthorized` — the response is not
an oracle. No `apikey` / `Authorization` header is required or read.

During the Stage C rollout, the legacy connection remains authoritative for
authentication and routing. Before accepting a payload, ingestion resolves the
corresponding connector installation, device credential, financial source, and
account and compares that route with the legacy route. Missing or divergent
canonical state fails closed with `409 routing_mismatch`; logs contain a
redacted mismatch code for operators, not credential material. Accepted raw
events retain both the legacy connection ID and the canonical source,
installation, and device-credential IDs.

> **Deployed-state note.** The linked production function already runs
> with JWT verification off (Shortcuts only ever send `x-ingest-key`).
> The `config.toml` block added in the onboarding work makes that
> reproducible from this repo; it does not change deployed behaviour.
> `supabase functions deploy ingest-momo` will keep it off going forward.

## Request body

`Content-Type: application/json`

```json
{
  "message": "<the full SMS text>",
  "received_at": "<ISO-8601 timestamp>"
}
```

| Field | Required | Notes |
|---|---|---|
| `message` | yes | Raw SMS text. Trimmed. Must be non-empty, ≤ 5000 chars, and contain an `RWF` amount. |
| `received_at` | no | ISO-8601 string. Stored as `device_received_at`. Anything non-string is ignored. |

## Responses

All responses are JSON. `2xx` carries `{ "ok": true, "status": … }`;
errors carry `{ "ok": false, "error": … }`.

| HTTP | `status` / `error` | Meaning |
|---|---|---|
| 200 | `processed` | Parsed into a transaction; visible in the ledger. |
| 200 | `needs_review` | Stored as evidence; format not recognised, so it goes to the review queue — never a guessed transaction. |
| 200 | `duplicate` | This exact SMS (normalised hash) was already ingested through this connection. Nothing added twice. |
| 400 | `invalid_json` | Body was not valid JSON. |
| 400 | `invalid_request_body` | Body was not a JSON object. |
| 400 | `missing_message` | `message` missing or empty after trim. |
| 401 | `unauthorized` | Key missing / wrong / revoked / paused / unknown. |
| 409 | `routing_mismatch` | Canonical connector routing is missing or differs from the authenticated legacy route; nothing recorded. |
| 413 | `message_too_large` | Trimmed `message` exceeded 5000 chars. |
| 422 | `not_rwf_message` | No `RWF` amount found — not treated as a MoMo transaction, nothing recorded. |
| 405 | `method_not_allowed` | Only `POST` is accepted. |
| 500 | `database_error` | Transient server-side failure. Safe to retry (idempotent on the message hash). |

Idempotency: retries of the same SMS through the same connection are safe. A
prior `failed` state is retried; any other prior state returns `duplicate`.
Identical text received through another customer's connection is independent
and cannot suppress their transaction.

## cURL equivalent (testing / Android)

Unofficial — the supported path is the iPhone Shortcut
(`docs/momo-shortcut-setup.md`, added in a later PR).

```bash
curl -sS -X POST "https://<project-ref>.supabase.co/functions/v1/ingest-momo" \
  -H "x-ingest-key: pfe_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{"message":"*165*S*... You have received RWF 5,000 from ...","received_at":"2026-08-28T09:15:00Z"}'
```

Expected: `{"ok":true,"status":"processed"}` (or `"needs_review"` /
`"duplicate"`).
