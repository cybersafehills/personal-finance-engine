# OneLedger Android Companion

A thin native Kotlin app that pairs an Android phone with OneLedger and forwards
**supported financial notifications** (MTN MoMo today) to the stable `/capture`
endpoint. It is a client of the ADR 0008 / ADR 0009 protocol — no server change
was needed to add it. Design rationale: `docs/adr/0010-android-companion.md`.
Protocol reference: `docs/device-pairing.md`, `docs/android-companion.md`.

## What it does

| | |
|---|---|
| **Pair** | Redeems a one-time `olp_…` code (typed or via `oneledger://pair?c=…` deep link) for a scoped `pfe_…` device credential. `POST /capture {op:"pair", platform:"android"}`. |
| **Observe** | A `NotificationListenerService` inspects each posted notification, runs the `ProviderMatchers` port of `_shared/providers.ts`, and **discards anything that doesn't match** — no SMS access, no other content retained. |
| **Queue & send** | Matched messages go to a bounded (500-row) Room queue, drained oldest-first by a WorkManager worker with exponential backoff. `POST /capture {op:"capture"}`. Server dedupe makes re-sends harmless. |
| **Health** | Derives `active / permission_required / degraded / reauthentication_required / send_failed_permanent` from listener state + queue age + last error. Lets the user disconnect. |

## Not in scope

No ledger, budgets, or transaction list — those stay on the OneLedger web/PWA.
No `READ_SMS`. No analytics SDK. The only sensitive capability is
`BIND_NOTIFICATION_LISTENER_SERVICE`, granted by the user in system settings.

## Module layout

```
app/src/main/java/me/oneledger/companion/
  detection/ProviderMatchers.kt        port of supabase/functions/_shared/providers.ts
  detection/ (notification text extraction lives in the service)
  service/CaptureNotificationListenerService.kt
  data/DeviceStore.kt                  EncryptedSharedPreferences (credential at rest)
  data/CaptureClient.kt                the ONLY HTTP surface — pair / test / capture
  data/PairingManager.kt               one pairing attempt, end to end
  queue/                               Room entity + dao + bounded repository
  work/CaptureUploadWorker.kt          drains the queue; maps HTTP → keep/drop/dead/stop
  work/CaptureScheduler.kt             expedited one-shot + 6h periodic safety net
  health/ConnectionHealth.kt           pure health derivation (unit-tested)
  ui/                                  Compose: pair pane + connected pane
```

## Build

The Gradle wrapper jar/scripts are not committed. Once, from `android/`:

```sh
gradle wrapper --gradle-version 8.9
```

Then:

```sh
./gradlew :app:testDebugUnitTest        # pure logic: matchers, normalize, health, queue
./gradlew :app:lintDebug
./gradlew :app:assembleDebug
```

`DEFAULT_CAPTURE_BASE_URL` is a `buildConfigField` set to OneLedger's Supabase
Functions URL (`https://zttxsaiywkfrbdxgzbjd.functions.supabase.co` — one
project for both build types; a public ref). It is used **only** for the first
`op:"pair"` call; every call afterward uses the `capture_url` the server handed
back at pair time, so moving to `api.oneledger.me` needs no app update. To test
a debug build against a branch/preview backend, edit the `debug { … }` line.

## Server flag

The whole feature rides the existing `DEVICE_PAIRING_V2` Edge secret. If it is
not `enabled`, `/capture` is a 404 and the app shows "OneLedger isn't accepting
new phone connections yet." There is no separate Android flag.

## Follow-ups (not in PR1)

- Instrumented tests: `CaptureClient` against MockWebServer, listener smoke test,
  pairing deep-link flow.
- Web wizard "Android phone" branch in `web/components/PairWizard.tsx` +
  `oneledger://pair` handoff (see ADR 0010 §7).
- Additional provider matchers (Airtel, bank SMS) — append to both
  `ProviderMatchers.kt` and `_shared/providers.ts`.
- Play Store listing, Data Safety form, signing config, CI `android` job.
