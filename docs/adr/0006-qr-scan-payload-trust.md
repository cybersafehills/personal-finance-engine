# ADR 0006: A scanned QR is untrusted data — every payload passes a fixed classify → validate → resolve → allowlist pipeline before it can become an action

- **Status:** Accepted (Pay & Services — Phases R2–R4, "Scan to pay")
- **Date:** 2026-08-28 (R2); amended 2026-08-28 (R3 — review & hand-off;
  R4 — reconciliation)
- **Context:** R1 shipped the camera scanner shell. R2 adds QR *decoding*
  and turns a decoded string into a structured, display-ready payment
  instruction. A QR code is attacker-controllable: a merchant sticker
  can be overlaid, a payload can carry an executable URI, a phishing
  link, a lookalike provider domain, an injected USSD path, a replayed
  or expired request, an impossible amount, or deceptive Unicode. The
  non-custodial boundary (ADR 0001) and the payment-intent lifecycle
  (ADR 0002) already say OneLedger prepares and hands off instructions
  and never treats a hand-off as settlement — R2 must not create a new
  way to bypass that.

## Decision

### 1. Decoded text is data, never authorization, and never a destination

There is no "decoded string → `window.location`" path. A decode result
only ever enters `parseScan()` (`web/lib/pay/scan/pipeline.ts`), a pure,
dependency-free function that runs the fixed stages:

```
normalize → classify → per-type strict parse/validate
          → provider resolution → allowlist / risk checks → ReviewModel
```

Anything that fails any stage is a `{ ok: false, class, reason }` with a
**closed** `RejectionReason` union. There is no generic "open anyway".

### 2. The pipeline is pure; the two real-world lookups are injected

`parseScan` takes a `resolvers` argument: `matchUssd` (against the
RLS-scoped verified USSD directory) and `providerAllowlist`. This keeps
the whole thing deterministically unit-testable and lets the **server**
re-run it authoritatively. The browser may run the same pure pipeline
for instant feedback, but `web/app/pay/scan/actions.ts`
(`classifyScannedCode`) is the trusted pass: feature-gated server-side,
resolvers bound to live data, and the only result R3 will be allowed to
act on. It persists nothing (that is R3/R4).

### 3. Supported payload classes in R2

| Class | R2 behaviour |
|---|---|
| `verified_ussd` | `tel:`/bare USSD, canonicalised (only `%2A`/`%23` decoded — never a general `decodeURIComponent`), matched **exactly** against a published directory template. No directory match ⇒ `unknown_ussd`. No resolver (offline) ⇒ `needs_connection` — never guessed. |
| `oneledger_payment` | First-party versioned JSON schema (`v:1`), **fully implemented parser**: unknown keys rejected, every field type/range-checked, expiry enforced, nonce replay rejected, amount is exact minor units, currency ∈ `KNOWN_CURRENCIES`. `merchant_name` is display-only and **not trusted** (`providerVerified: false`) — v1 carries no signature. |
| `provider_link` | https only, no embedded credentials, host on a **central allowlist**, optional path-prefix check. |
| `emv_merchant` | Adapter interface + TLV + CRC-16/CCITT structural check only. A well-formed payload is **`emv_unsupported`** (recognised, deliberately not handled); a bad CRC / structure is `emv_malformed`. Implementing a partial EMV subset from assumptions is out of scope until there is an authoritative spec + provider sign-off. |
| `suspicious` | Executable/local URI schemes, embedded-credentials URLs, lookalike provider hosts. Short-circuits — never parsed further. |
| `unsupported` | Everything else, with a specific reason (`unknown_scheme`, `not_recognised`, …). |

### 4. The provider-link allowlist ships **empty**

Real entries (MTN MoMo / Airtel Money / eKash universal links) need the
providers' published link specs and sign-off. Until then
`PROVIDER_LINK_ALLOWLIST = []` and **every** provider link is rejected
`provider_not_allowlisted` — the safe default. Adding an entry is a code
change (reviewed), not runtime config, in R2.

### 5. Decoder: native `BarcodeDetector` only

No heavy wasm decoder is bundled in R2. Where `BarcodeDetector` is
absent (Firefox, older Safari) the scanner is preview-only and says so;
a fallback decoder is a later, measured decision. The image-upload path
decodes locally (`createImageBitmap` + `detect`), never uploads, and
releases the bitmap. Multiple codes in one frame/image are never
resolved silently — the user is asked to retry with a single code.

### 6. Logging / analytics

Only the coarse `class` and `reason` may be logged or sent to analytics
for a scan — never the raw payload, a filled USSD string, a URL, an
amount, or a merchant/account identifier. `web/lib/pay/scan-analytics.ts`
enforces this with the same key/value redaction as the directory module.

## R3 amendment — review, hand-off, and the recorded attempt

### 7. The hand-off is re-derived server-side from the raw string

`prepareScanHandoff(raw)` does not trust the `ReviewModel` the client
holds — it re-runs `parseScan` with live resolvers and rebuilds
everything (directory row, captured params, normalized msisdn) from
`raw`. The client keeps `raw` only to send it here.

### 8. What the hand-off will act on

- **verified USSD + amount** → a `payment_intents` draft is created
  (`source = 'qr_scan'`), then the user opens a real `<a href="tel:…">`.
  The dial string is exactly what was scanned; nothing is appended.
- **verified USSD, no amount** (a menu / balance code) → `info_only`:
  openable, **nothing persisted** — it is navigation, not a payment.
- **OneLedger merchant payment (RWF)** → the payload is mapped onto the
  network's pay-a-merchant USSD code
  (`oneledgerProviderToDirectory` → `getServiceCodeForPayment(net,
  "merchant_payment")`), `fillUssdTemplate`d with the `merchant_id` +
  amount (payload's, or a `parseUserAmount`-validated one the user
  types), and then handed off exactly like a USSD scan — a
  `pay_merchant` `source = 'qr_scan'` intent. The server re-parses `raw`
  (never a client model); the client only supplies the typed amount, and
  it is re-validated server-side. A non-RWF payload, an unmapped
  provider, a non-numeric `merchant_id` (rejected by the USSD
  `merchant_code` field), or an expired / replayed payload all
  dead-end in the review.
  - The seeded MTN pay-merchant code
    (`20260913000100_scan_merchant_pay_codes.sql`) is **`published` with
    `verified_at = null`** — same provenance bar as the Phase M
    `send_money` seeds. The review surfaces "Not officially verified"
    and the full dial string before the user opens it. Airtel is not
    seeded until its path is confirmed. Cross-session `nonce` replay
    is not persisted yet — the payload `expires_at` and the deterministic
    idempotency key are the current guards.
  - **Verification (public sources, 2026-08):** the entry point
    `*182*8*1#` for pay-a-merchant-by-code, then prompts for the code
    and the amount, and 5–6-digit merchant codes, are corroborated by
    several Rwanda MoMo guides and a post on MoMo Rwanda's official
    Facebook page. The **concatenated** `*182*8*1*{merchant}*{amount}#`
    form is **not MTN-documented anywhere found** — every source shows
    step-by-step prompts. Before an admin sets `verified_at`, a real MTN
    handset must confirm the one-line form dials straight through; if it
    doesn't, the directory should hold the literal `*182*8*1#` entry +
    steps and the scanner would present the code + amount for the user
    to type at the prompts.
- **provider_link / emv_merchant / non-RWF OneLedger** → shown, not
  actionable.

### 9. The recorded attempt is provenance, not settlement

`payment_intents.source = 'qr_scan'` (new column, `default 'assisted'`,
`check in ('assisted','qr_scan')`; `create_payment_intent` learns one
optional payload key — otherwise byte-identical). The intent moves
`draft → initiated → awaiting_verification` via the **existing**
user-actor `transition_payment_intent`; `record_payment_attempt` logs the
gesture. Reaching `successful` still requires ADR-0002's evidence
(SMS/statement reconciliation or an explicit, separately-labelled manual
confirmation) — opening the dialer is never proof. The UI's terminal
state is "Awaiting confirmation".

### 10. Idempotency

The idempotency key is deterministic —
`qr:` + sha256(`dial` + `|` + `amount_minor`) — so a double-tap or a
re-scan of the same code within the TTL returns the existing draft
(`existed: true`), never a duplicate.

### 11. Reconciliation reuses Phase 2b unchanged (R4)

A `source = 'qr_scan'` intent carries the same match keys an assisted
`pay_person` does (`recipient_msisdn_normalized`, `amount_minor`,
`provider`, time window), so `reconciliation_candidate_intents` /
`reconcile_payment_intent`, its retry cron, and the expiry sweep pick it
up with **zero changes** — they never look at `source`. A scanned
send-money USSD auto-reconciles against an ingested MoMo SMS; a scanned
merchant/bill code (no msisdn) stays awaiting-confirmation, the same as
assisted `pay_merchant`. Reaching `successful` still needs ADR-0002
evidence; manual confirmation is still labelled "Manually confirmed".

The one app-layer change: the payment-intent *lifecycle surface*
(`/pay/[id]`, activity, reconciliation, and confirm/cancel/fail/reconcile
actions) is gated `isAssistedPayEnabled || isScanToPayEnabled` so a scan
intent is manageable even where the assisted form is off.

## Consequences

- New supported formats or provider links are additive: a new adapter +
  allowlist entry + fixtures, no change to the pipeline shape. R3
  hand-off for a new format is a new branch in `prepareScanHandoff`.
- A scan that can't be verified (offline, unknown code, unsupported
  format) always dead-ends in "scan again / go back" — it can never
  fall through to an external action.
- The `create_payment_intent` change was verified by a manual full-chain
  `psql` apply on pg16 (source defaulting, explicit `qr_scan`,
  idempotency, CHECK rejection); `run_migration_tests.sh` (pg17) must
  still run before merge.
