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
   engine. Parity is enforced by a shared fixture corpus
   (`oneledger-mobile/fixtures/provider-cases.json`) consumed by the Deno
   tests, the Kotlin tests and the mobile TS tests; CI fails on drift.
   `supabase/functions/_shared/providers.ts` stays the source of truth.
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
