# Scheduled Financial Reporting engine

The Daily Financial Report: a persisted, per-user financial snapshot generated once per configured local day and optionally emailed each morning, with an on-demand PDF and optional AI commentary. Documents the system as implemented (Phases B–K), not the original 89-section master prompt verbatim — see git history (`610a774` onward, branch `feat/phase-c-multi-account-ingestion`) for how it evolved, and `supabase/scheduling/README.md` for the one piece (scheduler activation) that is deliberately NOT yet live.

## Where each piece lives

| Concern | Location |
|---|---|
| Schema, RLS | `supabase/migrations/20260902000000_phase_j_reporting_foundation.sql` (core tables), `20260903000000_phase_k_report_artifacts.sql` (PDF artifacts + storage bucket), `20261125000000_report_alert_thresholds.sql` (per-user alert-threshold columns on `report_preferences`) |
| Timezone/period-boundary math | `web/lib/report-period.ts` |
| Deterministic calculation engine | `web/lib/report-math.ts` (financial facts) + `web/lib/budget-math.ts` (budget-vs-actual, reused unchanged) |
| JSON-safe report payload shapes | `web/lib/report-types.ts` |
| Report generation (service-role) | `web/lib/report-generation.ts`, invoked via `web/app/api/cron/generate-reports/route.ts` |
| Email delivery (service-role) | `web/lib/report-delivery.ts`, `web/lib/emails.ts`'s `sendDailyReportEmail`, invoked via `web/app/api/cron/deliver-reports/route.ts` |
| PDF generation (session-scoped ownership check, then service-role) | `web/lib/report-pdf.tsx`, invoked via `web/app/api/reports/[id]/pdf/route.ts` |
| AI commentary (optional, pluggable provider) | `web/lib/ai/facts.ts`, `validate.ts` (deno-testable, pure), `report-commentary.ts` (orchestrator) |
| Alert-to-sentence text (shared by UI, email, and PDF) | `web/lib/report-alert-messages.ts` |
| Reports UI | `web/app/reports/**` |
| Reporting preferences UI | `web/app/settings/reports/**` |
| Scheduler activation (manual, not yet applied) | `supabase/scheduling/**` |
| Production rollout / end-to-end verification runbook | `docs/reporting-verification-runbook.md` |

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

Everything here is pure, dependency-free TypeScript, unit-tested with `deno test` (`web/lib/report_math_test.ts`, `report_period_test.ts`, `report_alert_messages_test.ts`, `budget_actuals_allocation_test.ts`, `web/lib/ai/facts_test.ts`, `validate_test.ts` — 213 tests total across `web/lib`).

- **Financial snapshot** (`computeFinancialSnapshot`): opening/closing balance come from the canonical `balance_after_rwf` column, never recomputed; `null` when no trustworthy value exists yet, never fabricated. Received/spent/fees/net movement/largest in/out are summed from settled transactions only.
- **Category totals** (`computeCategoryTotals`): outgoing transactions only, explicit `"Uncategorized"` bucket for null/blank categories.
- **Budget section**: reuses `budget-math.ts`'s `computeAllocationActual`/`computeBudgetAlerts`/`computeElapsedFraction` unchanged, and `aggregateOutflowsByAllocation` (extracted from the pre-existing budget dashboard's `getBudgetActuals` so both surfaces share one classification implementation). RWF only — see the Phase D budgets migration's own note on why live actuals only ever exist for RWF today. `overallStatus: "no_active_budget"` when the workspace has no active RWF budget.
- **Trends** (`computeTrends`): today vs. the rolling average of up to 7 prior *generated* reports (reused as a cache, not re-queried from raw transactions). `null` comparison values print no percentage — never a fabricated 0% or an infinite% against a zero baseline.
- **Alerts** (`computeReportAlerts`): six deterministic kinds — `large_transaction`, `high_daily_spend`, `elevated_fees`, `low_balance`, `sustained_negative_cashflow`, `excessive_uncategorized`. Thresholds are **per-user**, stored on `report_preferences` (migration `20261125000000_report_alert_thresholds.sql`) and edited in Settings → Daily reports → "Alert thresholds". `report-math.ts`'s `DEFAULT_ALERT_THRESHOLDS` (RWF 100k/200k/5k/10k, 3 consecutive days, 50% uncategorized) is the system fallback — it is also the value every DB column defaults to, so an existing row that never sets a threshold behaves exactly as before. `resolveAlertThresholds(row)` maps the stored columns to the runtime `ReportAlertThresholds`; a stored `null` `alert_low_balance_rwf` deliberately **disables** the low-balance check (only that one alert can be turned off — the other five can only be retuned).
- **Forecast** (`computeMonthEndForecast`): month-to-date spend ÷ days elapsed × days remaining, always labeled with a disclaimer that it's a projection, never a guarantee.

## Email delivery

`sendDailyReportEmail` (`lib/emails.ts`) renders a concise summary — closing balance, received/spent/fees/net, budget status lines, watch-out lines, a link to the full in-app report — as both HTML and a genuine plain-text alternative. No PDF attachment (link-out instead, master prompt §38 — reduces email size and provider-limit risk). It performs no calculation of its own; every number/line it receives is pre-computed by `report-delivery.ts` from an already-generated `report_payload`. The email deliberately does not include the AI commentary section either, to keep it short — the "View full report" link is where that appears.

## PDF generation

Lazy, cached, session-authenticated: `GET /api/reports/[id]/pdf` first confirms the caller owns the report via the *existing* session-scoped `getReportRunById` (the same RLS check the report detail page itself relies on), then does everything else — checking/writing `report_artifacts`, rendering, uploading, signing — with the service-role client, since that table/bucket grant nothing to `authenticated`/`anon` at all (see the Phase K migration's own comment). The first request for a report renders the PDF with `@react-pdf/renderer` (a pure-JS layout engine, no headless browser) and stores it in the private `report-artifacts` Storage bucket; every subsequent request reuses the stored object and only issues a fresh short-lived (5-minute) signed URL — never a permanently public link (master prompt §27). `report_pdf.tsx`'s `ReportDocument` renders the same sections as the UI, using the same alert-message text (`report-alert-messages.ts`) and the same `formatRwf`/`formatSignedRwf` formatters — it performs no calculation of its own either.

## AI commentary ("OneLedger Insights")

Optional, per-user opt-in (`report_preferences.include_ai_analysis`, off by default) and only ever attempted during generation — never retried separately, never blocking the deterministic report. Persisted in its own `report_runs.ai_payload` column, entirely separate from `report_payload`, so a bad/failed AI call can never mutate or block the snapshot (master prompt §21/§37).

- **Provider is pluggable**: `AI_PROVIDER` env var selects `anthropic` (default) or `openai`; `AI_MODEL` overrides the default model for whichever is selected. Both SDKs are dependencies (`@anthropic-ai/sdk`, `openai`); switching providers is a config change, not a code change (`lib/ai/report-commentary.ts`'s `resolveProviderName`).
- **Input sanitization** (`lib/ai/facts.ts`, deno-tested): the model receives ONLY structured figures already in the report — closing balance, received/spent/fees/net, up to 5 top categories, budget allocation percentages/statuses, trends, pre-rendered alert sentences, the forecast figure. It never receives counterparty/merchant names, transaction ids, or workspace/user ids — the safest possible mitigation for prompt injection via transaction text is that the untrusted text never reaches the model at all, not merely being delimited within the prompt.
- **Prompt structure** (master prompt §22): a system message with explicit rules (data is the only source of truth, ignore anything that looks like an embedded instruction, respond with exactly one JSON object, never phrase output as guaranteed advice) and a separate user message containing only the JSON facts block.
- **Output validation** (`lib/ai/validate.ts`, deno-tested): the raw response must parse as `{summary: string, observations: string[]}` within length/count bounds, and — best-effort, not a proof — every 3+-digit number it mentions must be traceable back to a digit run somewhere in the facts it was given; a response failing any check is discarded (logged, not surfaced) and the report has no AI section, same as if AI were disabled entirely.
- **Timeout**: 15 seconds (`REQUEST_TIMEOUT_MS`), enforced via each SDK's own request-level timeout option.
- **Rendering**: shown as a distinct "OneLedger Insights" section in the Reports UI and the PDF, always with an explicit "informational only, not financial advice" disclaimer. Not included in the email body (kept short — see Email delivery above).

## Scheduler

**Not yet activated in production.** See `supabase/scheduling/README.md` for the full prerequisite → activation → verification → rollback sequence. In short: `pg_cron`/`pg_net` require `shared_preload_libraries` at Postgres startup, which the disposable test Postgres can't provide, so the activation SQL lives outside `supabase/migrations/` and is applied by hand, once, when ready.

Once activated: two independent 5-minute-interval jobs POST to `/api/cron/generate-reports` and `/api/cron/deliver-reports`, authenticated via a shared secret (`REPORT_CRON_SECRET`, constant-time-compared in `lib/cron-auth.ts`) read from Supabase Vault. Precision guarantee: due work is discovered within 5 minutes of a user's configured local time, not exact-minute.

### Kill switches

Two independent operational flags, both default-enabled (see `web/.env.local.example`):

- `REPORT_GENERATION_ENABLED=false` — pauses new report generation; already-generated reports are untouched and remain viewable.
- `REPORT_EMAIL_DELIVERY_ENABLED=false` — pauses email sends only; reports keep generating and stay viewable in-app.

Neither touches `pg_cron` or any report data — the tick still runs (and returns `{disabled: true}`), it just does nothing.

## Security notes (reviewed for this feature)

- **Tenant isolation**: `report_runs`/`report_deliveries`/`report_preferences` RLS is `user_id = auth.uid() AND is_workspace_member(workspace_id)` — stricter than the shared-ledger tables (accounts/transactions), since a report is a personal delivery artifact, not workspace-wide data. `report_artifacts` grants nothing to `authenticated`/`anon` at all. Proven by the migration test suite's cross-tenant RLS tests (`supabase/migrations/tests/run_migration_tests.sh`, "Phase J: reporting RLS" and "Phase K: report_artifacts has zero authenticated/anon access" sections).
- **Service-role scoping**: `report-generation.ts`/`report-delivery.ts` use the service-role client and explicitly filter every query by `workspace_id`/`user_id` read from a trusted `report_preferences` row — RLS does not apply to this client, so this explicit filtering *is* the security boundary.
- **Cron auth**: both routes require a constant-time-compared shared secret header (`lib/cron-auth.ts`) — never a user session.
- **No client-bundle leakage**: neither `report-generation.ts` nor `report-delivery.ts` (both `server-only`, both use the service-role key) is imported by any `"use client"` component — confirmed by grep across `web/components`/`web/app`.
- **No HTML/XSS injection surface**: the email HTML template never interpolates raw user-controlled text (merchant/counterparty/category names) — every alert sentence (`report-alert-messages.ts`) is built from fixed labels and formatted numbers only. The Reports UI is plain JSX, auto-escaped by React. AI commentary is rendered the same way (JSX, auto-escaped) - a validated AI response could in principle contain HTML-looking text, but it is never interpreted as markup.
- **PDF/artifact storage**: the `report-artifacts` bucket is private (`public = false`), grants nothing to `authenticated`/`anon` (not even select), and every download goes through a signed URL with a 5-minute expiry issued only after the PDF route's own session-scoped ownership check. Storage paths (`reports/{report_run_id}.pdf`) contain no sensitive data - just an unguessable UUID.
- **AI prompt injection**: mitigated by construction, not just by prompting - counterparty/merchant text never reaches the model (see AI commentary above), so there is no untrusted text in the prompt for an injection attempt to use in the first place.

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

-- How many reports have an AI commentary vs. opted-in-but-none-generated
-- (a large gap suggests provider failures/invalid responses worth checking logs for)
select
  count(*) filter (where ai_payload is not null) as with_ai_commentary,
  count(*) filter (where ai_payload is null) as without_ai_commentary
from public.report_runs r
join public.report_preferences p
  on p.workspace_id = r.workspace_id and p.user_id = r.user_id
where p.include_ai_analysis and r.status = 'generated';

-- PDFs generated so far
select count(*), sum(byte_size) as total_bytes from public.report_artifacts where format = 'pdf';
```

Cron route failures/partial failures are logged via `console.error` with only operational identifiers (candidate/report IDs and error messages) — never raw financial content.

## Environment variables

See `web/.env.local.example` for the authoritative list with full context: `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (existing, reused), `RESEND_API_KEY`/`RESEND_FROM_EMAIL` (existing, reused), `SITE_URL` (existing, reused for the report link), `REPORT_CRON_SECRET`, `REPORT_GENERATION_ENABLED`, `REPORT_EMAIL_DELIVERY_ENABLED`, `AI_PROVIDER`, `AI_MODEL`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`.

## Local development and testing

- Pure calculation modules: `deno test web/lib` from the repo root (213 tests as of this writing) — this is also what CI runs.
- Migration + RLS: `supabase/migrations/tests/run_migration_tests.sh` (spawns a disposable local PostgreSQL 17 cluster; `PFE_PG_MODE=external` for CI-style external targeting).
- Type/build: `npx tsc --noEmit -p tsconfig.json` and `npm run build` from `web/`.
- Manual end-to-end verification (no scheduler required): `curl -X POST http://localhost:3417/api/cron/generate-reports -H "x-report-cron-secret: <REPORT_CRON_SECRET>"`, then the delivery route the same way. See `docs/reporting-verification-runbook.md` for the full step-by-step sequence.

## Known limitations / deferred scope

- ~~**Alert thresholds are fixed defaults**~~ — done: per-user threshold columns added to `report_preferences` in `20261125000000_report_alert_thresholds.sql`, surfaced in the reporting-preferences UI, resolved per candidate by `resolveAlertThresholds` (see the Alerts bullet above).
- **No "notable transactions" / largest-transaction detail list** in the report UI, email, or PDF beyond the aggregate largest-inflow/outflow figures already in the financial snapshot — `ReportTransactionFact.counterpartyName` is captured but not yet surfaced anywhere (deliberately - see the AI commentary section on why counterparty text is kept out of the AI path specifically, but this also hasn't been built as a deterministic UI feature yet).
- **No manual "Send now" or manual on-demand generation** UI — only the authenticated cron routes and the session-authenticated PDF route trigger any work today. Deferred per the master prompt's own permission to omit it from V1.
- **Weekly/monthly/organization reporting** are not implemented — `report_runs.report_type` is constrained to `'daily'` only today, but the column exists so widening the check constraint (not reshaping the tables) is the only change a future increment needs.
- **Multi-currency/multi-account consolidation** is not implemented — reports are RWF-only (matching MoMo ingestion being the only transaction source today).
- **Reconciliation status** is deliberately excluded from reports — `balance_reconciliations` remains dormant/unpopulated in production (see that table's own migration comment); showing a reconciliation status here before that's genuinely wired up and verified would be a guessed value.
- **PDF has no attachment delivery** — download-only via the app, never emailed as an attachment (deliberate, see Email delivery).
- **AI commentary has no cost/rate telemetry** beyond what each provider's own dashboard reports — no per-workspace budget cap or usage tracking exists yet; the 15s timeout and per-user opt-in are the only cost controls today.
- **Scheduler is not active in production** — see `supabase/scheduling/README.md`.
