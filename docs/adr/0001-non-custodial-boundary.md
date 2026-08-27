# ADR 0001: OneLedger Pay & Services is a non-custodial orchestration layer

- **Status:** Accepted
- **Date:** 2026-08-27
- **Context:** Introduced with Pay & Services Phase 1 (Verified USSD Hub).
  Recorded now, before any money movement exists, so Phases 2-3 inherit
  the constraint rather than rediscovering it.

## Decision

OneLedger Pay & Services is, and will remain, a **non-custodial
financial orchestration, verification, reconciliation, and intelligence
layer.** User funds stay with MTN, Airtel, banks, or licensed payment
service providers at all times.

OneLedger must not:

- Hold, pool, store, settle, or intermediate user funds.
- Present itself as a wallet, bank, Mobile Money operator, or PSP.
- Request, collect, transmit, log, cache, or store a Mobile Money PIN,
  banking PIN, OTP (beyond a formally approved provider flow), or any
  other provider authentication secret.
- Simulate or reproduce a provider PIN screen, or automate PIN entry.
- Claim a payment succeeded because a dialer or app opened, the user
  returned to OneLedger, a redirect happened, or an unverified message
  arrived.
- Treat MTN Collection `RequestToPay` as permission to move money from a
  consumer wallet to an arbitrary number.
- Implement outbound disbursement or P2P transfer without a separately
  approved provider product, commercial agreement, compliance
  assessment, and explicit product scope.

Interface language stays explicit: **Continue with provider**, **Open
phone dialer**, **Copy USSD code**, **Awaiting verification**, **Manually
confirmed**. Never **OneLedger Wallet**, **OneLedger Balance**, **Send
from OneLedger**, or any phrasing implying custody or direct settlement.

## How Phase 1 already honours this

- No money movement, no provider API, no credentials. The USSD Hub is a
  directory plus a safe hand-off (copy code / open dialer / written
  fallback steps).
- The capability layer (`web/lib/ussd/capability.ts`) refuses to put a
  `*` or `#` inside a filled parameter (no USSD-path injection), never
  appends a PIN, and only ever produces a `tel:` route on a direct user
  gesture - never on page load.
- `service_recent_usage` is schema-constrained so it *cannot* store a
  phone number, amount, meter number, or filled USSD string - only which
  code and what kind of action/outcome.
- The detail screen carries a standing notice: authorization happens with
  the provider, on the user's own phone, and OneLedger never asks for the
  PIN.

## Consequences

- Any future feature that would move money, hold a balance, or store a
  provider secret requires a new ADR superseding this one, plus the
  commercial / compliance / security gates named in
  `docs/pay-and-services.md`.
- A documented production-enablement gate must block real provider
  payment initiation until those approvals exist.
