# S10 — Transfer fee calculator (2026-11-18)

Workstream E (Payment utilities), spec §9 "Transfer fee intelligence". **Dark**: `/pay/fees` renders the app 404 and `GET /api/mobile/fees/estimate` answers 404 unless `FEE_CALCULATOR_ENABLED=true` (optional `FEE_CALCULATOR_WORKSPACE_ALLOWLIST`) **and** the Pay & Services gate covers the workspace. No migration. Not enabled anywhere.

## What the data actually supports (and so what this does)
The spec asks for "versioned, source-attributed fee schedules". The repo has the table (`route_fees`: dated, with source label/URL, types fixed / percentage / tiered / none / unknown / varies / published_maximum) but **very little data**: the only seeded fee is eKash's published *maximum* of RWF 20, and **no MTN or Airtel tariff is stored anywhere**. `route_fees` can say a fee is "tiered" but stores no tiers. A calculator that returned a number for MoMo from this would be inventing it. So it uses two separate kinds of evidence and never blends them:

1. **What you have actually paid** — the fees charged on your own past settled outgoing payments of the same type and currency, within ±20% of the requested amount, read from the ledger (`fee_rwf`, from the provider's own SMS). With ≥3 similar payments it shows the observed range, the usual fee if ≥60% paid the same one (ties go to the larger, never understating), the date span, and the most recent matching payments so every figure traces to rows. With fewer it says so and shows nothing.
2. **What a network publishes** (optional, network-scope rows only) — fixed fee, no fee, percentage (exact integer maths: whole-unit floor..ceiling, clamped to published min/max), or a published **maximum shown as an upper bound, never as a prediction**. Tiered, unknown, varies-by-institution, incomplete or wrong-currency rows produce **no number** and say why. Rows not yet or no longer in effect are reported as such. Source label, link (https only), validity date and the row's note are always shown. Per-transaction and daily limits produce a warning only.

## Deliberately not built
- **No comparison of one transfer versus several smaller ones.** The spec forbids automating splits to get around provider limits or rules; nothing computes, suggests or hints at one (a unit test and the e2e spec check the output contains no such text outside the disclaimer).
- Institution-level (per-bank route) fee overrides: only network scope is read. The existing route pages show route fees.
- Any MTN/Airtel tariff table. If the owner supplies a verified, source-attributed tariff, it should go in `route_fees` through the directory admin tools (needs a `payment_network` row for the provider and, for tiered fees, a tier table — a migration), after which this calculator picks it up.

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
- Always shown: "These are estimates, not guarantees… OneLedger does not charge this fee, does not move money, and will not suggest splitting a payment to get around a limit."

## Known limits
- History assumes the fee scales with amount only roughly: "similar" is ±20%. Fee bands narrower than that can give a range wider than the true fee for one amount; the recent-payments table shows why.
- The history estimate reflects *past* tariffs; the page says the provider may have changed them.
- No More-menu or bottom-nav entry in this slice (placement is a product call; both have baselines); entry is the link on a network page and the URL.
- No mobile screen yet; the API is ready for one.
- Only outgoing types listed in `FEE_TRANSACTION_TYPES`; incoming payments carry no sender-paid fee.

## Verification
- `deno test web/lib`: 1077 pass (15 new: published fixed/none/maximum, tiered/unknown/varies give no number, percentage exact maths incl. beyond 2^53 and clamps, validity window and currency, schedule choice, limits warn without alternatives, history window edges at exactly ±20%, mixed fees and ties, too-little history, exact amount parsing, hostile query input, result builder and JSON-safety).
- `tsc --noEmit`, `eslint`: clean.
- **Not run locally:** any render (no Docker). `e2e/fees.spec.ts` (empty state, hand-computed estimate from seeded payments with its evidence rows, too little history, invalid amount, eKash upper bound with source, above-maximum warning with no workaround, link from the network page, axe at desktop and phone width, and the API with a bearer token including bad input and an unknown network) runs in this PR's CI.
- **Not verified:** non-RWF history, a household with unshared sources, real devices, any real MoMo fee pattern.

## Rollout
`FEE_CALCULATOR_ENABLED=true` with `FEE_CALCULATOR_WORKSPACE_ALLOWLIST=<workspace id>`; redeploy; compare the history estimate with a few real recent payments. Rollback: unset the flag.
