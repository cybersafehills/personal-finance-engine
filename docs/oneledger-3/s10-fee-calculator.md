# S10 — Transfer fee calculator (2026-11-18)

Workstream E (Payment utilities), spec §9 "Transfer fee intelligence". **Dark**: `/pay/fees` renders the app 404 and `GET /api/mobile/fees/estimate` answers 404 unless `FEE_CALCULATOR_ENABLED=true` (optional `FEE_CALCULATOR_WORKSPACE_ALLOWLIST`) **and** the Pay & Services gate covers the workspace. No migration. Not enabled anywhere.

## What the data actually supports (and so what this does)
The spec asks for "versioned, source-attributed fee schedules". The repo has the table (`route_fees`: dated, with source label/URL, types fixed / percentage / tiered / none / unknown / varies / published_maximum) but **very little data**: the only seeded fee is eKash's published *maximum* of RWF 20, and **no MTN or Airtel tariff is stored anywhere**. `route_fees` can say a fee is "tiered" but stores no tiers. A calculator that returned a number for MoMo from this would be inventing it. So it uses two separate kinds of evidence and never blends them:

1. **What you have actually paid** — the fees charged on your own past settled outgoing payments of the same type and currency, within ±20% of the requested amount, read from the ledger (`fee_rwf`, from the provider's own SMS). With ≥3 similar payments it shows the observed range, the usual fee if ≥60% paid the same one (ties go to the larger, never understating), the date span, and the most recent matching payments so every figure traces to rows. With fewer it says so and shows nothing.
2. **What a network publishes** (optional, network-scope rows only) — fixed fee, no fee, percentage (exact integer maths: whole-unit floor..ceiling, clamped to published min/max), or a published **maximum shown as an upper bound, never as a prediction**. Tiered, unknown, varies-by-institution, incomplete or wrong-currency rows produce **no number** and say why. Rows not yet or no longer in effect are reported as such. Source label, link (https only), validity date and the row's note are always shown. Per-transaction and daily limits produce a warning only.

## Provider tariffs (added 2026-11-19, migration `20270107000000_provider_tariffs.sql`)
MTN and Airtel are `service_providers`, not payment networks, so `route_fees` had nowhere to hold a MoMo tariff and no tier storage. Two small tables now do: `provider_tariffs` (provider + payment type + recipient scope + currency + validity window + **mandatory source label** + optional https link) and `provider_tariff_tiers` (inclusive amount bands in minor units, each fixed / percentage / no fee, with optional min/max fee clamps). **The migration seeds no tariff.** Safety rules, enforced by the database:
- **Invisible until verified.** Clients read only tariffs with `verified_at` set, and only their tiers; drafts exist only for the service role.
- **Verification needs evidence:** a source label on every tariff, and at least one tier before `verified_at` can be set.
- **Verified means frozen:** tiers cannot be inserted, changed or deleted, and the tariff's provider/type/scope/currency/window/source cannot change. To correct: clear `verified_at` (it disappears from clients), fix, verify again.
- **No overlapping bands** (gaps are allowed and reported as "outside the published bands" - never interpolated). Writes are service-role only.
The calculator turns the band containing the amount into a number with the same exact rules as a published schedule; the page shows one line per recipient scope with its source, validity and the date it was checked. With no verified tariff there is no provider choice and no section at all. `GET /api/mobile/fees/estimate` takes `provider=<slug>` and returns `provider_tariff`. See `fee-tariff-intake.md` for what to supply and how a tariff is loaded.

## Menu entry
"Estimate a fee" is in More > Pay & Services, shown only when `FEE_CALCULATOR_ENABLED` (+ allowlist) and the Pay gate cover the workspace. Still no mobile screen.

## Deliberately not built
- **No comparison of one transfer versus several smaller ones, in this calculator.** It reports a fee and warns about limits; it never proposes parts (a unit test and the e2e spec check its output contains no such text). **Superseded for Pay (2026-11-23):** splits are now offered in Pay - see `docs/pay-splits.md` - for an eKash amount above the network capacity, and as an opt-in fee saving once a verified tariff exists.
- Institution-level (per-bank route) fee overrides: only network scope is read. The existing route pages show route fees.
- **Any MTN/Airtel figure.** The tariff model exists; the data does not, and it is not invented. It arrives from a verified, source-cited seed migration (`fee-tariff-intake.md`).

## Files
| Path | Purpose |
|---|---|
| `web/lib/fees/fee-estimate.ts` | Pure: published estimate, schedule picking, limit warnings, history estimate, exact input parsing |
| `web/lib/fees/fee-result.ts` | Pure: one builder + JSON serializer used by the page **and** the API |
| `web/lib/fees/fee-data.ts` | Server loaders (session client, RLS): network fees/limits, history, viewer timezone |
| `web/app/pay/fees/page.tsx` (+ `loading.tsx`) | The page: a plain GET form, URL is the state |
| `web/app/api/mobile/fees/estimate/route.ts` | The contract endpoint (docs/oneledger-3/contracts.md) |
| `web/app/pay/networks/[slug]/page.tsx` | "Estimate a fee for an amount" link when the flag is on |
| `web/lib/oneledger3-flags.ts` | `FEE_CALCULATOR` added |
| `web/lib/fees/fee_estimate_test.ts`, `web/e2e/fees.spec.ts` | Tests |

## Rules it keeps
- Money is bigint minor units with explicit currency; no float touches an amount; a fraction a currency cannot hold is refused, not rounded; zero/negative refused; currencies other than RWF/EUR/USD are refused (decimal places unknown).
- Read through the caller's session: the network data is public reference data; the history is the active workspace's ledger only, and in a household only the sources the caller may see. No counterparty is read or shown.
- A failed read shows an error state, never an estimate from a partial read. History reads at most the newest 1,000 matching payments and says so when capped.
- Privacy mode masks amounts, like the dashboard.
- Always shown: "These are estimates, not guarantees… OneLedger does not charge this fee and does not move money."

## Known limits
- History assumes the fee scales with amount only roughly: "similar" is ±20%. Fee bands narrower than that can give a range wider than the true fee for one amount; the recent-payments table shows why.
- The history estimate reflects *past* tariffs; the page says the provider may have changed them.
- No mobile screen yet; the API is ready for one.
- Only outgoing types listed in `FEE_TRANSACTION_TYPES`; incoming payments carry no sender-paid fee.

## Verification
- `deno test web/lib`: 1077 pass (15 new: published fixed/none/maximum, tiered/unknown/varies give no number, percentage exact maths incl. beyond 2^53 and clamps, validity window and currency, schedule choice, limits warn without alternatives, history window edges at exactly ±20%, mixed fees and ties, too-little history, exact amount parsing, hostile query input, result builder and JSON-safety).
- `tsc --noEmit`, `eslint`: clean.
- **Not run locally:** any render (no Docker). `e2e/fees.spec.ts` (empty state, hand-computed estimate from seeded payments with its evidence rows, too little history, invalid amount, eKash upper bound with source, above-maximum warning with no workaround, link from the network page, axe at desktop and phone width, and the API with a bearer token including bad input and an unknown network) runs in this PR's CI.
- **Not verified:** non-RWF history, a household with unshared sources, real devices, any real MoMo fee pattern.

## Rollout
`FEE_CALCULATOR_ENABLED=true` with `FEE_CALCULATOR_WORKSPACE_ALLOWLIST=<workspace id>`; redeploy; compare the history estimate with a few real recent payments. Rollback: unset the flag.
