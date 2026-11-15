# Mobile push notifications

How the OneLedger mobile app receives push notifications (ADR 0019 section 8,
mobile PR 7). Everything here is **dark until activated**; the steps to
activate are at the bottom.

## Design

Push is a **second delivery of the existing in-app notifications**, not a new
channel. Every `notifications` row with `channel = 'in_app'` already passed
`should_notify(..., 'in_app')`, so anything a user silenced in-app is not
pushed either, and there is no new preference surface.

```
enqueue_notification()  ->  notifications (channel='in_app')
                                   |
        send-push-notifications (scheduled Edge Function)
          claim_notification_pushes()  -- lease, FOR UPDATE SKIP LOCKED
          POST https://exp.host/--/api/v2/push/send
          ack / release / disable_push_devices
                                   |
                         Expo push service -> FCM / APNs -> phone
```

## Database (`20261221000000_push_devices.sql`)

| Object | Who | Purpose |
|---|---|---|
| `push_devices` | RLS: select own | One row per app install: Expo token, platform, `created_at`, `disabled_at` |
| `register_push_device(token, platform)` | authenticated | Upsert the caller's token; a token re-registered by another user moves to them and restarts `created_at`; keeps the 10 most recent per user |
| `unregister_push_device(token)` | authenticated | Delete the caller's own token (sign-out / alerts off) |
| `notifications.push_*` columns | - | Claim token, claim time, attempts, `push_sent_at` |
| `claim_notification_pushes` / `ack_…` / `release_…` | service role | Lease, complete, retry |
| `disable_push_devices(tokens, reason)` | service role | Stop sending to tokens the push service reports dead |

A row is pushed only when **all** hold: unread; created in the last 24 hours;
fewer than 5 attempts; the user has an active device **registered before the
notification was created** (a newly installed phone is not flooded with old
news).

## Edge Function `send-push-notifications`

- `POST` only, header `x-notification-cron-secret` (the same
  `NOTIFICATION_CRON_SECRET` as `send-notifications`). `verify_jwt = false`.
- Clean no-op unless `PUSH_NOTIFICATIONS_ENABLED = true`.
- One message per (notification, phone). `data` carries IDs only
  (`notificationId`, `eventKey`, `resourceType`, `resourceId`).
- A notification is done when any phone accepts it. `DeviceNotRegistered`
  disables that token. Other failures release the claim for a later run.
- Logs counts only: never titles, bodies or tokens.

**Privacy note.** The push shows the notification's `title` and `body` on the
lock screen, exactly as written by the producer. Producers that include
amounts will show them there. If that is not wanted, shorten the text at the
producer or add a generic-body option here.

## App

- `src/features/push/push.ts`: asks permission **only** when the user taps
  "Turn on phone alerts" (More tab), gets the Expo token, calls
  `register_push_device`. Re-registers silently on launch. Unregisters on
  sign-out and when alerts are turned off.
- `PushBridge`: opens the right screen when a notification is tapped
  (`pushTarget`: a transaction opens its detail; everything else opens the
  notifications list). The payload is validated before it is used as a route.
- `/notifications`: the in-app list (works without push), mark read / mark
  all read via the existing database functions.
- Real phones only; simulators, emulators and the web preview cannot receive
  pushes.
- The capture engine ignores OneLedger's own notifications
  (`IGNORED_NOTIFICATION_PACKAGES`), so a push is never captured as a
  transaction message.

## Activation checklist

Status as of 2026-11-15. Pushes only start once steps 2/3 (credentials) and
5/6 (flag + schedule) are all done; until then everything is inert.

| # | Step | Who | Status |
|---|---|---|---|
| 1 | Expo project (`@dolyindesign/oneledger`, `extra.eas.projectId`) | done | **Done** |
| 4 | Migration + `send-push-notifications` deployed to production (Deploy Supabase on #181, flag off) | done | **Done**, verified in the run log |
| 2 | Android: Firebase + FCM credentials | **you** | Open |
| 3 | iOS: APNs key | **you**, after the Apple fee | Blocked on Apple |
| 5 | Turn the function on (`PUSH_NOTIFICATIONS_ENABLED`) | needs an explicit go-ahead | Open |
| 6 | Schedule the function every minute | needs an explicit go-ahead | Open |
| 7 | Verify on a real phone | you + me | Open |

### 2. Android: Firebase (about 15 minutes, your Google account)

Without this an Android build cannot get a push token; the app says "Phone
alerts aren't set up in this version of the app yet." (`push-errors.ts`).

1. <https://console.firebase.google.com> -> **Add project** (name it
   OneLedger; Analytics can stay off).
2. **Add app -> Android**, package name **`me.oneledger.companion`** (must
   match exactly). Download **`google-services.json`**.
3. Give the file to EAS (do not commit it; it is git-ignored):
   ```sh
   cd oneledger-mobile
   npx eas-cli env:create --name GOOGLE_SERVICES_JSON --type file \
     --value ./google-services.json --visibility sensitive \
     --environment preview --environment production
   ```
   `app.config.ts` picks it up automatically (`android.googleServicesFile`);
   no code change. Without the variable the field is omitted and builds work
   as before.
4. **FCM v1 credentials for Expo.** In Firebase: Project settings -> Service
   accounts -> **Generate new private key** (a JSON file). Then
   `npx eas-cli credentials` -> Android -> the `production` (and `preview`)
   profile -> **Google Service Account** -> *FCM V1 key* -> upload that JSON.
   Delete the downloaded key file afterwards; it is a secret.
5. Make a new Android build (`eas build -p android --profile preview`). A
   build made before this step does not include Firebase.

### 3. iOS: APNs

Needs the Apple Developer membership (docs/mobile-apple-developer-setup.md).
Then `npx eas-cli credentials` -> iOS lets EAS create and store the APNs key.

### 5. Turn the function on (production change)

```sh
supabase secrets set PUSH_NOTIFICATIONS_ENABLED=true --project-ref zttxsaiywkfrbdxgzbjd
```
`NOTIFICATION_CRON_SECRET` is already set (shared with `send-notifications`).
`EXPO_ACCESS_TOKEN` only if "enhanced push security" is enabled in the Expo
project. Safe to do early: with no registered devices the function finds
nothing to send.

### 6. Schedule (production change)

Call `POST <project>/functions/v1/send-push-notifications` every minute with
header `x-notification-cron-secret: <NOTIFICATION_CRON_SECRET>`, the same way
`send-notifications` is scheduled (Dashboard schedule or `pg_cron`, see the
other runbooks). Check it with a manual call first: it must return 200 with a
`sent: 0` style summary and never log tokens or text.

### 7. Verify on a real phone

Install a build made after step 2, sign in, **More -> Turn on phone alerts**,
allow the system prompt, then trigger a notification (for example accept a
Space invite on another account). It should arrive within about a minute and
tapping it should open the right screen. Simulators and the web preview
cannot receive pushes.
