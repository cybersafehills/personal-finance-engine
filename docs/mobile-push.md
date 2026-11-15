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

Nothing below is done yet.

1. **Expo project.** Create an Expo account/project and run `eas init` in
   `oneledger-mobile/` so `extra.eas.projectId` exists in the app config.
   Without it the app says notifications aren't set up yet.
2. **Android (FCM).** Create a Firebase project for package
   `me.oneledger.companion`, add `google-services.json` to the app config
   (`android.googleServicesFile`), and upload the FCM v1 service-account key
   to Expo (`eas credentials`).
3. **iOS (APNs).** Needs the Apple Developer Program membership
   (docs/mobile-apple-developer-setup.md): create an APNs key and let
   `eas credentials` manage it.
4. **Database + function.** Merge to `main`; the Deploy Supabase workflow
   applies the migration and deploys `send-push-notifications`.
5. **Secrets.** `supabase secrets set PUSH_NOTIFICATIONS_ENABLED=true`
   (and `EXPO_ACCESS_TOKEN` only if enhanced push security is on).
   `NOTIFICATION_CRON_SECRET` must already be set.
6. **Schedule.** Call the function every minute (Dashboard schedule or
   `pg_cron`), with the `x-notification-cron-secret` header.
7. **Verify** on a real phone: turn on phone alerts, trigger a notification
   (for example accept a Space invite on another account), confirm it
   arrives and that tapping it opens the app.
