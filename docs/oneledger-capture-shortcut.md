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

> **Status (2026-09-03).** The `/capture` endpoint, the provider registry, and
> the async raw-events processor (ADR 0009) are all deployed and live behind
> `DEVICE_PAIRING_V2=enabled` on the production Supabase project. Publishing the
> Shortcut and setting `NEXT_PUBLIC_MOMO_SHORTCUT_URL` is the only remaining
> step to make guided iPhone setup real ("approach A"). Build the two Shortcuts
> once from the tables below, verify against
> [Verified backend contract](#verified-backend-contract), export each as an
> iCloud link, then set the env var (see [Publishing](#publishing)).

---

## Shortcut A — "Connect to OneLedger" (run once)

Purpose: exchange the pairing code shown in the OneLedger app for this phone's
own secure key, and remember where to send messages.

| #  | Action                                                                                                                                                                              | Notes                                                                                                                                                                                             |
| -- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | **Ask for Input** — "Enter the pairing code from OneLedger"                                                                                                                         | Text. The app shows `olp_…`; the user types or pastes it, or this is pre-filled from a QR deep link.                                                                                              |
| 2  | Generate this phone's device secret — see [Generating the device secret](#generating-the-device-secret) for the exact action list. Result is the text `pfe_` + ≥ 20 URL-safe chars. | Generated on-device so OneLedger never sees it in the clear. Must match `^pfe_[A-Za-z0-9_-]{20,}$` or `op:"pair"` returns `PAIRING_BAD_CREDENTIAL`.                                               |
| 3  | **Set variable** `DeviceSecret` to the Text from step 2                                                                                                                             |                                                                                                                                                                                                   |
| 4  | **Dictionary** → `op: pair`, `pairing_token: <Provided Input>`, `device_secret: <DeviceSecret>`, `client_version: 1.0.0`, `platform: ios`, `device_label: <Device Name>`            | `client_version` must match `^\d+\.\d+\.\d+$`.                                                                                                                                                    |
| 5  | **Get Contents of URL** → `https://api.oneledger.me/v1/capture`                                                                                                                     | Method `POST`; Request Body `JSON` = the Dictionary. Same URL for all three ops — the `op` field discriminates. Bake it into the published Shortcut; a hand-built one has the user paste it once. |
| 6  | **Get Dictionary Value** `ok` from step 5 → **If** not `true`                                                                                                                       | Show the `error` value's friendly text (the app's guide lists them) and **Stop**.                                                                                                                 |
| 7  | **Get Dictionary Value** `capture_url` from step 5                                                                                                                                  | The success body is `{ ok: true, device_id, capture_url }`. `capture_url` currently equals the URL from step 5; store it so the endpoint can move without re-pairing.                             |
| 8  | **Dictionary** → `secret: <DeviceSecret>`, `url: <capture_url>`                                                                                                                     |                                                                                                                                                                                                   |
| 9  | **Save File** (or a Data Jar / keychain action) — overwrite `OneLedger/config.json` in the Shortcuts folder                                                                         | The only place the secret lives on-device.                                                                                                                                                        |
| 10 | **Show Notification** — "This iPhone is connected to OneLedger."                                                                                                                    |                                                                                                                                                                                                   |

Nothing here is provider-specific.

---

## Shortcut B — "OneLedger Capture" (run by the automation)

Purpose: forward one message to OneLedger. Takes **Shortcut Input** (the message
text) and needs no interaction.

| # | Action                                                                                                                                                       | Notes                                                                                                                                                                                                                                                                                                                  |
| - | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | **Get File** `OneLedger/config.json` → **Get Dictionary from Input**                                                                                         | Fails closed if the phone was never connected.                                                                                                                                                                                                                                                                         |
| 2 | **Get Dictionary Value** `secret` and `url`                                                                                                                  |                                                                                                                                                                                                                                                                                                                        |
| 3 | **Dictionary** → `op: capture`, `message: <Shortcut Input>`, `received_at: <Current Date, formatted ISO 8601>`, `client_version: 1.0.0`                      | The universal capture envelope. Format the date action as ISO 8601 (e.g. `2026-09-03T14:22:05Z`); `received_at` must parse and fall within 30 days past / 24 h future or the row is rejected `INVALID_CAPTURE_PAYLOAD`. Send no keys beyond `op`, `message`, `received_at`, `client_version`, `metadata`, `device_id`. |
| 4 | **Get Contents of URL**                                                                                                                                      | `POST` to `url` (from `config.json`); Headers `x-device-key: <secret>`; Request Body `JSON` = the Dictionary.                                                                                                                                                                                                          |
| 5 | _(optional)_ **If** the response `ok` is not `true` and `error` is `INVALID_DEVICE_CREDENTIAL` → **Show Notification** "Reconnect this iPhone to OneLedger." | Everything else stays silent (`202 queued` / `200 duplicate` / `422 UNKNOWN_PROVIDER` are all fine to ignore).                                                                                                                                                                                                         |

> `op:"capture"` accepts the message as **queued evidence**
> (`202 { ok: true,
> status: "queued", event_id }`). The transaction appears
> within ~60 s once the raw-events processor normalizes it (ADR 0009) — that
> processor is **live**, so point Shortcut B at `/capture`, not the legacy
> `ingest-momo` endpoint. A redelivered message returns
> `200 { ok: true, status: "duplicate" }`; an unrecognised one
> `422 UNKNOWN_PROVIDER` (turned away, not stored).

---

## Shortcut C — "Test OneLedger connection" (optional, in Shortcut A's success path)

| #   | Action                                                                                | Notes                                   |
| --- | ------------------------------------------------------------------------------------- | --------------------------------------- |
| 1–2 | as Shortcut B steps 1–2                                                               |                                         |
| 3   | **Dictionary** → `op: test`, `client_version: 1.0.0`, `metadata: { test: true }`      |                                         |
| 4   | **Get Contents of URL** — `POST url` + `x-device-key` header + JSON body              |                                         |
| 5   | **Show Notification** — `ok`/`test` true → "OneLedger is receiving from this iPhone." | Creates no transaction; safe to repeat. |

---

## Messages automation (Apple-required, manual)

In **Shortcuts → Automation → New → Message**:

- **Message contains** — the provider sender the app tells the user to use (e.g.
  the MTN MoMo sender). The app's guide carries the country/carrier value; it is
  not hard-coded here.
- **Run Immediately**, notifications off.
- Action: **Run Shortcut → OneLedger Capture**, passing the message as input.

OneLedger cannot create this automation for the user; the app guides it
step-by-step with screenshots and a confirmation check.

---

## Verified backend contract

Checked against `supabase/functions/capture/handler.ts` +
`supabase/functions/_shared/pairing.ts` on `main` (2026-09-03).

| Thing                  | Value                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint               | `POST https://api.oneledger.me/v1/capture` — all of `pair` / `capture` / `test`                                                                                                             |
| Auth (capture, test)   | header `x-device-key: <device secret>` — no `Authorization`, no anon key                                                                                                                    |
| Auth (pair)            | none — the one-time `pairing_token` in the body is the credential                                                                                                                           |
| `pairing_token` shape  | `^olp_[A-Za-z0-9]{4}[A-Za-z0-9_-]{16,}$` (shown/scanned, never generated on-device)                                                                                                         |
| `device_secret` shape  | `^pfe_[A-Za-z0-9_-]{20,}$`; its first 8 chars must be `^pfe_[A-Za-z0-9_-]{4}$`                                                                                                              |
| `client_version` shape | `^\d+\.\d+\.\d+$` → use `1.0.0`                                                                                                                                                             |
| `platform`             | one of `ios` `ipados` `android` `macos` `other` (anything else coerced to `other`)                                                                                                          |
| `received_at`          | ISO-8601 string; rejected if unparseable, > 24 h in the future, or > 30 days old. Omit it and the server stamps now.                                                                        |
| Envelope keys allowed  | `op`, `message`, `received_at`, `client_version`, `metadata`, `device_id` — nothing else                                                                                                    |
| `message`              | 1–2000 chars for `op:"capture"`; optional for `op:"test"`                                                                                                                                   |
| `metadata`             | object, ≤ 1024 bytes serialized; `metadata.test === true` marks a test                                                                                                                      |
| pair success           | `200 { ok: true, device_id, capture_url }` (secret never echoed)                                                                                                                            |
| pair failure           | `400/401/409/429 { ok: false, error }` — `PAIRING_INVALID`, `PAIRING_BAD_CREDENTIAL`, `PAIRING_EXPIRED`, `PAIRING_ALREADY_USED`, `RATE_LIMITED`                                             |
| test success           | `200 { ok: true, test: true }` — writes no ledger data                                                                                                                                      |
| capture outcomes       | `202 { ok:true, status:"queued", event_id }` · `200 { ok:true, status:"duplicate" }` · `422 { ok:false, error:"UNKNOWN_PROVIDER" }` · `401 { ok:false, error:"INVALID_DEVICE_CREDENTIAL" }` |

## Generating the device secret

The Shortcuts app has no UUID action, so build a URL-safe token from repeated
**Random Number** actions. One reliable recipe for Shortcut A step 2:

1. **Text** — set to `pfe_`
2. **Repeat** 6 times:
   - **Random Number** — `100000000` to `999999999`
   - **Text** — `[the repeat's provided Text so far][Random Number]` (append)
     Use **Set Variable** `Secret` inside the loop to carry the running value.
3. Result: `pfe_` + 54 digits — satisfies `^pfe_[A-Za-z0-9_-]{20,}$`.

Digits only is fine: `[A-Za-z0-9_-]` includes `0-9`, and ~54 decimal digits is
~179 bits of entropy. Do **not** use **Random** ⇒ _emoji/word_ generators, and
do not include spaces or `+ / =`.

## Publishing

1. Build Shortcut A ("Connect to OneLedger"), B ("OneLedger Capture"), and
   optionally C ("Test OneLedger connection") on one iPhone/iPad from the tables
   above. Name them **exactly** those strings — the wizard and the automation
   reference them by name.
2. Pair that device once end-to-end and confirm a real captured SMS becomes a
   transaction (`202 queued` → row within ~60 s).
3. For each Shortcut: **Share → Copy iCloud Link** (Settings → Shortcuts →
   _Allow Sharing Large Shortcuts_ if the link is refused). A single link that
   installs A + B + C together (a Shortcut that adds the others) is ideal; a
   link to A alone is acceptable if A adds B/C on first run.
4. Set `NEXT_PUBLIC_MOMO_SHORTCUT_URL` to that link in the web app's environment
   (Vercel → Project → Settings → Environment Variables, Production) and
   redeploy. The pairing wizard's Install step then renders the one-tap **"Get
   the ready-made Shortcut"** button instead of the manual fallback.
5. Bump `client_version` and re-publish whenever A or B changes shape.

---

## Versioning

`client_version` is sent on every request. The backend uses it to recognise an
outdated Shortcut and, later, to prompt an update. Bump it whenever Shortcut A
or B changes shape. Keep both Shortcuts thin so backend changes rarely require a
new version.
