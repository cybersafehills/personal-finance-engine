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

> **Device pairing v2 (ADR 0008, `docs/device-pairing.md`).** This
> key-in-a-header contract is the legacy path. A newer `capture` Edge
> Function lets a device exchange a one-time pairing token for its own
> scoped credential (no user-visible key), behind
> `DEVICE_PAIRING_V2=enabled`. It is additive and does not change anything
> below; existing `x-ingest-key` connections keep working unchanged.

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
authentication and routing. Stage D includes a server-side, exact-match
`ONELEDGER_CANONICAL_INGESTION=enabled` cutover toggle. It is off when absent or
set to any other value. When enabled, the credential authenticates against the
canonical device-credential resolver first, but the mapped legacy route is
still compared and maintained for immediate rollback. Missing or divergent
state fails closed; logs contain a redacted mismatch code, never credential
material. Accepted raw events retain both the legacy connection ID and the
canonical source, installation, and device-credential IDs.

For a reversible installation-by-installation cutover, the separate exact-match
`ONELEDGER_INSTALLATION_INGESTION_ROLLOUTS=enabled` runtime gate switches the
credential lookup to `resolve_ingestion_credential_rollout`. Its service-only
`connector_ingestion_rollouts` table defaults every absent installation to
`legacy` and selects `canonical` only for an explicit row. The global gate is
off by default, the table begins empty, and the canonical shadow comparison
still runs after authentication, so deploying this control plane changes no
live route on its own.

Every comparison also updates `connector_shadow_health` with aggregate match,
mismatch, and resolver-error counters. This service-role-only operational table
contains no SMS payloads or credentials. Telemetry writes are best-effort and
never change whether ingestion accepts or rejects a request.

The first provider-neutral runtime adapter is also default-off. Setting the
Edge Function secret `ONELEDGER_MTN_MOMO_ADAPTER=enabled` opens only the coarse
provider gate. Routing activates only when the exact canonical installation is
also enabled in `connector_adapter_canaries` and its `connector_key` is
`mtn_momo_sms_v1`. The server
then wraps the existing request in a versioned event envelope and resolves the
credential/source/account through `resolve_connector_event_route` before any
SMS evidence is written. The result must exactly match the existing canonical
shadow route or the request fails closed with `409 routing_mismatch`.

Account-scoped device credentials, including every current production
connection, do not need new request fields. A future unscoped MTN forwarding
agent may send `source_ref` plus `account_ref`; both are hashed in memory using
the same domain-separated discovery contract and are never persisted in raw
form. `account_ref` without `source_ref` is rejected as an invalid envelope.
Each enabled adapter check also updates the service-only
`connector_adapter_route_health` aggregate with a match, mismatch, resolver
error, or envelope error. It stores no SMS payload, raw reference, account ID,
or credential material and is best-effort, so telemetry cannot change routing.

The installation allowlist begins empty. Settings → Connections offers the
platform admin who owns the controlled installation an MFA-gated MTN pairing
form. The MSISDN is normalized and domain-separated
hashed in the application server; only source/account hashes and a four-digit
display mask reach the database. The pairing transaction updates the existing
source/account identity, verifies the resolved route against the legacy-backed
canonical mapping, and only then enables that installation. It never inserts a
second source or account. A canary is ready for broader rollout only after five
post-enable matches and zero mismatch, resolver-error, or envelope-error
observations. Pause the canary from the same screen for immediate rollback;
paired identity remains intact.

Before the Stage D read cutover, operators must verify a representative window
with at least one successful canonical match for every active connection and no
unexplained mismatches or resolver errors:

```sql
select
  right(ic.id::text, 8) as connection_suffix,
  ic.status,
  h.observation_count,
  h.match_count,
  h.mismatch_count,
  h.resolver_error_count,
  h.last_mismatch_code,
  h.last_observed_at
from public.ingestion_connections ic
left join public.connector_shadow_health h
  on h.ingestion_connection_id = ic.id
where ic.status = 'active'
order by h.last_observed_at desc nulls last;
```

The cutover is blocked if any active connection has no observation, no match,
or a nonzero unexplained mismatch/error count. Pause/resume, credential
rotation, and revocation must also be exercised once against canonical shadow
routing during the observation window.

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
  "received_at": "<ISO-8601 timestamp>",
  "source_ref": "<optional provider-stable source reference>",
  "account_ref": "<optional source-scoped account reference>"
}
```

| Field | Required | Notes |
|---|---|---|
| `message` | yes | Raw SMS text. Trimmed. Must be non-empty, ≤ 5000 chars, and contain an `RWF` amount. |
| `received_at` | no | ISO-8601 string. Stored as `device_received_at`. Anything non-string is ignored. |
| `source_ref` | no | Used only by the default-off MTN adapter route. Required when `account_ref` is present; hashed before the resolver call and never stored raw. |
| `account_ref` | no | Used only for an unscoped multi-account credential. Must be paired with `source_ref`; ignored by the legacy path while the adapter flag is off. |

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
| 400 | `invalid_route_envelope` | The enabled provider adapter rejected malformed or incomplete route discriminators. |
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
