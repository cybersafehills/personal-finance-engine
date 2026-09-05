# ADR 0010: OneLedger Android Companion

> Shipped product name: **OneLedger Shortcuts** (launcher label **OL Shortcuts**).
> Package `me.oneledger.companion` unchanged. "Companion" persists only in code
> identifiers and this ADR's historical title.

- **Status:** Accepted. PR1 (app scaffold, pairing, notification capture,
  offline queue, health) + the web wizard's Android branch shipped. Pair →
  `op:"test"` → real `op:"capture"` validated end-to-end from an Android
  emulator against production (2026-09-05); the listener-rebind and
  package-denylist points below came out of that test. Release signing +
  Firebase App Distribution wired (2026-09-05, `docs/android-companion-release.md`).
- **Date:** 2026-09-03 (validated 2026-09-05)
- **Builds on:** ADR 0008 (consumer device pairing + stable `/capture`
  endpoint), ADR 0009 (asynchronous capture ingestion & provider detection),
  ADR 0007 (connector installation / financial source / account / device
  credential are distinct lifecycles). ADR 0005 source-visibility and ADR 0001
  non-custodial boundary remain authoritative.
- **Context:** iPhone users reach OneLedger through the Capture Shortcut, which
  pairs and posts to `/capture` (ADR 0008/0009). Android has no first-class
  path — the master brief §11–§15 and `ONELEDGER_AUDIT.md` (§C "no device
  entity or native app", §Q big bet 1) call this the largest missing surface.
  The `/capture` protocol was deliberately designed platform-neutral: `platform`
  is a free field, the device chooses its own `pfe_…` secret, and `capture_url`
  is handed back at pair time rather than compiled in. Nothing server-side needs
  to change for Android to pair and capture.

## Decision

### 1. A thin native Kotlin app, not a second OneLedger

The companion does exactly four things:

1. **Pair** — redeem a one-time `olp_…` pairing token (typed, deep-linked, or
   scanned) for a scoped device credential via `POST /capture {op:"pair",
   platform:"android"}`.
2. **Observe** supported financial notifications through a
   `NotificationListenerService`, filtered **locally** to known providers before
   anything leaves the device.
3. **Queue & send** each matched message as a universal capture envelope to
   `POST /capture {op:"capture"}`, with a bounded on-device retry queue that
   survives offline periods and process death.
4. **Report health** — permission state, last successful send, queue depth,
   last error — and let the user disconnect.

No ledger, no budgets, no transaction list. Those stay on the web/PWA. React
Native / Expo were rejected: reliable `NotificationListenerService` behaviour,
foreground-service lifecycle, and Doze/battery handling are all native-surface
concerns, and the app is small enough that a JS bridge is pure overhead.

### 2. Least privilege; notification access only, no SMS

- The **only** sensitive capability requested is
  `BIND_NOTIFICATION_LISTENER_SERVICE` (granted by the user in system settings,
  not a runtime permission). No `READ_SMS` / `RECEIVE_SMS`. Play Store policy
  restricts SMS/Call-Log access to apps whose *default handler* is the core
  function; a financial-notification observer does not qualify and does not need
  it — MTN MoMo and the target banks all post a system notification for the same
  event.
- `POST_NOTIFICATIONS` (Android 13+) only so the app's own foreground/status
  notification can show.
- `INTERNET`, `ACCESS_NETWORK_STATE`, `RECEIVE_BOOT_COMPLETED` (re-arm the
  listener + reschedule the queue after reboot), `FOREGROUND_SERVICE` +
  `FOREGROUND_SERVICE_DATA_SYNC` for the upload worker when draining a backlog.
- The listener **discards every notification that does not match a registered
  provider matcher** in `detection/ProviderMatchers.kt` — a direct port of
  `supabase/functions/_shared/providers.ts`. Non-financial notifications are
  never parsed, never stored, never transmitted, never logged. Only the matched
  message **body** (MessagingStyle's last message, else `EXTRA_BIG_TEXT`/
  `EXTRA_TEXT` — never the notification title, i.e. never the sender id), its
  post time, and the source package name leave the device.
  The package is **not** an allowlist gate: `IGNORED_NOTIFICATION_PACKAGES` is a
  short denylist (own app, `android`, `systemui`, GMS) and everything else is
  decided by the text matcher — a real provider SMS surfaces in whatever app
  the phone uses to render it (Google/Samsung/Xiaomi Messages, a carrier app,
  the MoMo app), and an allowlist of guessed names silently drops transactions.
- Android often leaves the `NotificationListenerService` **unbound after an app
  reinstall or Play update** — still "enabled", `isConnected` can be a stale
  `true`, but `onNotificationPosted` never fires until the permission is
  toggled. `MainActivity.onCreate` calls
  `NotificationListenerService.requestRebind(...)` once per launch when the
  permission is granted (`ensureBound`), which recovers it with no user action.
- The privacy disclosure screen (shown before the listener is enabled) states
  this in plain language and links the Play Data Safety declaration.

### 3. The device generates and holds its own secret

Identical to the Shortcut flow (ADR 0008 §1). On pair the app generates
`device_secret = "pfe_" + 24 url-safe chars` with `SecureRandom`, sends it once
in the `op:"pair"` body, and stores it — plus the returned `capture_url` and
`device_id` — in `EncryptedSharedPreferences` (AES-256, StrongBox-backed key
where available). The secret is never rendered in the UI, never written to logs,
never included in crash reports. Losing or reinstalling the app means
re-pairing; it never invalidates the financial source or account.

### 4. Bounded, idempotent offline queue

- Room table `queued_capture` — `id`, `providerKey`, `message`, `receivedAt`
  (ISO-8601, the notification's `postTime`), `sourcePackage`, `attemptCount`,
  `nextAttemptAt`, `createdAt`, `dedupeKey`.
- **Capacity 500** rows. On overflow the oldest un-sent row is dropped and a
  `queue_overflow` health event is recorded — a deliberately visible failure,
  never unbounded growth.
- **On-device dedupe** before insert: `dedupeKey =
  sha256(normalizedMessage + "|" + minute(receivedAt))` collapses the common
  case of the listener seeing the same notification twice (post + update). This
  is a courtesy filter; the server's `(ingestion_connection_id, payload_hash)`
  unique index (ADR 0009 §1) is the real idempotency boundary, so a
  double-send is harmless — it returns `200 {status:"duplicate"}`.
- `CaptureUploadWorker` (WorkManager, `CONNECTED` constraint, exponential
  backoff 30 s → 5 h capped, `setBackoffCriteria`) drains the queue oldest-first.
  A row is deleted on `202 queued` **or** `200 duplicate`. `422 UNKNOWN_PROVIDER`
  and `400 INVALID_CAPTURE_PAYLOAD` delete the row and record a health event —
  retrying a message the server structurally rejects is pointless. `401` stops
  the worker and flips health to `reauthentication_required`. `429`/`5xx`/network
  errors increment `attemptCount` and reschedule. After `attemptCount >= 12` a
  row moves to a dead state (`send_failed_permanent`) surfaced in health, not
  silently dropped.
- No raw payload is ever put in a WorkManager `Data` object (a log-leak risk);
  the worker reads rows straight from Room.

### 5. Health states (map to the brief §19 vocabulary)

`setup_required` (not paired) · `permission_required` (paired, listener off) ·
`active` (listener on, last send < 48 h or queue empty) · `degraded` (queued
rows aging past 30 min, or ≥ 3 consecutive send failures) ·
`reauthentication_required` (`401` from server — credential revoked) ·
`send_failed_permanent` (dead-lettered rows present). Health is derived, not
stored as a mutable flag, from: listener-enabled check
(`NotificationManagerCompat.getEnabledListenerPackages`), last success
timestamp, queue depth + oldest-row age, last HTTP error. The web
`ConnectionReadinessProbe` already flips on `last_used_at`, so a successful
`op:"test"` or first real capture lights up the existing wizard "Verify" step
with no companion-specific server work.

### 6. Config & flags

- The whole feature rides the existing `DEVICE_PAIRING_V2` Edge secret. If it is
  not `enabled`, `/capture` is a hard 404 and the app shows "OneLedger is not
  accepting new device connections yet" — no separate Android flag.
- `capture_url` comes from the `op:"pair"` response and is persisted per ADR
  0008 §3, so the eventual move to `api.oneledger.me` needs no app update.
- Build-time `DEFAULT_CAPTURE_BASE_URL` (BuildConfig) is used **only** for the
  first `op:"pair"` call before a `capture_url` has been issued. Both build
  types point at OneLedger's single Supabase Functions URL
  (`zttxsaiywkfrbdxgzbjd`); there is no separate staging project — environments
  are separated by feature flags and workspace allowlists. A debug build can be
  repointed at a branch/preview backend by editing the `debug { … }` field.

### 7. Web wizard (follow-up, not this PR)

`web/components/PairWizard.tsx` is Shortcut/iOS-worded. A follow-up adds an
"Android phone" branch: same `startDevicePairing(accountId)` server action and
`olp_` code, but the install step links the Play listing / APK and the deep link
becomes `oneledger://pair?c=<token>` (the companion registers this scheme). The
`/pair` handoff page already renders the code copyably and is provider-agnostic;
only the "Run OneLedger Capture" Shortcut deep link is iOS-specific. Kept out of
this PR to keep the web surface (under active branch work) untouched.

## Consequences

- One new top-level `android/` Gradle module. No change to `web/`,
  `supabase/functions/`, or any migration — the server already speaks this
  protocol.
- CI gains an optional `android` job (`./gradlew :app:testDebugUnitTest lint`);
  the pure detection/envelope/queue logic is JVM-unit-testable without an
  emulator. Instrumented tests are a follow-up.
- A second capture client exists, so the universal envelope and provider
  matchers now have **two** implementations (Deno + Kotlin). They are kept in
  sync by `ProviderMatchersTest.kt` (which carries the same accept/reject cases
  as `_shared/tests` and `ingest-momo/tests/fixtures.ts`) and a cross-reference
  comment at the top of `_shared/providers.ts`.

## Rejected alternatives

- **SMS ingestion as the primary path.** Play policy blocks it for this app
  class, and every target provider posts a notification for the same event.
  A `READ_SMS` build could be offered later as a sideloaded APK for power users,
  behind the same matchers, but it is not the store path.
- **Tasker/MacroDroid recipe instead of an app.** Acceptable as a stopgap for
  internal testing only; it cannot do secure pairing, a bounded durable queue,
  or health reporting, and asks the user to hand a recipe their device secret.
- **Expo + native modules.** The app is ~15 Kotlin files; the RN runtime,
  Hermes, and a notification-listener native module would be more code than the
  app itself.
- **A OneLedger-specific Android flag.** `DEVICE_PAIRING_V2` already gates the
  entire capture surface; a second flag is drift waiting to happen.
