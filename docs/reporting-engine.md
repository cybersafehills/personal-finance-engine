# Scheduled Financial Reporting engine

The Daily Financial Report: a persisted, per-user financial snapshot generated once per configured local day and optionally emailed each morning. Documents the system as implemented (Phases B–G), not the original 89-section master prompt verbatim — see git history (`610a774` onward, branch `feat/phase-c-multi-account-ingestion`) for how it evolved, and `supabase/scheduling/README.md` for the one piece (scheduler activation) that is deliberately NOT yet live.

## Where each piece lives

| Concern | Location |
|---|---|
| Schema, RLS | `supabase/migrations/20260902000000_phase_j_reporting_foundation.sql` |
| Timezone/period-boundary math | `web/lib/report-period.ts` |
| Deterministic calculation engine | `web/lib/report-math.ts` (financial facts) + `web/lib/budget-math.ts` (budget-vs-actual, reused unchanged) |
| JSON-safe report payload shapes | `web/lib/report-types.ts` |
| Report generation (service-role) | `web/lib/report-generation.ts`, invoked via `web/app/api/cron/generate-reports/route.ts` |
| Email delivery (service-role) | `web/lib/report-delivery.ts`, `web/lib/emails.ts`'s `sendDailyReportEmail`, invoked via `web/app/api/cron/deliver-reports/route.ts` |
| Alert-to-sentence text (shared by UI and email) | `web/lib/report-alert-messages.ts` |
| Reports UI | `web/app/reports/**` |
| Reporting preferences UI | `web/app/settings/reports/**` |
| Scheduler activation (manual, not yet applied) | `supabase/scheduling/**` |

## Pipeline

```
transactions (settled) + budgets + prior report_runs
        │  (explicit workspace_id/user_id scoping - service role bypasses RLS)
        ▼
report-generation.ts: fetch facts, call report-math.ts + budget-math.ts
        ▼
report_runs row (immutable JSON snapshot, status='generated')
        │
        ├──▶ Reports UI reads report_runs directly (session-scoped, RLS-enforced)
        └──▶ report-delivery.ts: render via emails.ts, send via Resend
                    ▼
              report_deliveries row + report_runs.status → 'delivered'/'delivery_failed'
```

The structured `report_payload` is the source of truth. The UI and the email are both renderers of it — neither recalculates a financial value (see `report-generation.ts`'s and `emails.ts`'s own module comments).

## Reporting-period semantics

A daily report's `period_start`/`period_end` always span one **complete local calendar day** in the report's own configured timezone — `[local midnight, next local midnight)`, a half-open interval. Generation runs shortly after local midnight (default `00:05`, configurable per user) and covers the day that just ended, not a literal 23:00 cutoff (which would exclude the day's own final hour). `report-period.ts`'s `localMidnightUtc`/`dailyReportPeriod` resolve this correctly for any IANA timezone, including across DST transitions (two-pass `Intl.DateTimeFormat` offset measurement — see that file's tests for the exact cases covered).

Every user's `timezone` is denormalized onto `report_preferences` and again onto each `report_runs` row at generation time, so a later timezone change never retroactively reinterprets a historical report's boundaries.

## Idempotency and concurrency

- **Generation**: `report_runs_unique_period unique (workspace_id, user_id, report_type, period_start)`. `generateDailyReportForCandidate` checks for an existing row first (cheap short-circuit for repeat ticks after the day's report already exists), then inserts; a `23505` unique-violation on insert (a concurrent worker won the race) is treated as success, not an error.
- **Delivery**: `report_deliveries_unique_send unique (report_run_id, channel, destination)`, same pattern. Failed sends retry with a bounded budget: max 5 attempts, minimum 10 minutes between attempts (`MAX_DELIVERY_ATTEMPTS`/`MIN_RETRY_INTERVAL_MS` in `report-delivery.ts`).
- Both due-work queries (`isGenerationDue`/`isDeliveryDue`) have no upper time bound — a late or resumed cron tick correctly catches up a missed generation/delivery rather than silently skipping it, relying entirely on the existence checks above to avoid redoing already-finished work.

## Deterministic calculation rules

Everything here is pure, dependency-free TypeScript, unit-tested with `deno test` (`web/lib/report_math_test.ts`, `report_period_test.ts`, `report_alert_messages_test.ts`, `budget_actuals_allocation_test.ts` — 194 tests total across `web/lib`).

- **Financial snapshot** (`computeFinancialSnapshot`): opening/closing balance come from the canonical `balance_after_rwf` column, never recomputed; `null` when no trustworthy value exists yet, never fabricated. Received/spent/fees/net movement/largest in/out are summed from settled transactions only.
- **Category totals** (`computeCategoryTotals`): outgoing transactions only, explicit `"Uncategorized"` bucket for null/blank categories.
- **Budget section**: reuses `budget-math.ts`'s `computeAllocationActual`/`computeBudgetAlerts`/`computeElapsedFraction` unchanged, and `aggregateOutflowsByAllocation` (extracted from the pre-existing budget dashboard's `getBudgetActuals` so both surfaces share one classification implementation). RWF only — see the Phase D budgets migration's own note on why live actuals only ever exist for RWF today. `overallStatus: "no_active_budget"` when the workspace has no active RWF budget.
- **Trends** (`computeTrends`): today vs. the rolling average of up to 7 prior *generated* reports (reused as a cache, not re-queried from raw transactions). `null` comparison values print no percentage — never a fabricated 0% or an infinite% against a zero baseline.
- **Alerts** (`computeReportAlerts`): six deterministic kinds — `large_transaction`, `high_daily_spend`, `elevated_fees`, `low_balance`, `sustained_negative_cashflow`, `excessive_uncategorized`. Thresholds are fixed module-level defaults in `report-generation.ts`'s `DEFAULT_ALERT_THRESHOLDS` today (RWF 100k/200k/5k/10k, 3 consecutive days, 50% uncategorized) — **not yet a stored per-user preference**; see Known limitations.
- **Forecast** (`computeMonthEndForecast`): month-to-date spend ÷ days elapsed × days remaining, always labeled with a disclaimer that it's a projection, never a guarantee.

## Email delivery

`sendDailyReportEmail` (`lib/emails.ts`) renders a concise summary — closing balance, received/spent/fees/net, budget status lines, watch-out lines, a link to the full in-app report — as both HTML and a genuine plain-text alternative. No PDF attachment (deliberate V1 scope cut, see Known limitations). It performs no calculation of its own; every number/line it receives is pre-computed by `report-delivery.ts` from an already-generated `report_payload`.

## Scheduler

**Not yet activated in production.** See `supabase/scheduling/README.md` for the full prerequisite → activation → verification → rollback sequence. In short: `pg_cron`/`pg_net` require `shared_preload_libraries` at Postgres startup, which the disposable test Postgres can't provide, so the activation SQL lives outside `supabase/migrations/` and is applied by hand, once, when ready.

Once activated: two independent 5-minute-interval jobs POST to `/api/cron/generate-reports` and `/api/cron/deliver-reports`, authenticated via a shared secret (`REPORT_CRON_SECRET`, constant-time-compared in `lib/cron-auth.ts`) read from Supabase Vault. Precision guarantee: due work is discovered within 5 minutes of a user's configured local time, not exact-minute.

### Kill switches

Two independent operational flags, both default-enabled (see `web/.env.local.example`):

- `REPORT_GENERATION_ENABLED=false` — pauses new report generation; already-generated reports are untouched and remain viewable.
- `REPORT_EMAIL_DELIVERY_ENABLED=false` — pauses email sends only; reports keep generating and stay viewable in-app.

Neither touches `pg_cron` or any report data — the tick still runs (and returns `{disabled: true}`), it just does nothing.

## Security notes (reviewed for this feature)

- **Tenant isolation**: `report_runs`/`report_deliveries`/`report_preferences` RLS is `user_id = auth.uid() AND is_workspace_member(workspace_id)` — stricter than the shared-ledger tables (accounts/transactions), since a report is a personal delivery artifact, not workspace-wide data. Proven by the migration test suite's cross-tenant RLS tests (`supabase/migrations/tests/run_migration_tests.sh`, "Phase J: reporting RLS" section).
- **Service-role scoping**: `report-generation.ts`/`report-delivery.ts` use the service-role client and explicitly filter every query by `workspace_id`/`user_id` read from a trusted `report_preferences` row — RLS does not apply to this client, so this explicit filtering *is* the security boundary.
- **Cron auth**: both routes require a constant-time-compared shared secret header (`lib/cron-auth.ts`) — never a user session.
- **No client-bundle leakage**: neither `report-generation.ts` nor `report-delivery.ts` (both `server-only`, both use the service-role key) is imported by any `"use client"` component — confirmed by grep across `web/components`/`web/app`.
- **No HTML/XSS injection surface**: the email HTML template never interpolates raw user-controlled text (merchant/counterparty/category names) — every alert sentence (`report-alert-messages.ts`) is built from fixed labels and formatted numbers only. The Reports UI is plain JSX, auto-escaped by React.
- **No PDF/artifact storage** exists yet, so no signed-URL or bucket-privacy surface to review.

## Operational monitoring

No new logging/observability product was introduced (per the master prompt's own "do not build another logging product" guidance) — health is checked via the data model itself and, once scheduling is activated, `pg_cron`'s own tables:

```sql
-- Report generation/delivery health over the last 24h
select status, count(*) from public.report_runs
where created_at > now() - interval '24 hours' group by status;

-- Delivery failures needing attention
select id, report_run_id, attempt_count, error_code, last_attempt_at
from public.report_deliveries where status = 'failed' order by last_attempt_at desc;

-- Scheduler run history (after supabase/scheduling/activate_report_scheduler.sql)
select * from cron.job_run_details order by start_time desc limit 20;
```

Cron route failures/partial failures are logged via `console.error` with only operational identifiers (candidate/report IDs and error messages) — never raw financial content.

## Environment variables

See `web/.env.local.example` for the authoritative list with full context: `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (existing, reused), `RESEND_API_KEY`/`RESEND_FROM_EMAIL` (existing, reused), `SITE_URL` (existing, reused for the report link), `REPORT_CRON_SECRET`, `REPORT_GENERATION_ENABLED`, `REPORT_EMAIL_DELIVERY_ENABLED` (new).

## Local development and testing

- Pure calculation modules: `cd web/lib && deno test .` (194 tests as of this writing).
- Migration + RLS: `supabase/migrations/tests/run_migration_tests.sh` (spawns a disposable local PostgreSQL 17 cluster; `PFE_PG_MODE=external` for CI-style external targeting).
- Type/build: `npx tsc --noEmit -p tsconfig.json` and `npm run build` from `web/`.
- Manual end-to-end verification (no scheduler required): `curl -X POST http://localhost:3417/api/cron/generate-reports -H "x-report-cron-secret: <REPORT_CRON_SECRET>"`, then the delivery route the same way.

## Known limitations / deferred scope

- **No PDF/document generation** — web report + email summary only. Deferred until real usage justifies the added complexity (headless-browser or `@react-pdf/renderer` rendering, private Storage bucket, signed URLs).
- **No AI enrichment** — `report_preferences.include_ai_analysis` exists in the schema but nothing reads it; no AI provider is wired up. Deferred as its own bounded increment (master prompt Phase I).
- **Alert thresholds are fixed defaults**, not a per-user stored preference — an additive follow-up migration would add threshold columns to `report_preferences`.
- **No "notable transactions" / largest-transaction detail list** in the report UI or email beyond the aggregate largest-inflow/outflow figures already in the financial snapshot — `ReportTransactionFact.counterpartyName` is captured but not yet surfaced anywhere.
- **No manual "Send now" or manual on-demand generation** UI — only the authenticated cron routes trigger generation/delivery today. Deferred per the master prompt's own permission to omit it from V1.
- **Weekly/monthly/organization reporting** are not implemented — `report_runs.report_type` is constrained to `'daily'` only today, but the column exists so widening the check constraint (not reshaping the tables) is the only change a future increment needs.
- **Multi-currency/multi-account consolidation** is not implemented — reports are RWF-only (matching MoMo ingestion being the only transaction source today).
- **Reconciliation status** is deliberately excluded from reports — `balance_reconciliations` remains dormant/unpopulated in production (see that table's own migration comment); showing a reconciliation status here before that's genuinely wired up and verified would be a guessed value.
- **Scheduler is not active in production** — see `supabase/scheduling/README.md`.
