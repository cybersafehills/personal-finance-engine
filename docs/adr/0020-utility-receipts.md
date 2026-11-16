# ADR 0020: Prepaid-electricity receipts (Cash Power)

- **Status:** Accepted, implemented behind the capture channel
  (`DEVICE_PAIRING_V2`) and, for keeping the token, `UTILITY_TOKEN_CAPTURE_ENABLED`
  + `SENSITIVE_DATA_KEYRING`. Migrations `20261228000000` (encrypted details),
  `20261229000000` (receipts), `20261230000000` (one-off scrub).
- **Date:** 2026-11-16
- **Supersedes:** the E5 assumption (docs/oneledger-3/e5-utility-tokens.md) that the
  token arrives inside the MoMo payment SMS. Real samples showed otherwise.

## Context

Buying prepaid electricity produces **two** SMS: the MTN MoMo payment confirmation
(no token) and, minutes later, a receipt from the electricity **vendor's own sender**
carrying a 20-digit token (a bearer value), the kWh, the amount, the meter number and
the vendor's own reference — in English ("Cashpower Token: …") or Kinyarwanda
("Tokeni: …"). The receipt may also arrive *before* the payment is recorded. The token
must never reach a display field, a log or an API response, and personal data (the
meter, the meter owner's name) should be kept to the minimum.

## Decision

1. **A receipt is its own record**, not a transaction (`utility_receipts`), linked to
   the payment. It never double-counts money.
2. **Capture** needs no new setup. `utility_receipt` is a provider matcher
   (`_shared/providers.ts` + the Kotlin port + `provider-cases.json`) requiring a
   labelled 20-digit token **and** kWh **and** RWF; it runs *before* MTN (the English
   receipt contains `TxID:`). The iPhone automation already forwards any message
   containing "RWF" with the sender blank, and the Android listener matches by text, so
   both forward the receipt once the backend and app know the shape.
3. **Processing** (`process-raw-events`, branch on `provider_key`): parse strictly
   (`ingest-momo/utility-receipt.ts`) → seal the token (AES-256-GCM, id-bound AAD) →
   `store_utility_receipt` → rewrite the raw evidence with the token removed. No
   `momo_messages` row is created for a receipt.
4. **Data minimisation:** only the **last 4 digits of the meter** are kept; the meter
   owner's name is never read; kWh is an integer in thousandths; the vendor reference
   is stored only as a SHA-256 hash (re-delivery is then a no-op). The token is stored
   only when capture is on **and** a key exists — otherwise the receipt is kept without
   it, never as plaintext. Clients get a **column-level** grant that omits the token
   columns (plus a safe `has_token` flag).
5. **Linking:** candidates are settled outgoing payments of exactly the receipt amount,
   of a type a utility purchase can have (not a person-to-person send, not a cash
   withdrawal), unclaimed, paid ≤ 24 h before / ≤ 1 h after the receipt. **Exactly one →
   linked automatically; several → `ambiguous` (the user chooses); none → `unmatched`
   and linked by a trigger when the payment arrives.** The trigger is best-effort and can
   never fail a payment insert. The user can confirm, un-link (which disables re-auto-
   linking) or ignore; each is audited.
6. **Reveal** goes through one database function (member+, source visibility, 20/hour,
   audited, generic not-found) that returns only the sealed value and which row it came
   from; the web/mobile **server** decrypts with its own key. Web needs step-up MFA;
   the mobile endpoint requires the second factor. The token shows for 30 seconds.
7. **Erasure/export:** receipts cascade with their workspace and transaction.
8. **History:** `scrub_utility_tokens(dry_run := true)` removes tokens that reached
   labels, references, metadata or raw evidence before the parser learned to strip
   them. Service-role, dry-run by default, idempotent; run deliberately.

## Consequences

- Legacy `ingest-momo` (x-ingest-key Shortcut) does **not** handle receipts; the paired
  capture path does. Receipts need `DEVICE_PAIRING_V2`.
- Other utilities (water, TV, gas) and other vendor wordings need their own parser +
  matcher; the shape of this one is the template.
- Losing `SENSITIVE_DATA_KEYRING` makes stored tokens unrecoverable; back it up outside
  the database. Rotate by prepending a key; remove an old one only when nothing is
  sealed under it.
