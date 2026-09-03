# Android Companion — protocol & privacy reference

The reference for how the OneLedger Android Companion talks to the `/capture`
endpoint and what it does — and does not — do with a phone's notifications.
ADR 0010 has the rationale; the app under `android/` and the endpoint contract
in `docs/device-pairing.md` are the source of truth for behaviour.

Status: **app scaffold + pairing + notification capture + offline queue +
health (PR1).** Rides the existing `DEVICE_PAIRING_V2` flag. No server code,
Edge Function, or migration changed — the capture protocol was already
platform-neutral (ADR 0008 §Consequences).

## Roles

| Actor | Does |
|---|---|
| Web app (authenticated workspace owner) | `create_device_pairing_session(...)` → one-time `olp_…` code, shown as text / QR / `oneledger://pair?c=…` deep link |
| Android companion | generates its own `pfe_…` device secret, `POST …/capture {op:"pair", platform:"android"}`, stores secret + `capture_url` in `EncryptedSharedPreferences` |
| `NotificationListenerService` | inspects each notification, keeps only provider-matched text, enqueues it |
| `CaptureUploadWorker` (WorkManager) | drains the bounded queue → `POST …/capture {op:"capture"}` |
| `capture` Edge Function | unchanged — authenticates the credential, writes one `raw_financial_events` row (`ingestion_origin='iphone_capture_v2'`), returns `202 queued` / `200 duplicate` |

`ingestion_origin` stays `iphone_capture_v2` for now: the column records the
*channel contract*, not the OS, and every paired device — Shortcut or Android —
speaks the identical envelope. A dedicated `android_capture_v1` origin can be
added with the processor PR if channel-level metrics need to split by platform.

## What leaves the device

Only when a notification matches a registered provider matcher
(`ProviderMatchers.kt`, a port of `supabase/functions/_shared/providers.ts`):

- the matched message text, verbatim (≤ 2000 chars)
- its post time (`received_at`, ISO-8601)
- the source package name (`metadata`, advisory)
- `client_version`, `platform:"android"`

Everything else — every non-matching notification — is discarded in
`onNotificationPosted` before any storage or network call, and is never logged.
There is no `READ_SMS`/`RECEIVE_SMS` permission. There is no analytics SDK.

## Permissions

| Permission | Why |
|---|---|
| `BIND_NOTIFICATION_LISTENER_SERVICE` | the one sensitive capability; user grants it in Settings → Notification access |
| `POST_NOTIFICATIONS` | the app's own status notification (Android 13+) |
| `INTERNET`, `ACCESS_NETWORK_STATE` | send to `/capture`, gate on connectivity |
| `RECEIVE_BOOT_COMPLETED` | reschedule the queue drain after reboot |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC` | WorkManager foreground when draining a backlog |

## Offline queue

- Room table `queued_capture`, **capacity 500**. Overflow evicts the oldest
  pending row and records a `queue_overflow` health event.
- On-device dedupe key `sha256(normalizeMessage(text) + "|" + minute(received_at))`
  collapses the listener seeing the same notification twice. The server's
  `(ingestion_connection_id, payload_hash)` unique index is the real idempotency
  boundary, so a double-send just returns `200 duplicate`.
- `CaptureUploadWorker` drain, oldest-first, `NetworkType.CONNECTED`,
  exponential backoff. Per-row outcome:

  | Server response | Action |
  |---|---|
  | `202 queued` / `200 duplicate` | delete row, stamp `last_success_at` |
  | `422 UNKNOWN_PROVIDER` / `400 INVALID_CAPTURE_PAYLOAD` | dead-letter (visible in health), stop retrying |
  | `401` | flag `reauthentication_required`, stop the run (needs re-pair) |
  | `429` / `5xx` / network | increment attempt; dead-letter after 12 |

## Health states

`setup_required` · `permission_required` · `active` · `degraded`
(queue aging > 30 min, or stale success with a backlog) ·
`reauthentication_required` (server `401`) · `send_failed_permanent`
(dead-lettered rows present). All derived — see
`health/ConnectionHealth.kt`. A successful `op:"test"` at pair time bumps
`device_credentials.last_used_at`, which flips the existing web wizard "Verify"
step with no companion-specific server work.

## Config

| Name | Where | Effect |
|---|---|---|
| `DEVICE_PAIRING_V2` | Edge Function secret + web env | not `enabled` ⇒ `/capture` 404 ⇒ companion shows "not accepting new connections" |
| `ONELEDGER_CAPTURE_BASE_URL` | Edge Function secret | stable base returned as `capture_url`; companion stores and reuses it |
| `DEFAULT_CAPTURE_BASE_URL` | Android `buildConfigField` (per build type) | only used for the first `op:"pair"` before a `capture_url` exists |

## Play Store posture

Notification-listener access requires a Data Safety declaration and an in-app
prominent disclosure (shown before the listener is enabled — see the pairing
pane copy). SMS/Call-Log access is deliberately not requested; Play restricts it
to default-handler apps and every target provider posts a notification for the
same event. A `READ_SMS` build could ship later as a sideloaded APK for power
users behind the same matchers, but it is not the store path.
