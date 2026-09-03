# Setting up the MoMo forwarding Shortcut (iPhone)

How an end user connects their phone so MTN Rwanda Mobile Money SMS flow
into OneLedger automatically.

> **Canonical source.** The step list and troubleshooting table below are
> a readable mirror of `web/lib/shortcut-guide.ts`, which the app renders
> at **Settings → Connections → Set up a device**
> (`/integrations/connections/setup`). Change the module; keep this file in
> step. `web/lib/shortcut-guide_test.ts` guards the module's structure and
> that every troubleshooting row maps to a real `ingest-momo` response.

## Before you start

1. Create a connection: **Settings → Connections → Connect a device**.
   Copy the one-time `pfe_…` key it shows — it is not shown again (only
   *Rotate credential* issues a new one).
2. The request contract those values plug into is in
   [`docs/momo-ingest-contract.md`](./momo-ingest-contract.md).

## Steps

1. **Open Shortcuts → Automation.** Shortcuts app → Automation tab → **+**
   → new personal automation.

2. **Choose “Message” as the trigger.** Under *Sender*, add the MoMo SMS
   sender (see the sender note below). Leave *Message Contains* empty.
   Set **Run Immediately** and turn **Notify When Run** *off*.

3. **Add “Get Contents of URL”.** Choose *New Blank Automation* if
   prompted, add the action, tap *Show More*.
   - **URL:** `https://<your-project-ref>.supabase.co/functions/v1/ingest-momo`
     (the app shows the fully-resolved URL for your environment)
   - **Method:** `POST`

4. **Add the two headers.**
   - `x-ingest-key`: your `pfe_…` connection key
   - `Content-Type`: `application/json`

5. **Set the request body to JSON.**
   - Field `message` (Text) → the **Shortcut Input** variable — the SMS text.
   - Optional field `received_at` (Text) → the **Current Date** variable,
     ISO 8601 format.

6. **Save, then send a real SMS.** Tap *Done*. Trigger or forward a MoMo
   SMS. Within seconds the connection turns **Ready** on Settings →
   Connections and the transaction appears in the ledger. If it stays
   *Not configured*, see Troubleshooting.

7. **If you rotate the key later.** Edit the automation's `x-ingest-key`
   header and paste the new `pfe_…` value. Nothing else changes.

## Sender note (unconfirmed)

The exact MTN Rwanda MoMo SMS sender ID to match in Step 2 is **not yet
confirmed on a real device**. Until it is:

- The in-app guide shows `<MTN sender - confirm on device>` as a
  placeholder.
- Set `MOMO_SMS_SENDER` (server env) to the real value once known — the
  guide then renders it everywhere with no code change.
- Users can meanwhile match whatever name MoMo messages actually arrive
  from on their own phone.

## Troubleshooting

| What you see | What to do |
|---|---|
| `401` / `unauthorized` | Key is wrong, or the connection was revoked/paused. Copy the key again (or rotate) and update the header. |
| `422` / `not_rwf_message` | The text had no `RWF` amount (OTP, promo). Harmless, nothing recorded. Narrow the trigger sender if noisy. |
| `400` / `missing_message` | The `message` body field isn't bound to the Shortcut Input variable. Re-add it via the picker. |
| `400` / `invalid_json` | Body type isn't JSON, or a hand-typed value has an unescaped quote. Set body to JSON; fill `message` from the variable picker. |
| `200` / `duplicate` | Same SMS already received. Safe to ignore — nothing double-counted. |
| Automation never runs | iOS fires Message automations only for SMS/iMessage, only with *Run Immediately* on and *Notify When Run* off. Re-check both, and Settings → Shortcuts permissions. |

## Android / testing

No official Android path. The same request works from any HTTP client —
the cURL example is in
[`docs/momo-ingest-contract.md`](./momo-ingest-contract.md#curl-equivalent-testing--android).

## Ready-made Shortcut (optional)

If a signed `.shortcut` / iCloud share link is ever published, set
`NEXT_PUBLIC_MOMO_SHORTCUT_URL` and the guide shows a **Get the ready-made
Shortcut** button. None is bundled in this repo.
