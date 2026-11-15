# Finding: linked self-transfers are counted as income and spend outside budgets

Status: **CONFIRMED in source** (not observed on production data). Severity: High for acceptance criteria 3 & 4 (cross-surface parity, no transfer double counting). Date 2026-11-15.

## Evidence
- Linking a transfer only inserts a `transfer_links` row (`web/app/transactions/transfers/actions.ts:20,47`); it does not change either transaction's direction, category or settlement.
- Only `getBudgetActuals` consults `transfer_links` (`web/lib/queries.ts:1555-1601`) and drops linked ids.
- No transfer exclusion in: `getTodayTotals` (`queries.ts:120-140`), the category-totals query (~`queries.ts:740`), `fetchSettledTransactions` for reports/emails (`report-generation.ts:163-185`, columns at `:131`), nor `statement-generation.ts` / `statement-math.ts` (no reference to transfer_links). No category-based exclusion exists either (no "Transfer" special-casing found).
- Reproduced at unit level: test "finding: legacy report snapshot counts a linked transfer pair…" — a 30,000 RWF linked pair yields received 30,000 and spent 30,000 in `computeFinancialSnapshot`, 0/0 in the insights core.

## Impact
For a user who links transfers between own wallets: Home "today" totals, daily report/email money-in/out, category percentages and trends are inflated by the transferred amount on both sides, while Budgets are correct, so the numbers disagree across surfaces. Net movement is unaffected (the pair cancels), which can hide the issue.

## Nuance
Account **statements** are per-account records; showing a transfer leg there is correct. What must differ is the *summary* (income/spend) treatment: statements should label such rows "Transfer" and exclude them from income/expense totals, not from the ledger listing. Needs product decision.

## Proposed fix (needs your approval — changes customer-visible numbers)
1. Add a shared `fetchLinkedTransferIds(workspaceId, range)` and filter in `getTodayTotals`, category totals, and `report-generation` (or route all through `lib/insights`).
2. Statements: keep rows, exclude from summary totals, add "Transfers" line.
3. Regression: fixtures asserting dashboard == report == email == budgets for a workspace with a linked pair; note one-time visible change to historical report figures; do not regenerate already-delivered reports.
4. Unlinked-but-detected pairs remain counted until the user confirms the link (existing "heuristic only" rule).

## Resolution (2026-11-15, same branch)
Fixed for **Home totals** (`getTodayTotals`), **category totals** (`getCategoryTotals`) and **reports/emails** (`fetchSettledTransactions` in `report-generation.ts`, which feeds every report figure incl. trends/alerts) via the shared pure helper `web/lib/transfer-exclusion.ts` (+ `transfer_exclusion_test.ts`). Report path throws if the link lookup fails (never silently inflates a delivered report); Home/category fall back to the old behaviour and log.
Verified: `deno test web/lib` (833 pass); `tsc` reports no errors in touched files (unrelated pre-existing errors: generated `PageProps` types and brand PNG module declarations).
**Not verified:** the Supabase query wiring itself (no DB run; only the pure filter is unit-tested); e2e/Playwright not run.
**Still open:** (a) statements (`statement-generation.ts`) unchanged — needs the product decision above; (b) household members who cannot see one transfer leg are still excluded from the visible leg (treated as intra-household transfer) — confirm; (c) other surfaces not audited: `getLifetimeFlowTotals`, mobile screens, `/api/v1`, Inbox forecast.
Visible effect: Home/report/category figures drop by the amount of confirmed transfer pairs; delivered reports are not regenerated.
