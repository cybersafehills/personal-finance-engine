# ADR 0013: Native iOS capture direction (App Intents / App Shortcuts)

- **Status:** Proposed (direction only; no implementation scheduled)
- **Date:** 2026-09-05
- **Builds on:** ADR 0008 (consumer device pairing v2), ADR 0009 (async
  capture), ADR 0010 (Android companion). Does not change the
  non-custodial boundary (ADR 0001) or the connector model (ADR 0007).
- **Context:** iOS capture today is a **manually assembled Shortcut**. Even
  after pairing v2 removed the paste-a-permanent-key step, the user still
  installs a Shortcut, grants it automation permission, and wires a
  Messages trigger. This is the single most fragile part of first-run on
  iPhone (assessment section 6.4, audit appendix J): Shortcut import
  friction, silent automation-permission loss, iOS version differences in
  how two Shortcuts share as one link, and no health signal when the
  automation stops firing.

## Decision

Adopt a **native iOS companion** as the long-term iOS capture path,
mirroring the Android companion's thin-client role (ADR 0010). It is a
direction, not a commitment to a timeline.

### 1. Same thin-client contract as Android

The iOS app does exactly what `android/` does and nothing more:

- **pair** — run the pairing v2 handshake (`create_device_pairing_session`
  → `olp_…` one-time token → device-generated `pfe_…` secret → `POST
  /capture {op:"pair"}` → scoped `device_credentials` row + stable
  `capture_url`).
- **observe** supported financial notifications.
- **queue** offline, submit securely to `/capture {op:"capture"}`.
- **health** — surface last-sent / last-acknowledged and re-pair.

The server stays authoritative for normalization, deduplication,
categorization, transaction creation, and visibility. No financial domain
logic ships in the app.

### 2. App Intents + App Shortcuts for zero-config setup

- An **App Intent** ("Send to OneLedger") that takes notification / message
  text and posts one `/capture` envelope. It is the unit a user can wire
  to a personal automation without hand-building a multi-step Shortcut.
- **App Shortcuts** (iOS 16+) register that intent with the system so it is
  discoverable from Spotlight / Siri with no Shortcut import at all.
- Setup collapses to: install the app → scan the pairing QR → allow
  notification access → done. The Messages-automation step becomes an
  optional power-user path, not the default.

### 3. Migration away from the manual Shortcut

- The paired-Shortcut path (ADR 0008) and the legacy manual
  `x-ingest-key` path keep working unchanged — no forced migration.
- The native app pairs into the **same** `connector_installations` /
  `device_credentials` model (ADR 0007); an existing user re-pairs and
  their financial sources are untouched.
- `/pair` gains an "iPhone app" option alongside "iPhone Shortcut" once the
  app exists; the Shortcut option stays for users who prefer it or are on
  an older iOS.

## Consequences

- New surface to build and maintain (a second native client). Justified
  only if iPhone is a primary acquisition channel — revisit before
  committing engineering time.
- App Review: a notification-reading finance utility must be scoped and
  justified carefully; the non-custodial, read-only, user-paired framing
  helps.
- No schema or server change is required to *start* — the `/capture`
  contract and pairing v2 already accept any thin client. This ADR exists
  so that when iOS capture is prioritised, the shape is already agreed and
  it does not get built as a bespoke one-off.

## Not deciding here

- Whether to also ship a Safari Web Extension or rely solely on App
  Intents.
- Whether the app should support manual transaction entry (it should stay
  a capture client; entry is the web app's job).
