# S2 — Insights calculation core (2026-11-15)

**Delivered:** `web/lib/insights/insights-math.ts` (pure, bigint minor units, basis-point percentages) + `insights_math_test.ts` (12 tests incl. hand-computed fixture, drill-down reproduction, report-math parity, Kigali and New_York DST boundaries, 300 seeded random datasets, no-float guard). Picked up by CI's existing `deno test --config web/lib/deno.json web/lib`; full web/lib suite passes locally. **Not wired into any page, API, report or email yet** — no behaviour changes, no migration, no flag needed.

Rules implemented: linked transfers excluded (I2); pending/failed separated; refunds/reversals reduce spend and are never income (I3); cash withdrawals reported as own "Cash out" bucket with `consumptionOut` (I4); inbound fees counted once as outflow under "Fees"; per-currency blocks, never mixed; drill-down filters reproduce contributing rows through the same `classify` (I5); deterministic (I6); `compare` returns null (not 0) with no history.

## Finding to confirm (potential parity defect, existing code)
`getBudgetActuals` (`web/lib/queries.ts:~1555-1595`) excludes `transfer_links.status='linked'` rows from income/spend, but `fetchSettledTransactions` in `web/lib/report-generation.ts` (feeds reports/emails) filters only `settlement_state='settled'` and `dedupe_state<>'merged'` — no transfer exclusion found there. If confirmed, report/email totals include own-account transfers as income and spend, disagreeing with budgets (acceptance criteria 3 and 4). Not changed in S2 because it alters customer-visible report numbers and needs your approval; statement path (`statement-math.ts`) not yet checked.

## Known limits
- Counterparty grouping uses `counterparty_id` if present else lower-cased name (names-only = low confidence until S4).
- Refund is attributed to the refund row's own category (no link to the original purchase exists yet).
- Percentages truncate (76.54% → 7654 bps); a category can go negative if refunds exceed its spend.
- Inputs are still legacy `*_rwf` facts; a `transactions_money_v` view is deferred.
