# ADR 0019: OneLedger mobile app (Expo) replaces the Android companion

- **Status:** Accepted (PR 0 scaffold landed; capture module is PR 3)
- **Date:** 2026-11-14
- **Supersedes:** ADR 0010 §1 ("a thin native Kotlin app, not a second
  OneLedger") and its "Expo + native modules" rejected alternative. The rest
  of ADR 0010 (least privilege, device-held secret, bounded idempotent queue,
  health vocabulary, flags) remains authoritative and carries over unchanged.
- **Builds on:** ADR 0008/0009 (pairing + `/capture`), ADR 0013 (iOS
  direction), ADR 0001 (non-custodial boundary).

## Context

`android/` ships a capture-only client. The product now needs one installable
app that also gives members a real mobile experience (home, transactions,
inbox, notifications), biometric unlock, push, and guided onboarding for both
platforms. Maintaining a Kotlin capture app plus a separate mobile app plus a
future Swift app is three codebases for one product.

ADR 0010 rejected Expo because the capture path is a native-surface concern
(`NotificationListenerService` binding, Doze/OEM kills, WorkManager). That
reasoning is correct and is **kept**: it is a reason to keep capture native,
not a reason to keep the whole app native.

## Decision

1. **One Expo (React Native, TypeScript) app, `oneledger-mobile/`**, Expo
   Router, development builds + EAS Build (not Expo Go).
2. **Capture stays native Kotlin, inside a local Expo module**
   (`modules/oneledger-capture`). Listener, matchers, Room queue, WorkManager
   drain and health derivation run with no JS runtime, so capture works while
   the app is killed. JS only reads health/events and triggers pairing. The
   `pfe_` device secret never enters JS.
3. **Matchers are not literally shared.** They must run in Kotlin with no JS
   engine. Parity is enforced by one shared fixture,
   `supabase/functions/_shared/tests/provider-cases.json`, run against
   `providers.ts` by the Deno suite and against the Kotlin port by the
   module's `ProviderCasesTest`. `providers.ts` stays the source of truth.
4. **Protocol unchanged.** Same `/capture` (`pair` → `test` → `capture`),
   same `DEVICE_PAIRING_V2` flag, same `capture_url` handling. No server
   change is needed for Android capture.
5. **Android identity is kept: `me.oneledger.companion`.** The native module
   keeps the existing prefs file name and Keystore key alias so, with the same
   package and signing key, an upgrade preserves existing pairings. iOS bundle
   id: `me.oneledger.app`.
6. **Auth & lock.** `supabase-js` with a chunked `expo-secure-store` adapter.
   Biometric unlock is an app-lock gate (`expo-local-authentication`), not a
   replacement for the Supabase session; capture never depends on it.
7. **Data.** Reads via `supabase-js` under RLS (mirroring `web/lib/queries.ts`).
   Writes that are server actions today (with MFA/capability checks) get thin
   bearer-JWT Route Handlers under `web/app/api/mobile/*` sharing extracted
   logic, so authorization is not duplicated in the client.
8. **Push.** New `push_devices` table + register RPC; push drain alongside
   the existing email outbox in `send-notifications`; Expo Push service
   (FCM v1 + APNs credentials).
9. **iOS.** iOS cannot observe other apps' notifications. v1 is an in-app
   Shortcuts guide plus pairing handoff; an App Intent ("Send to OneLedger",
   ADR 0013) follows. ADR 0013's "allow notification access" step does not
   apply to iOS.

## Implementation notes (PR 3)

- The module's Kotlin packages stay `me.oneledger.companion.*` (its Gradle
  `namespace` is `me.oneledger.capture`). Android stores the user's
  notification-access grant against the listener's component name, so the
  class name must not change across the upgrade.
- The service, boot receiver and permissions are declared in the module's own
  `AndroidManifest.xml` and merged by Gradle; no config plugin is needed.
- `FOREGROUND_SERVICE*` and `POST_NOTIFICATIONS` are not requested: the upload
  worker is plain WorkManager. (`CAMERA` returns with QR pairing in PR 4.)
- JSON is built with `org.json` instead of kotlinx-serialization, so the
  module needs no serialization compiler plugin. Wire shape is unchanged and
  pinned by `CaptureWireTest`.
- `android.allowBackup` is `false`: the device secret is in
  `EncryptedSharedPreferences`, which cannot be decrypted after a restore.

## Implementation notes (PR 4)

- **Connecting from inside the app needs no code.** The signed-in app calls
  `create_device_pairing_session` itself (the database function enforces
  "workspace owner only") and hands the one-time token straight to the native
  engine. The token is generated on the device, held only in memory, and
  never displayed. A typed/pasted code and the `oneledger://pair?c=` deep
  link remain as fallbacks for the web wizard.
- **No camera permission.** QR scanning existed to carry a code from the web
  to the phone; with in-app connect it is unnecessary.
- The connect flow's step is derived from the engine's real state, not
  stored, so it resumes after a trip to system settings or a restart.
- A prominent disclosure is shown before pairing or notification access.
- The browser development preview uses an in-memory demo engine (`__DEV__`
  on web only) so the flow can be reviewed without a phone.

## Implementation notes (PR 6)

- The iPhone guide mirrors the web pairing wizard's iOS branch: add the two
  Shortcuts, connect (the app creates the pairing session and runs "Connect
  to OneLedger" with the code via `shortcuts://run-shortcut`), create the
  Messages automation (Message Contains `RWF`, Sender empty), then verify.
- Progress is confirmed from the server, not from the Shortcut: the app polls
  its own `pairing_sessions` row and the device's `last_used_at` under RLS.
- Unlike Android, the one-time code is visible in JS and on screen here;
  that is inherent to handing it to a Shortcut. The device secret is still
  generated and held by the Shortcut, never by the app.
- The install buttons need `EXPO_PUBLIC_MOMO_SHORTCUT_URL` (and optionally
  `EXPO_PUBLIC_MOMO_CAPTURE_SHORTCUT_URL`). Until the Shortcuts are published
  (docs/oneledger-capture-shortcut.md "Publishing") the guide says so.
- Off an iPhone the screen is a walkthrough that creates nothing server-side.

## Implementation notes (review actions)

- Accepting or rejecting a category suggestion calls the same database
  functions as the web's server actions (`confirm_transaction_category`,
  `dismiss_suggested_category`) directly with the user's session. They check
  workspace membership themselves and are granted to `authenticated`, so no
  `/api/mobile` route is needed for them. A route is only added when the
  logic lives in a server action with checks the database does not enforce
  (MFA, capability gates).
- A conflict can only be cleared, never confirmed: nothing is applied on the
  user's behalf when rules disagree. Picking a different category still goes
  through the web.

## Consequences

- `android/` is retired only after the new app reaches parity and one stable
  release cycle; both speak the same protocol so they coexist safely.
- Android-specific onboarding must handle Android 13+ "restricted settings"
  for sideloaded builds and OEM background kills (battery/autostart).
- iOS device builds, TestFlight and APNs push require an Apple Developer
  Program membership (`docs/mobile-apple-developer-setup.md`). Android and
  all non-iOS work are unaffected.
- Expo SDK upgrades are a recurring cost; CI runs `expo-doctor`.

## Rejected alternatives

- **Keep Kotlin app + build a second mobile app.** Two apps for one user.
- **Pure-JS notification capture.** Cannot run when the app is killed.
- **Expo Go.** Cannot load the custom native module.
