# Phase 1 financial contract

Implementation evidence: 2026-11-19, local branch `codex/phase1-foundation`, base `24247b3`. This extends existing accounting facts; it does not replace ingestion, reconciliation, budgets, or payment settlement.

## Amounts and currencies

`shared/financial.ts` is framework-free and imported by web and native. Amounts are signed integer minor units. Legacy columns ending `_rwf` are interpreted with each row's currency, not implicitly converted to RWF. RWF has scale 0; USD and EUR have scale 2. The golden formatting vectors are RWF 1,234, USD 12.34, EUR 12.34 for 1,234 minor units. Arithmetic uses bigint, rejects unsafe numeric inputs, and rejects unsafe aggregate conversion to number. Unsupported currencies or missing authoritative effects are unavailable, never guessed zero. Existing database values are preserved.

New Home/lifetime flows group by currency. Legacy RWF compatibility properties contain only RWF facts. Categories and existing generated RWF reports remain explicitly RWF-only. There is no FX model or invented exchange rate. Native wallet displays now name USD/EUR explicitly.

## Activity versus balances

Only settled, non-merged financial activity contributes to actual flows. Failed local work is excluded; pending/failed/reversed settlement states do not inflate actuals. Principal and fee effects come from existing server accounting facts. Linked transfers and counterparties resolving through merge ancestry to `self` are excluded from income/spending. The established web rule excludes the transfer's fee from these flow totals too; this patch does not approve a new transfer-fee expense policy. Real movements and fees remain in wallet balance accounting.

`financial_activity_v` is security-invoker and derives `is_own_transfer` from links and self ancestry under caller RLS. The native snapshot carries the same classification; React screens do not independently infer transfers. API People contract 2 preserves `self`; contract 1 retains the existing compatible person representation.

Provider/manual balance observations and subsequent activity continue through the existing wallet derivation contract. A manual observation is labeled as entered by the user. Cached wallet evidence is marked stale with as-of information. Unavailable does not acquire a numeric balance. A pending category-only edit of an already known transaction does not add its monetary effect again to local balance estimates.

## Completeness and failures

`completePages` continues until an empty response, even when a deployment silently caps pages below the requested size. Stable ID ordering is used for affected Home/lifetime, transfer and own-counterparty lookups, report reads and Insights reads. The general safety ceiling is 100,000 rows; exceeding a ceiling throws an explicit unavailable error rather than publishing a partial total. Insights retains its lower 20,000 ceiling and fails when exceeded; this is not unlimited historical Insights support. Category aggregation retains its coverage metadata and the page now renders an incomplete-data notice.

Primary affected financial failures throw to error boundaries/retry UI. Optional Home review/capture widgets can fail independently of cached ledger facts. This is not a claim that every historical query in the repository has been converted; non-financial notification counts still have legacy fallback behavior.

## Golden facts and evidence limits

`shared/financial-fixtures.json` supplies currency/transfer/state vectors. `shared/golden-acceptance.ts` supplies synthetic facts for two Spaces, five wallets, roles, shared/private sources, 20,001 household entries, category splits, budget/goal facts, revocation expectations and Kigali boundaries. Web Deno and native Jest both consume the shared contract; pagination tests cover 999/1,000/1,001/20,001 rows under an artificial 137-row server cap.

These are domain and adapter-ready acceptance fixtures. They are not yet one fully seeded Supabase HTTP dataset comparing every wallet, budget, Insight and device screen. SQL fixtures independently exercise the actual migration/RLS boundaries. The complete cross-platform integration comparison remains a release gate. No shared TypeScript result proves Android or iOS device behavior.
