# OneLedger Shortcuts — Privacy Policy

_Draft. Host this at a stable public URL (e.g. `https://oneledger.me/legal/shortcuts-privacy`) and use that URL in the Play Console. Review with counsel before publishing. Last updated: 2026-09-05._

**OneLedger Shortcuts** ("the app", package `me.oneledger.companion`) is a
companion to the OneLedger personal-finance service. It exists to do one thing:
forward supported financial-transaction notifications from your Android phone to
**your own OneLedger account**, so those transactions are recorded automatically.

## What the app accesses

- **Notification access** (`BIND_NOTIFICATION_LISTENER_SERVICE`), which you grant
  explicitly in Android Settings. The app inspects the text of posted
  notifications **on your device** and keeps a notification only if its content
  matches a known financial-provider message pattern (for example, an MTN Mobile
  Money transaction alert).
- **Camera** — only when you tap "scan" during setup, to read a pairing-code QR.
  The preview is decoded on-device; no photo or video is captured, stored, or
  transmitted. You can decline and type the code instead.
- The app does **not** request or access SMS, call logs, contacts, location,
  photos, files, or the microphone.

## What leaves your device

Only when a notification matches a supported provider pattern, the app sends —
over an encrypted HTTPS connection, to the OneLedger service, associated with
your account:

- the matched notification's text body,
- the time it was posted,
- the package name of the app that posted it,
- the app version.

**Every notification that does not match is discarded on the device** — it is not
parsed further, not stored, not transmitted, and not written to any log. The app
contains no analytics or advertising SDK and sends data to no third party.

## Pairing credential

When you connect the app to OneLedger you exchange a short-lived one-time code
for a device credential that the app generates and stores encrypted on your
device (Android `EncryptedSharedPreferences`). This credential authenticates the
app's requests to OneLedger. It is not a device identifier, is never shown to
you, and is not shared. You can revoke it at any time by disconnecting the phone
in the app or removing the connection in OneLedger on the web; reinstalling the
app also discards it.

## Data retention and deletion

Transaction data the app forwards is stored in your OneLedger account and is
governed by the OneLedger Privacy Policy. You can view, export, or delete it
through your OneLedger account. Uninstalling the app stops all further capture
and erases the app's local data (the pairing credential and any not-yet-sent
messages in its local queue).

## On-device queue

If your phone is offline, matched messages wait in a small encrypted local queue
(bounded to 500 entries) and are sent once connectivity returns. Entries are
deleted as soon as the OneLedger service confirms receipt.

## Children

The app is not directed to children and is intended for account holders aged 18
or older.

## Changes

Material changes to this policy will be reflected here with an updated date and,
where appropriate, in the app.

## Contact

Questions: privacy@oneledger.me
