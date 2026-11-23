# Pay: Splits

A payment can be sent as several transfers ("parts"). Each part is an ordinary
`payment_intent`, handed off by the user, one at a time. OneLedger never moves
money (ADR 0001). Flag: `PAY_SPLITS_ENABLED=true` (needs `ASSISTED_PAY_ENABLED`).

Product decisions, 2026-11-23 (OneLedger's product owner):

- Fee-optimising splits are in scope (this reverses the earlier "never compare one
  transfer with several" rule in `docs/oneledger-3/s10-fee-calculator.md`, which now
  applies to the fee calculator only).
- **eKash:** an amount up to RWF 10,000,000 goes as ONE transfer, fee RWF 20. A
  split is suggested **only when the amount exceeds** RWF 10,000,000.
- MTN fee-saving splits wait for verified fee data; until it is loaded they never fire.

## Two kinds

| | `capacity` (eKash) | `fee_saving` (MTN to MTN person transfer) |
|---|---|---|
| When | amount **>** the network's per-transaction capacity | a verified tariff shows parts cost less |
| Opt-in | none (the amount cannot go as one transfer) | per user, off by default, threshold Any / Balanced (50) / Bigger (250 RWF per extra part) |
| Data | `route_limits` + `route_fees` for `ekash`; owner-confirmed fallback 10,000,000 / 20 (`lib/pay/splits/rules.ts`) | verified `provider_tariffs` (provider `mtn-rwanda`, `send_money`); fixed or no-fee tiers only |
| Parts | fewest parts that each fit, as even as possible, largest first | exact search over band combinations, max 5 parts |
| Fee shown | "up to RWF 20 per part", a ceiling not a prediction | exact, with the tariff's source and verified date |
| Send the rest as one | never (it cannot go as one) | yes, once every prepared part is settled |

## Where things are

| Concern | Path (under `web/`) |
|---|---|
| Maths (pure, tested) | `lib/pay/splits/split-math.ts` (+ `split_math_test.ts`, brute-force cross-check) |
| eKash rule, tariff to bands (pure) | `lib/pay/splits/rules.ts` (+ `rules_test.ts`) |
| Next part / panel data (pure) | `lib/pay/splits/plan-state.ts` (+ `plan_state_test.ts`) |
| Offer (server, authoritative) | `lib/pay/splits/offer.ts` |
| Read plans | `lib/pay/splits/plans.ts` |
| Actions | `app/pay/splits/actions.ts` (start, next part, stop, send remaining as one, preferences) |
| UI | `components/pay/SplitOfferCard.tsx`, `SplitPlanPanel.tsx`, `SplitSettingsForm.tsx`; wired in `PaymentDraftForm.tsx` and `app/pay/[id]/page.tsx`; settings at `/pay/splits` |
| Strings | `lib/ussd/messages.ts` (`pay.splits`) |
| Schema + RPCs | `supabase/migrations/20270125000000_payment_split_plans.sql` |
| Flag | `isPaySplitsEnabled` in `lib/pay/gate.ts` |

## Rules the database enforces

- A `capacity` plan is refused unless the total **exceeds** the network's published capacity and every part fits within it (`not_over_capacity`, `part_over_capacity`).
- A `fee_saving` plan is refused unless it carries `fee_basis = 'verified_tariff'`.
- Parts must add up to the total; 2 to 12 parts.
- Part N+1 attaches only after part N is `successful` (verified or manually confirmed). This also keeps SMS reconciliation unambiguous, since it matches on exact amount, recipient and a 10-minute window.
- A stopped plan accepts nothing; stopping cancels unsent drafts and leaves settled parts alone.
- The server recomputes the offer when a split starts. Parts sent by the browser are never trusted.

## Updating the numbers when sources arrive

1. MTN fees: load a verified tariff through `docs/oneledger-3/fee-tariff-intake.md` (provider `mtn-rwanda`, type `send_money`, scope `same_network` or `any`). No code change: the offer picks it up. Percentage tiers are refused (not constant across a band).
2. If the provider publishes a minimum transfer, raise `minPartMinor` (`DEFAULT_SAVING_OPTIONS` in `split-math.ts`) or expose it from the tariff, and add the per-transaction and daily limits to `route_limits`.
3. eKash: correct `route_limits` / `route_fees` for the `ekash` network. They override the fallback in `rules.ts`.

## Known limits

- Institutions may enforce lower per-transaction or daily limits than the network's. The offer says so; it cannot know.
- Only `pay_person` and `pay_merchant` over eKash, and `pay_person` MTN to MTN for fee-saving. Bills, airtime, electricity, government and Airtel are not offered.
- A failed or expired part blocks the plan; the user stops it (no automatic retry of a part).
- Not run end to end in a browser: no local Supabase stack was available. Unit tests, typecheck, lint and the full migration suite (including a "Payment splits" block) pass.
