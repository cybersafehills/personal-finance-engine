# OneLedger Capture — Shortcut specification

The thin Apple Shortcut that connects an iPhone to OneLedger. It is deliberately
minimal: **all** provider detection, parsing, routing and normalization live in
the backend (`capture` / `ingest-momo`). The Shortcut only pairs once, then
forwards message text.

This spec is written so it can be built by hand from the in-app guide **or**
assembled once and published as a signed `.shortcut` / iCloud link. Either way
the pairing handshake (ADR 0008, `docs/device-pairing.md`) is identical. When a
signed link exists, set `NEXT_PUBLIC_MOMO_SHORTCUT_URL` and the setup screen
shows a one-tap "Get the Shortcut" button.

Design goals: no user ever sees a URL, an API key, a header, or JSON. The only
Apple-required manual step is approving the Messages automation.

---

## Shortcut A — "Connect to OneLedger" (run once)

Purpose: exchange the pairing code shown in the OneLedger app for this phone's
own secure key, and remember where to send messages.

| # | Action | Notes |
|---|---|---|
| 1 | **Ask for Input** — "Enter the pairing code from OneLedger" | Text. The app shows `olp_…`; the user types or pastes it, or this is pre-filled from a QR deep link. |
| 2 | **Text** → `pfe_` + **Random** (a 24-char alphanumeric string) | This phone's device secret. Generated here so OneLedger never sees it in the clear. |
| 3 | **Set variable** `DeviceSecret` to the Text from step 2 | |
| 4 | **Dictionary** → `op: pair`, `pairing_token: <Provided Input>`, `device_secret: <DeviceSecret>`, `client_version: 1.0.0`, `platform: ios`, `device_label: <Device Name>` | |
| 5 | **Get Contents of URL** | Method `POST`; Request Body `JSON` = the Dictionary. URL: for a hand-built Shortcut, the setup screen shows the one value to paste here once; a signed Shortcut ships with `https://api.oneledger.me/v1/capture` baked in. |
| 6 | **Get Dictionary Value** `ok` from step 5 → **If** not `true` | Show the `error` value's friendly text (the app's guide lists them) and **Stop**. |
| 7 | **Get Dictionary Value** `capture_url` from step 5 | |
| 8 | **Dictionary** → `secret: <DeviceSecret>`, `url: <capture_url>` | |
| 9 | **Save File** (or a Data Jar / keychain action) — overwrite `OneLedger/config.json` in the Shortcuts folder | The only place the secret lives on-device. |
| 10 | **Show Notification** — "This iPhone is connected to OneLedger." | |

Nothing here is provider-specific.

---

## Shortcut B — "OneLedger Capture" (run by the automation)

Purpose: forward one message to OneLedger. Takes **Shortcut Input** (the message
text) and needs no interaction.

| # | Action | Notes |
|---|---|---|
| 1 | **Get File** `OneLedger/config.json` → **Get Dictionary from Input** | Fails closed if the phone was never connected. |
| 2 | **Get Dictionary Value** `secret` and `url` | |
| 3 | **Dictionary** → `op: capture`, `message: <Shortcut Input>`, `received_at: <Current Date, ISO 8601>`, `client_version: 1.0.0` | The universal capture envelope. |
| 4 | **Get Contents of URL** | `POST` to `url`; Headers `x-device-key: <secret>`; Request Body `JSON` = the Dictionary. |
| 5 | *(optional)* **If** the response `ok` is not `true` and `error` is `INVALID_DEVICE_CREDENTIAL` → **Show Notification** "Reconnect this iPhone to OneLedger." | Everything else stays silent (`202 queued` / `200 duplicate` / `422 UNKNOWN_PROVIDER` are all fine to ignore). |

> `op:"capture"` accepts the message as **queued evidence** (`202`) — the
> transaction appears once the OneLedger processor normalizes it (ADR 0009).
> Until that processor ships you may keep Shortcut B pointed at the legacy
> `ingest-momo` endpoint (`{ message, received_at }` + `x-ingest-key` header);
> switching to `/capture` later is a URL + header change with no re-pairing.

---

## Shortcut C — "Test OneLedger connection" (optional, in Shortcut A's success path)

| # | Action | Notes |
|---|---|---|
| 1–2 | as Shortcut B steps 1–2 | |
| 3 | **Dictionary** → `op: test`, `client_version: 1.0.0`, `metadata: { test: true }` | |
| 4 | **Get Contents of URL** — `POST url` + `x-device-key` header + JSON body | |
| 5 | **Show Notification** — `ok`/`test` true → "OneLedger is receiving from this iPhone." | Creates no transaction; safe to repeat. |

---

## Messages automation (Apple-required, manual)

In **Shortcuts → Automation → New → Message**:

- **Message contains** — the provider sender the app tells the user to use
  (e.g. the MTN MoMo sender). The app's guide carries the country/carrier
  value; it is not hard-coded here.
- **Run Immediately**, notifications off.
- Action: **Run Shortcut → OneLedger Capture**, passing the message as input.

OneLedger cannot create this automation for the user; the app guides it
step-by-step with screenshots and a confirmation check.

---

## Versioning

`client_version` is sent on every request. The backend uses it to recognise an
outdated Shortcut and, later, to prompt an update. Bump it whenever Shortcut A
or B changes shape. Keep both Shortcuts thin so backend changes rarely require a
new version.
