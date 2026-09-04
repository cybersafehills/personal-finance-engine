# Device pairing v2 — protocol & capture contract

The reference for the one-time pairing handshake and the `capture` Edge
Function. ADR 0008 has the rationale; the migration
`supabase/migrations/20261104000000_device_pairing_v2.sql`, the function
`supabase/functions/capture/`, and the shared module
`supabase/functions/_shared/pairing.ts` are the source of truth for behaviour.

Status: **backend + wizard + QR handoff + `op:"capture"` writer + raw-events
processor.** Dark unless `DEVICE_PAIRING_V2=enabled`. `ingest-momo` and the
legacy `x-ingest-key` path are unchanged. Captured evidence is normalized into
`transactions` by `supabase/functions/process-raw-events` — see
`docs/ingestion-pipeline.md`.

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

Mobile-first. Runs entirely on the phone (Safari/Chrome → the Shortcut or the
Companion app → back to the browser); a desktop can drive it too but is never
required. Gated by `devicePairingV2Enabled(process.env.DEVICE_PAIRING_V2)` —
off ⇒ the route `redirect`s to `/integrations/connections`, and that page's
"Connect a phone" CTA is hidden (the manual `CreateConnectionForm` stays visible
as before). On ⇒ the manual form moves under an "Advanced — manual setup"
`<details>`.

Steps (`web/components/PairWizard.tsx`). Step 1 picks **iPhone** or **Android
phone** (`platform` state, default `ios`); the label of step 4 and the copy /
deep link / install guide of steps 2–5 follow that choice. The `olp_` code, the
poll, and the server actions are identical for both — the pairing protocol is
platform-neutral (ADR 0008 §Consequences).

1. **Account** — phone type + which `accounts` row this phone feeds.
2. **Install** —
   - iOS: one card in `PairWizard` — an "Add the OneLedger Capture Shortcut"
     button when `NEXT_PUBLIC_MOMO_SHORTCUT_URL` is set, otherwise an honest
     "one-tap setup isn't available yet" note pointing at Advanced connection.
     (The Pair / Automate / Verify walkthroughs are the wizard's own later
     steps, not repeated here.)
   - Android: `AndroidCompanionGuide` — install the OneLedger Companion
     (`android/`, ADR 0010); "Get the OneLedger Companion app" when
     `NEXT_PUBLIC_ANDROID_COMPANION_URL` is set.
3. **Pair** — `startDevicePairing(accountId)` server action →
   `requireMfaForSensitiveAction` → `generatePairingToken()` /
   `hashPairingToken()` → `create_device_pairing_session`. Shows the `olp_` code
   big + copyable, plus a deep link:
   - iOS: **Open "Connect to OneLedger"** —
     `devicePairShortcutRunUrl(token)` (`shortcuts://run-shortcut?name=Connect%20to%20OneLedger&input=text&text=<token>`).
     Runs the one-time pairing Shortcut, **not** "OneLedger Capture" (the
     automation forwarder). The name is `%20`-encoded, never `+` — the
     Shortcuts URL scheme treats `+` literally and reports "the file doesn't
     exist".
   - Android: **Open in OneLedger Companion** —
     `androidCompanionPairUrl(token)` (`oneledger://pair?c=<token>`, the
     Companion's manifest intent filter).
   The wizard polls `getDevicePairingStatus(sessionId)` every 3 s and advances
   itself on `consumed` — **no return URL from the device is needed**, however
   the token reached it. Past `expires_at` / `status="expired"` ⇒ "Get a new
   code". On a **fine-pointer** device (a computer) it also renders a QR of
   `pairHandoffUrl(origin, token, platform)` — the Android variant carries
   `&p=android` so the `/pair` handoff offers the Companion, not the Shortcut.
4. **Automate** (iOS) — the Apple-required Messages automation. Sender is left
   blank (MoMo SMS shows a generic network label, not a matchable name);
   **Message Contains: RWF** is the reliable trigger - it's in every real
   MoMo/bank message, and anything else that matches is just ignored
   downstream. `MOMO_SMS_SENDER`, when set, adds an *additional* Sender
   filter on top. **Allow access** (Android) — turn on the
   OS notification-listener permission for the Companion; the app has its own
   CTA button for this, so the step is expectation-setting.
5. **Verify** — reuses `<ConnectionReadinessProbe credentialId={…} />`, which
   polls `probeConnectorCredentialReadiness` and flips on `last_used_at` (set by
   `op:"test"` — the Companion sends one at pair time — or a real captured
   message). No synthetic send.

The wizard never generates or displays the device secret — that is created by
the Shortcut / Companion at `op:"pair"` time.

## Public `/pair` handoff — `web/app/pair/page.tsx`

The cross-device bridge. A phone scans the desktop wizard's QR and lands here
with `?c=<olp_ token>` (and `&p=android` when the wizard was in the Android
branch — `params.p` picks the `PairHandoff` variant; anything but `android`
means iOS).

- **No auth** — added to `PUBLIC_PATHS` in `web/proxy.ts`. The phone never needs
  an OneLedger session; the OneLedger Capture Shortcut (iOS) or the OneLedger
  Companion app (Android) is what redeems the code.
- **Calls no RPC.** It renders the code big + copyable, a deep link
  auto-attempted once on mount — **Run "Connect to OneLedger"**
  (`shortcuts://…`) or **Open in OneLedger Companion** (`oneledger://pair?c=…`) —
  and inline install steps (`web/components/PairHandoff.tsx`).
- Gated by `devicePairingV2Enabled(DEVICE_PAIRING_V2)` → `notFound()` (404) when
  off. `c` is validated against `PAIRING_TOKEN_PATTERN`; missing/invalid renders
  a calm "this link is no longer valid — get a fresh code" state (HTTP 200).
- `export const metadata = { referrer: "no-referrer" }` — the single-use,
  ~10-minute token rides in the URL so it can be scanned; keeping it out of
  `Referer` is the same posture as a magic link. The database still re-checks
  the token on redemption (single use, TTL) — the URL is a transport, not the
  security boundary.

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

### `op:"capture"`  (ADR 0009)

A real inbound transaction message. Header `x-device-key: pfe_…`. Body: the
universal envelope, `message` **required**.

1. Authenticate the device credential (`resolve_canonical_ingestion_credential`)
   → uniform `401 INVALID_DEVICE_CREDENTIAL` on any failure.
2. Validate the envelope → `400 INVALID_CAPTURE_PAYLOAD` + `capture_rejected`.
3. `detectProvider(message)` (`_shared/providers.ts`) → null → `422
   UNKNOWN_PROVIDER` + `capture_rejected`, **no evidence written**.
4. Write **one** `raw_financial_events` row: `channel:'sms'`,
   `parse_status:'pending'`, `ingestion_origin:'iphone_capture_v2'`,
   `provider_key`, canonical provenance (`ingestion_connection_id` =
   `legacy_ingestion_connection_id`, `connector_installation_id`,
   `device_credential_id`, `financial_source_id`). `payload_hash` = the same
   normalized-message SHA-256 `ingest-momo` uses.
   - insert OK → `202 { "ok": true, "status": "queued", "event_id": "…" }` +
     `capture_accepted`.
   - `(ingestion_connection_id, payload_hash)` conflict → `200 { "ok": true,
     "status": "duplicate" }`.
5. **Never** creates a `transactions` row. `supabase/functions/process-raw-events`
   (scheduled, `docs/ingestion-pipeline.md`) claims the `pending` row, synthesizes
   a `momo_messages` row, and runs `_shared/ingestion-pipeline.ts` to produce the
   transaction. `parse_status` moves `pending → processing → normalized |
   superseded | rejected | failed` (transient failures return to `pending`).

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
| `INVALID_DEVICE_CREDENTIAL` | 401 | `op:"test"` / `op:"capture"` — unknown / inactive / revoked credential (uniform, no oracle) |
| `INVALID_CAPTURE_PAYLOAD` | 400 | envelope failed validation |
| `UNKNOWN_PROVIDER` | 422 | `op:"capture"` — `detectProvider` didn't recognise the message; no evidence stored |
| `RATE_LIMITED` | 429 | per-isolate limiter (`Retry-After` header set) |

Success statuses for `op:"capture"`: `202 queued` (new evidence row) · `200 duplicate`.

## Rate limits (per Edge isolate, coarse)

| Op | Window | Max |
|---|---|---|
| `pair` (keyed by client IP) | 60 s | 10 |
| `test` (keyed by device-secret prefix) | 60 s | 30 |
| `capture` (keyed by device-secret prefix) | 60 s | 60 |

## Audit — `connector_pairing_events`

Service-role-only, RLS on, no authenticated policy. Rows carry only IDs and a
machine `reason_code` — never tokens, secrets, message bodies, amounts, phone
numbers or workspace payloads. Events: `device_pairing_started`,
`device_paired`, `device_pairing_failed`, `device_test_succeeded`,
`device_test_failed`, `capture_accepted`, `capture_rejected`.

## Flags / config

| Name | Where | Effect |
|---|---|---|
| `DEVICE_PAIRING_V2` | Edge Function secret **and** web env | exact `enabled` → the `/capture` endpoint is live *and* the web wizard + `/pair` + "Connect iPhone" CTA appear; otherwise 404 / route redirects |
| `ONELEDGER_CAPTURE_BASE_URL` | Edge Function secret | stable base (e.g. `https://api.oneledger.me/v1`) reported to devices as `capture_url`; falls back to the Supabase Functions URL |
| `NEXT_PUBLIC_MOMO_SHORTCUT_URL` | web env | when set, an "Add OneLedger Capture" link on the wizard install step (iOS) **and** the `/pair` handoff page |
| `NEXT_PUBLIC_ANDROID_COMPANION_URL` | web env | when set, a "Get the OneLedger Companion app" link on the wizard install step (Android) **and** the `/pair` handoff page. Optional — the Android guide renders without it |
| `REPORT_CRON_SECRET` | web env | gates `POST /api/cron/expire-pairing-sessions` (`x-report-cron-secret`) |

## Provisioning `api.oneledger.me` (operator task)

1. Add `api.oneledger.me` to the Vercel project (or as a Supabase custom
   domain).
2. Rewrite `/v1/:path*` → `https://<project-ref>.supabase.co/functions/v1/:path*`
   (Vercel `rewrites`, or the Supabase custom-domain equivalent).
3. Set the Edge secret `ONELEDGER_CAPTURE_BASE_URL=https://api.oneledger.me/v1`.
4. No device needs reconfiguring — paired devices already stored whatever
   `capture_url` they were handed; new pairs get the new base.
