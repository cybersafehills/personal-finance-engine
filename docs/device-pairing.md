# Device pairing v2 — protocol & capture contract

The reference for the one-time pairing handshake and the `capture` Edge
Function. ADR 0008 has the rationale; the migration
`supabase/migrations/20261104000000_device_pairing_v2.sql`, the function
`supabase/functions/capture/`, and the shared module
`supabase/functions/_shared/pairing.ts` are the source of truth for behaviour.

Status: **PR1 backend + PR2 wizard.** Dark unless `DEVICE_PAIRING_V2=enabled`.
`ingest-momo` and the legacy `x-ingest-key` path are unchanged.

## Roles

| Actor | Does |
|---|---|
| Web app (authenticated workspace owner) | `create_device_pairing_session(...)` → gets a one-time **pairing token**, shows it once (as text and/or a QR) |
| Device (iPhone Shortcut, later a native app) | generates its own **device secret** (`pfe_…`), calls `POST …/capture` with `op:"pair"` |
| `capture` Edge Function (service role) | hashes both inputs, calls `consume_device_pairing_session(...)`, returns `device_id` + `capture_url` |
| Cleanup cron | `POST /api/cron/expire-pairing-sessions` → `expire_stale_pairing_sessions()` |

## Sequence

```
web: create_device_pairing_session(connector_key, provider, workspace,
        label, sha256(token), token_prefix, intended_account_id?, installation_id?)
     └─► pairing_sessions row (status=pending, expires_at = now + 10 min)
     └─► connector_pairing_events(device_pairing_started)
web: show `token` once (text + QR)

device: generate device_secret = "pfe_" + 20+ url-safe chars
device: POST <capture_url or Supabase fn URL>/capture
        { "op":"pair", "pairing_token":"olp_…", "device_secret":"pfe_…",
          "client_version":"1.0.0", "platform":"ios", "device_label":"My iPhone" }

capture: sha256(token), sha256(secret); consume_device_pairing_session(...)
         ├─ new installation  → _enroll_ingestion_connection(...)  (legacy + canonical)
         └─ existing install  → insert device_credentials directly
         └─► pairing_sessions.status = consumed
         └─► connector_pairing_events(device_paired)
capture → 200 { "ok":true, "device_id":"<uuid>", "capture_url":"https://…/capture" }

device: store device_secret + capture_url in Shortcut-local storage
```

## Web wizard — `/integrations/connections/pair`

Mobile-first. Runs entirely on the iPhone (Safari → Shortcuts → back to Safari);
a desktop can drive it too but is never required. Gated by
`devicePairingV2Enabled(process.env.DEVICE_PAIRING_V2)` — off ⇒ the route
`redirect`s to `/integrations/connections`, and that page's "Connect iPhone" CTA is
hidden (the manual `CreateConnectionForm` stays visible as before). On ⇒ the
manual form moves under an "Advanced — manual setup" `<details>`.

Steps (`web/components/PairWizard.tsx`):

1. **Account** — which `accounts` row this phone feeds.
2. **Install** — the OneLedger Capture Shortcut (`web/lib/capture-shortcut-guide.ts`,
   rendered by the reused `ShortcutGuide`; "Get the ready-made Shortcut" button
   when `NEXT_PUBLIC_MOMO_SHORTCUT_URL` is set).
3. **Pair** — `startDevicePairing(accountId)` server action →
   `requireMfaForSensitiveAction` → `generatePairingToken()` /
   `hashPairingToken()` → `create_device_pairing_session`. Shows the `olp_` code
   big + copyable, and an **Open OneLedger Capture** link
   (`deviceCaptureShortcutRunUrl(token)` = `shortcuts://run-shortcut?name=OneLedger%20Capture&input=text&text=<token>`).
   The wizard polls `getDevicePairingStatus(sessionId)` every 3 s and advances
   itself on `consumed` — **no return URL from the Shortcut is needed**, however
   the token reached the device. Past `expires_at` / `status="expired"` ⇒ "Get a
   new code".
4. **Automate** — the Apple-required Messages automation (static guidance;
   `MOMO_SMS_SENDER` fills the sender when set).
5. **Verify** — reuses `<ConnectionReadinessProbe credentialId={…} />`, which
   polls `probeConnectorCredentialReadiness` and flips on `last_used_at` (set by
   `op:"test"` or a real captured message). No synthetic send.

The wizard never generates or displays the device secret — that is created by
the Shortcut at `op:"pair"` time.

## `POST /capture`

`verify_jwt = false`. `POST` only. `404` unless `DEVICE_PAIRING_V2=enabled`.

### `op:"pair"`

Request body:

| Field | Rule |
|---|---|
| `op` | `"pair"` |
| `pairing_token` | `^olp_[A-Za-z0-9]{4}[A-Za-z0-9_-]{16,}$` |
| `device_secret` | `^pfe_[A-Za-z0-9_-]{20,}$` — generated on the device, never sent back |
| `client_version` | `^\d+\.\d+\.\d+$` |
| `platform` | `ios` \| `ipados` \| `android` \| `macos` \| `other` (anything else → `other`) |
| `device_label` | optional, ≤ 120 chars; defaults to the session label |

Success `200`: `{ "ok": true, "device_id": "<device_credentials.id>", "capture_url": "<stable base>/capture" }`

### `op:"test"`

Header `x-device-key: pfe_…`. Body: the universal envelope (below), `message`
optional. Proves the credential authenticates and the endpoint is reachable.
Bumps `device_credentials.last_used_at`, records `device_test_succeeded`.
**Never** creates a transaction or `raw_financial_events` row. `200 { "ok": true, "test": true }`.

## Universal capture envelope

Validated by `validateCaptureEnvelope` in `_shared/pairing.ts`. Unknown
top-level keys are rejected.

| Field | Rule |
|---|---|
| `message` | string, 1–2000 chars after trim (required for real capture, optional for `test`) |
| `received_at` | ISO-8601; within `[now − 30 days, now + 1 day]`; defaults to server now |
| `client_version` | `^\d+\.\d+\.\d+$` |
| `metadata` | object, ≤ 1024 bytes serialized; `metadata.test === true` marks a test |

## Error codes → HTTP

| Code | HTTP | Meaning |
|---|---|---|
| `PAIRING_INVALID` | 400 | token missing / malformed / unknown |
| `PAIRING_BAD_CREDENTIAL` | 400 | device secret missing / malformed |
| `PAIRING_NO_ROUTE` | 400 | new installation with no `intended_account_id` |
| `PAIRING_ALREADY_USED` | 409 | token already consumed |
| `PAIRING_EXPIRED` | 410 | token past its 10-minute TTL (or already swept) |
| `INVALID_DEVICE_CREDENTIAL` | 401 | `op:"test"` — unknown / inactive / revoked credential (uniform, no oracle) |
| `INVALID_CAPTURE_PAYLOAD` | 400 | envelope failed validation |
| `RATE_LIMITED` | 429 | per-isolate limiter (`Retry-After` header set) |

## Rate limits (per Edge isolate, coarse)

| Op | Window | Max |
|---|---|---|
| `pair` (keyed by client IP) | 60 s | 10 |
| `test` (keyed by device-secret prefix) | 60 s | 30 |

## Audit — `connector_pairing_events`

Service-role-only, RLS on, no authenticated policy. Rows carry only IDs and a
machine `reason_code` — never tokens, secrets, message bodies, amounts, phone
numbers or workspace payloads. Events: `device_pairing_started`,
`device_paired`, `device_pairing_failed`, `device_test_succeeded`,
`device_test_failed`, `capture_rejected`.

## Flags / config

| Name | Where | Effect |
|---|---|---|
| `DEVICE_PAIRING_V2` | Edge Function secret **and** web env | exact `enabled` → the `/capture` endpoint is live *and* the web wizard + "Connect iPhone" CTA appear; otherwise 404 / route redirects |
| `ONELEDGER_CAPTURE_BASE_URL` | Edge Function secret | stable base (e.g. `https://api.oneledger.me/v1`) reported to devices as `capture_url`; falls back to the Supabase Functions URL |
| `REPORT_CRON_SECRET` | web env | gates `POST /api/cron/expire-pairing-sessions` (`x-report-cron-secret`) |

## Provisioning `api.oneledger.me` (operator task)

1. Add `api.oneledger.me` to the Vercel project (or as a Supabase custom
   domain).
2. Rewrite `/v1/:path*` → `https://<project-ref>.supabase.co/functions/v1/:path*`
   (Vercel `rewrites`, or the Supabase custom-domain equivalent).
3. Set the Edge secret `ONELEDGER_CAPTURE_BASE_URL=https://api.oneledger.me/v1`.
4. No device needs reconfiguring — paired devices already stored whatever
   `capture_url` they were handed; new pairs get the new base.
