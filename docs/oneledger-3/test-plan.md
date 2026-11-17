# OneLedger 3.0 — Test plan (S1)

Runner conventions (existing): pure logic → Deno tests (`web/lib/*_test.ts`, `supabase/functions/*/tests`); DB → `supabase/migrations/tests/run_migration_tests.sh`; web E2E → Playwright (`web/e2e`); mobile → `oneledger-mobile` jest/CI `mobile.yml`. CI already runs deno fmt/lint/check/test; add the new suites to `ci.yml`.

| Layer | Required tests |
|---|---|
| Insights unit/property | fixture catalog `web/lib/insights/fixtures/*.json` with exact expected totals; property tests: net = in−out, partition by category sums to total, transfers excluded, refund/fee rules, idempotent recompute, bigint no-float |
| Boundaries | month/day edges in Africa/Kigali; non-Kigali profile tz; DST transition (traveller) |
| Parity | same scope/period → identical totals from insights module, `statement-math`, `report-math`, PDF snapshot, daily email, mobile API (golden test) |
| Drill-down | for each aggregate, drilldown filter → rows sum equals aggregate |
| Balance | confirmed/estimated/stale/unavailable matrix; missing SMS gap, reversal, unknown opening balance; manual reconcile audit |
| Counterparty | same name ≠ merge; multi-number person; merge → undo restores; cross-workspace isolation; idempotent backfill |
| Payment requests | token entropy/hash, expiry, revoke, replay, tamper QR, public view leaks nothing, no paid transition from public |
| Authz/RLS | two-tenant and revoked-member tests per new table/RPC (migration suite) |
| Parser | MTN variants, Airtel anonymised fixtures (**blocked: need samples**), duplicate SMS with formatting differences, out-of-order, missing balance, corrections, Cash Power enrichment redaction |
| Migration | pre/post count + sum parity, rerun idempotency, interrupted backfill resume |
| E2E | web: overview→drill-down→transaction→correct category→totals change; mobile: same on device farm/real devices (emulator ≠ sign-off) |
| A11y/perf | axe on new pages; chart always paired with list; 100k-txn aggregate query budget (baseline first, SLO after) |
| Regression | PDF statements and daily email snapshots unchanged unless intended |
Skipped checks must be listed in the PR and final report.
