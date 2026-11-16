# S6a — Insights Center web page (2026-11-16)

Workstream A, web surface. Stacked on the S2 calculation core (PR #195). **Dark**: both routes render the app 404 unless `INSIGHTS_CENTER_ENABLED=true` (optional `INSIGHTS_CENTER_WORKSPACE_ALLOWLIST`, comma-separated workspace ids). No migration. Not enabled in any environment.

## What it adds

| Path | Purpose |
|---|---|
| `web/app/insights/page.tsx` (+ `loading.tsx`) | Overview: period and filters, money in / out / net with previous-period comparison, categories with share, wallets, people and merchants, trend, exclusions, freshness |
| `web/app/insights/transactions/page.tsx` | Drill-down: the transactions behind any figure |
| `web/lib/insights/insights-data.ts` | Server loader (session client, RLS) |
| `web/lib/insights/insights-params.ts` | Pure: URL validation, period arithmetic, drill-down links |
| `web/lib/insights/insights-facts.ts` | Pure: row → fact mapper, bigint formatting, comparison coverage |
| `web/lib/insights/insights-flag.ts` | Pure: rollout gate |
| `web/components/insights/*` | Filter form (plain GET, no client JS), privacy-aware amount |
| `web/lib/queries.ts` | `getTransactionsByIds` (display rows for a drill-down) |
| `web/app/reports/page.tsx` | "Insights" link in the header, only when the flag is on |
| `web/e2e/insights.spec.ts`, `web/lib/insights/insights_page_test.ts` | Tests |

There is deliberately **no navigation entry** in this slice: the More menu and bottom nav have visual baselines, and placement is a product decision. The only entry point is the link on Reports.

## Rules the loader enforces

1. **Active workspace only.** RLS returns rows for every workspace the caller belongs to, so the loader also filters `workspace_id` to the active one. RLS (`transactions_select_member`) already applies per-Space source visibility for household members, so the page shows a member only what they may see.
2. **No partial totals.** PostgREST returns at most 1,000 rows per request. Transactions *and* transfer links are paged with a stable order (`occurred_at, id` / `id`). Any query error, or more than 50,000 rows in the period plus its comparison window, produces an explicit "can't total this reliably" state and no numbers. A truncated transfer-link list would otherwise count own-wallet transfers as income and spending.
3. **Unknown is not zero.** A row is excluded, and counted in an on-page notice, when its settlement is unknown/null, it was reversed, or it is settled but the accounting engine has not computed its effect (`principal_effect_rwf`/`fee_effect_rwf` null). `Number(null)` is `0`, so the mapper tests for null explicitly.
4. **One canonical instant format.** The core compares instants as strings; PostgREST returns `+00:00` and the period bounds are `Z`. The mapper normalises every `occurred_at`, otherwise a transaction exactly on local midnight lands in the wrong day.
5. **Periods are local calendar dates.** From/To are inclusive; the window ends at local midnight after the To date in the viewer's `profiles.timezone` (fallback `Africa/Kigali`), computed with `report-period.localMidnightUtc` so DST days keep their real length.
6. **Comparison.** Against the equal-length window immediately before. If the workspace has no transaction before the current period, the comparison is absent ("No earlier activity to compare with"), never "up from 0". If records begin partway through the comparison window, it is labelled incomplete. A change from zero shows the amount but no percentage.
7. **Drill-down parity.** The drill-down page selects rows with the same `applyDrilldown`/`classify` the totals use, from the same loader. Links always carry explicit dates, so a shared link means the same period later. The list is capped at 200 rows for display; the count is not capped.
8. **Currencies are never mixed.** One block per currency, no conversion.

## Known differences from other surfaces (not blanket parity)

Insights follows the S2 rules, which differ from Home, category totals and the daily report in these documented ways:

- **Refunds/reversals** reduce money out (and their category); Home and reports count an inbound refund as money received.
- **Fees on money received** are counted as money out under "Fees"; reports net them into received.
- **Cash withdrawals** are shown as their own "Cash out" line regardless of category.
- **Pending and failed** rows are listed separately; other surfaces ignore everything that is not settled.
- **Period**: Insights uses the viewer's timezone; Home "today" is fixed to Kigali.

For a period with only plain settled income and spending, Insights equals `report-math` (asserted in `insights_math_test.ts`). Statement (PDF) parity is **not yet checked**.

## Known limits

- "Wallet" is the financial source (`transactions.financial_source_id`), the same key the Transactions filter uses. Rows without one are shown as "Not linked to a wallet" so the table still adds up. The filter takes one wallet in the UI (the URL accepts several).
- People and merchants are grouped by the name written on the transaction (labelled as such on the page) until the S4 counterparty layer is merged; top 10 are shown.
- Amounts are whole currency units (the ledger's legacy `*_rwf` integer columns); there is no minor-unit scale yet.
- The trend lists only buckets that have counted activity.
- Privacy mode masks amounts in the page, as on the dashboard; counterparty names and counts are not masked (same as Transactions).
- The wallet filter list and the excluded-rows count are not narrowed by the other filters.
- Not built here: mobile screen, `/api/mobile/insights/*`, recurring-payment section, transaction-type filter, a nav entry, CSV export.

## Verification

- `deno test --config web/lib/deno.json web/lib`: pass (includes 14 new tests: hostile query input, DST/Kigali windows, boundary instant, null-effect handling, a hand-computed rows → figures fixture with drill-down reproduction and wallet remainder).
- `tsc --noEmit`, `eslint`: clean. `next build --webpack`: compiles (local build then stops collecting page data for an unrelated cron route because no Supabase env is set locally).
- **Not run locally:** rendering against a database — Docker was not available in this session. The Playwright spec (`insights.spec.ts`: exact seeded totals, category drill-down, empty period, malformed link, axe scan) runs in CI against the disposable Supabase stack; see the PR's e2e check for the result.
- **Not verified:** real devices, a household Space with restricted sources, more than 1,000 rows in a period against a real PostgREST, production data.

## Rollout

Set `INSIGHTS_CENTER_ENABLED=true` with `INSIGHTS_CENTER_WORKSPACE_ALLOWLIST=<workspace id>` in Vercel, redeploy, compare a month against the same month's statement, then widen. Rollback: unset the flag and redeploy; there is no data to undo.
