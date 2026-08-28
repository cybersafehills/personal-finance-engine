# ADR 0006: A scanned QR is untrusted data — every payload passes a fixed classify → validate → resolve → allowlist pipeline before it can become an action

- **Status:** Accepted (Pay & Services — Phase R2, "Scan to pay")
- **Date:** 2026-08-28
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

## Consequences

- R3 (review screen + hand-off) consumes `ReviewModel` and may assume it
  is already validated and its identifiers already masked.
- New supported formats or provider links are additive: a new adapter +
  allowlist entry + fixtures, no change to the pipeline shape.
- A scan that can't be verified (offline, unknown code, unsupported
  format) always dead-ends in "scan again / go back" — it can never
  fall through to an external action.
