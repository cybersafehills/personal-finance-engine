# Pay: Splits (user-facing name: "Save On")

Users see this feature as **Save On** (settings page title, the offer card label, the link under the payment form, and the "How Save On works" steps in `pay.splits.settings` in `lib/ussd/messages.ts`). Code, routes (`/pay/splits`, `/api/mobile/pay/splits/*`), the flag and the database keep the technical name "split".

A payment can be sent as several transfers ("parts"). Each part is an ordinary
`payment_intent`, handed off by the user, one at a time. OneLedger never moves
money (ADR 0001). Flag: `PAY_SPLITS_ENABLED=true` (needs `ASSISTED_PAY_ENABLED`).

Product decisions, 2026-11-23 (OneLedger's product owner):

- Fee-optimising splits are in scope (this reverses the earlier "never compare one
  transfer with several" rule in `docs/oneledger-3/s10-fee-calculator.md`, which now
  applies to the fee calculator only).
- **eKash:** an amount up to RWF 10,000,000 goes as ONE transfer, fee RWF 20. A
  split is suggested **only when the amount exceeds** RWF 10,000,000.
- MTN fee-saving splits use MTN's own published fee table (loaded 2026-11-24, `docs/oneledger-3/tariff-sources/`); they are opt-in per user.

## Two kinds of transfer, two separate data sets

1. **Normal mobile money, MTN to MTN (not eKash).** MTN's "P2P On-net" table is tiered: 1-1,000 = 20; 1,001-10,000 = 100; 10,001-150,000 = 250; 150,001-2,000,000 = 1,500; 2,000,001-5,000,000 = 3,000; 5,000,001-10,000,000 = 5,000 (paid by the sender). Tiers make sending in parts cheaper for some amounts (180,000 RWF: 150,000 + 30,000 costs 500 instead of 1,500). Stored as `mtn-rwanda / send_money / same_network`.
2. **MoMo to another wallet or a bank via eKash.** MTN charges a flat RWF 20 per transfer in every band up to RWF 10,000,000, so parts never save fees; a split is offered **only above** RWF 10,000,000. Stored as `mtn-rwanda / bank_transfer / any`, plus the network's own RSwitch ceiling and capacity in `route_fees` / `route_limits`.

**Airtel to Airtel:** reported (2026-11-24, from a search summary citing Airtel Rwanda's Facebook posts, not from Airtel's own fee page) to be free (0 RWF) under its zero-fee "#NiZero" offer. A free transfer cannot be made cheaper by splitting, so Airtel gets no fee-saving offer either way. The unlabelled hidden table on Airtel's fee page (1-1,000 = 10 ... 150,001-2,000,000 = 750) is probably the older, pre-offer fee and is not used. If Airtel's own page or notice confirms the zero fee, load it as a verified `none`-fee tariff (fee type `none`) so the fee calculator can say "free"; until then nothing is loaded.

**Airtel (other):** Airtel Money's fee page publishes Cash-Out, IMT and Wallet to Bank only (loaded as `cash_withdrawal` and `bank_transfer`). It publishes no Airtel to Airtel person-to-person table, so Airtel gets no fee-saving offer until one is supplied (the offer code already looks up the payer's own network). Do not use unlabelled or hidden tables on that page.

## Two kinds

| | `capacity` (eKash) | `fee_saving` (MTN to MTN person transfer) |
|---|---|---|
| When | amount **>** the network's per-transaction capacity | a verified tariff shows parts cost less |
| Opt-in | none (the amount cannot go as one transfer) | per user, off by default, level Every Franc (any saving) / Worth It (at least 100 RWF per extra part, our pick) / Big Wins (at least 500 RWF); stored as `any` / `balanced` / `bigger` |
| Data | `route_limits` + `route_fees` for `ekash`; owner-confirmed fallback 10,000,000 / 20 (`lib/pay/splits/rules.ts`) | verified `provider_tariffs` (provider `mtn-rwanda`, `send_money`); fixed or no-fee tiers only |
| Parts | fewest parts that each fit, as even as possible, largest first | exact search over band combinations, max 5 parts |
| Fee shown | "up to RWF 20 per part", a ceiling not a prediction | exact, with the tariff's source and verified date |
| Send the rest as one | never (it cannot go as one) | yes, once every prepared part is settled |

## Savings report

Save On keeps a running total of what it has saved in transfer fees (web: Save On page, Insights, Reports, and a Home tile; mobile: Save On screen, Insights, Reports, Home), over 24 hours / 7 days / 2 weeks / a month / 3 months / 12 months / all time.

- **What counts:** for a fee-saving plan, `single_fee_minor - planned_fee_minor` (both from a verified tariff), and only once **every part is settled**. The window is by when the last part settled. A plan still being sent is shown as "expected"; a stopped plan counts for nothing; an over-the-eKash-limit plan saves no fee, so it never appears.
- **How:** computed live, never stored: `save_on_plan_outcomes_v` (security invoker) and `save_on_report(workspace)` (migration `20270129000000`), read through `lib/pay/splits/savings.ts` and `GET /api/mobile/pay/splits/savings`. The numbers are always current and can't drift from the plans.
- **Honesty:** estimates from the provider's published fee table; the provider shows the final fee. If the report can't be read the section is hidden, not shown as zero.

## Where things are

| Concern | Path (under `web/`) |
|---|---|
| Maths (pure, tested) | `lib/pay/splits/split-math.ts` (+ `split_math_test.ts`, brute-force cross-check) |
| eKash rule, tariff to bands (pure) | `lib/pay/splits/rules.ts` (+ `rules_test.ts`) |
| Next part / panel data (pure) | `lib/pay/splits/plan-state.ts` (+ `plan_state_test.ts`) |
| Offer (server, authoritative) | `lib/pay/splits/offer.ts` |
| Read plans | `lib/pay/splits/plans.ts` |
| Logic (shared web + mobile) | `lib/pay/splits/service.ts` (offer, start, next part, stop) |
| Web actions | `app/pay/splits/actions.ts` (MFA step-up, revalidation; plus send remaining as one, preferences) |
| Mobile API | `app/api/mobile/pay/splits/{offer,start,[id]/next,[id]/stop}`, `lib/pay/splits/mobile.ts`, `lib/mobile-splits.ts` (contract in `docs/oneledger-3/contracts.md`) |
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

1. Fees: load a verified tariff through `docs/oneledger-3/fee-tariff-intake.md` (for Airtel person-to-person: provider `airtel-rwanda`, type `send_money`, scope `same_network`). No code change: the offer picks it up. Percentage tiers are refused (not constant across a band). The MTN and Airtel tables loaded on 2026-11-24 are in `supabase/migrations/20270128000000_save_on_published_tariffs.sql`; `published_tariffs_test.ts` and the migration harness check them.
2. If the provider publishes a minimum transfer, raise `minPartMinor` (`DEFAULT_SAVING_OPTIONS` in `split-math.ts`) or expose it from the tariff, and add the per-transaction and daily limits to `route_limits`.
3. eKash: correct `route_limits` / `route_fees` for the `ekash` network. They override the fallback in `rules.ts`.

## Known limits

- Institutions may enforce lower per-transaction or daily limits than the network's. The offer says so; it cannot know.
- Only `pay_person` and `pay_merchant` over eKash, and `pay_person` MTN to MTN for fee-saving. Bills, airtime, electricity, government and Airtel are not offered.
- A failed or expired part blocks the plan; the user stops it (no automatic retry of a part).
- Browser/e2e coverage is written (`web/e2e/pay-splits.spec.ts`, plus a split test in `web/e2e/mobile-api.spec.ts`) but had not been run when this was written: it needs a local Supabase stack. Unit tests, typecheck, lint and the full migration suite (including a "Payment splits" block) pass.
