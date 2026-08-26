# Reporting engine: production rollout & end-to-end verification runbook

Copy-pasteable steps to take the Scheduled Financial Reporting engine from "merged to `main`" to "verified working end-to-end in production," and to confirm tenant isolation holds for real. Written because this session has no live Supabase/Vercel/Resend credentials to run these itself — you run this, in order, and stop at the first unexpected result rather than continuing past it (master prompt §62's production-safety checkpoints).

Every step is safe to re-run. Nothing here creates real financial transactions unless step 6 explicitly asks you to send one.

## 0. Before you start

Confirm on the branch/PR that:
- [ ] `npx tsc --noEmit -p tsconfig.json` and `npm run build` (from `web/`) are clean.
- [ ] `deno test web/lib` (from repo root) passes — should read `N passed | 0 failed`.
- [ ] `supabase/migrations/tests/run_migration_tests.sh` passes locally.
- [ ] CI is green on the PR (now runs all three of the above).

Have ready:
- A Supabase SQL editor tab open on the linked project.
- Two test user accounts you can sign into (or are willing to create) — call them **User A** and **User B** below. They must NOT be the same workspace.
- `REPORT_CRON_SECRET` value (generate one now if you haven't: `openssl rand -hex 32`).

## 1. Merge and deploy

Merging to `main` triggers `deploy-supabase.yml` (migrations + Edge Functions) once CI is green, and Vercel deploys the Next.js app on its own git integration. Nothing in this reporting feature activates automatically from this alone — no cron exists yet, and every user's `daily_report_enabled`/`email_enabled` defaults to `false`.

- [ ] Confirm the migration applied: in the Supabase SQL editor,
  ```sql
  select count(*) from information_schema.tables
  where table_schema = 'public' and table_name in ('report_preferences', 'report_runs', 'report_deliveries', 'report_artifacts');
  -- expect 4
  ```
- [ ] Confirm the storage bucket exists: `select * from storage.buckets where id = 'report-artifacts';` — expect one row, `public = false`.
- [ ] In Vercel, set the production environment variables: `REPORT_CRON_SECRET`, and (if you want AI commentary available at all) `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` + `AI_PROVIDER`. Redeploy if Vercel doesn't pick up new env vars automatically.

## 2. Manual generation — before any user opts in

- [ ] `curl -X POST https://<your-domain>/api/cron/generate-reports -H "x-report-cron-secret: <REPORT_CRON_SECRET>"`
- [ ] Expect `{"candidatesEvaluated":0,"generated":0,"alreadyExists":0,"errors":[]}` — nobody has opted in yet, so this should do nothing and return cleanly. If you get a 401, double check the header name/value. If you get a 500, check Vercel's function logs before continuing.
- [ ] Same for delivery: `curl -X POST https://<your-domain>/api/cron/deliver-reports -H "x-report-cron-secret: <REPORT_CRON_SECRET>"` — same expected empty response.

## 3. User A opts in and generates a real report

- [ ] Sign in as **User A**. Confirm they have at least one settled transaction from a **previous** calendar day (today's `previousCompleteDayKey` needs to resolve to a day with data — if they only have transactions from today, wait until tomorrow, or use a past day they already have activity on by setting `generation_time` accordingly... simplest: pick a user who already has historical transactions).
- [ ] Go to Settings → Daily reports. Turn on "Daily report". Set timezone correctly for this user. Set "Generate report at" to a time a few minutes in the **past** relative to right now (in their local timezone) so the next manual tick picks them up immediately. Leave email off for now. Save.
- [ ] Re-run the generate curl from step 2. Expect `candidatesEvaluated: 1, generated: 1` (or `alreadyExists: 1` if you already ran this once for the same period).
- [ ] In the SQL editor:
  ```sql
  select id, status, period_start, period_end, timezone, generated_at
  from public.report_runs order by created_at desc limit 5;
  ```
  Confirm exactly one new row, `status = 'generated'`, and `workspace_id`/`user_id` match User A.
- [ ] As User A in the browser, visit `/reports` — the report should appear with a "Generated" badge. Open it. Confirm the numbers look right against what you know of their actual transactions for that day (spot-check at least the closing balance and transaction count).
- [ ] Click "Download PDF". Confirm a PDF downloads and opens, with the same figures as the web page, OneLedger branding, generation timestamp, and the informational disclaimer.
- [ ] Re-run the generate curl a third time. Expect `alreadyExists: 1, generated: 0` — confirms idempotency (no duplicate report for the same day).

## 4. Email delivery

- [ ] Back in Settings → Daily reports, turn on "Morning email", set "Send email at" to a few minutes in the past, enter a real email address you can check. Save.
- [ ] Run the deliver curl from step 2. Expect `candidatesEvaluated: 1, delivered: 1`.
- [ ] Check the inbox: subject "Your OneLedger report for <date>", closing balance/received/spent/fees/net matching the report, a "View full report" link that opens the correct report when clicked, both HTML rendering correctly and (view the plain-text part, e.g. via your mail client's "view source"/"show original") a readable plain-text alternative.
- [ ] In the SQL editor:
  ```sql
  select status, attempt_count, provider_message_id, delivered_at from public.report_deliveries order by created_at desc limit 5;
  ```
  Confirm `status = 'delivered'`, `attempt_count = 1`.
- [ ] Re-run the deliver curl. Expect `delivered: 0` (already delivered) and **no second email arrives** — confirms delivery idempotency.

## 5. AI commentary (only if you configured a provider key in step 1)

- [ ] Turn on "AI commentary" in Settings → Daily reports for User A.
- [ ] Delete the existing report_run for today's period so it regenerates with AI on, OR wait for tomorrow's natural cycle. Simplest: in the SQL editor, `delete from public.report_runs where id = '<the id from step 3>';` (safe — it's a report you generated for testing, not real user data you need to keep).
- [ ] Re-run the generate curl. Expect a new `generated: 1`.
- [ ] Check the report in the UI — an "OneLedger Insights" section should appear with a summary and 0-4 observations, plus the "informational only, not financial advice" disclaimer. Confirm it doesn't invent a balance/total you don't recognize from the rest of the report.
- [ ] If it does NOT appear: check Vercel function logs for `AI commentary: ... failed` or `... failed validation` — this is expected-safe behavior (report generation continues either way), but confirms whether the provider call itself is reachable.

## 6. Tenant isolation (User A vs. User B)

- [ ] Sign in as **User B** (different workspace). Visit `/reports` directly, and try navigating to User A's report URL (`/reports/<User A's report id>`) directly. Expect a 404/not-found — never User A's data.
- [ ] As User B, try `GET /api/reports/<User A's report id>/pdf` directly (e.g. paste the URL in a browser while signed in as B). Expect a `404` JSON response, never a PDF.
- [ ] In the SQL editor, confirm this isn't just UI-level protection — run as the actual authenticated Postgres role is harder to simulate from the SQL editor (which runs as `postgres`), so instead rely on the automated proof: `supabase/migrations/tests/run_migration_tests.sh`'s "Phase J: reporting RLS" and "Phase K: report_artifacts" sections already assert this cross-tenant isolation at the database level with two real test users — confirm that suite is green on the deployed migration (it ran in CI before merge).

## 7. Real ingestion smoke test (optional, only if you want full confidence)

Per master prompt §80: don't fabricate transactions unless authorized. If you want to verify the whole pipeline against a genuinely new transaction:
- [ ] Send one real, already-happened, low-value MoMo SMS through the existing Shortcut/ingestion path as you normally would.
- [ ] Confirm it appears correctly in `/transactions` first (this is the existing, unrelated ingestion path — unaffected by anything in this branch).
- [ ] The next time that user's report generates for that day, confirm the new transaction is correctly reflected in the snapshot/category totals.

## 8. Wind down test state (optional)

- [ ] Turn "Daily report"/"Morning email"/"AI commentary" back off for User A and User B in Settings if you don't want them actually receiving reports yet.
- [ ] Leave the test `report_runs`/`report_deliveries`/`report_artifacts` rows in place — they're harmless historical data, not worth cleaning up.

## 9. Activating the scheduler (only after all of the above pass)

Follow `supabase/scheduling/README.md` in full — it has its own prerequisite (Vault secret) → activation → verification → rollback sequence. Do this as a separate, deliberate step after everything above is confirmed working manually, not in the same sitting as first deploy.

## If something fails

- **Generation route 500s**: check Vercel function logs for the specific `report-generation.ts` error message (it includes the failing query name, e.g. `fetchSettledTransactions failed: ...`).
- **Delivery succeeds but no email arrives**: check Resend's own dashboard/logs for the message — `provider_message_id` in `report_deliveries` is the Resend message ID to search by. Confirm `RESEND_FROM_EMAIL` is on a verified domain (Resend's sandbox sender only delivers to your own account email).
- **PDF route fails**: check that the `report-artifacts` bucket exists (step 1) and that `SUPABASE_SERVICE_ROLE_KEY` is set correctly in Vercel.
- **Cross-tenant data appears anywhere**: stop immediately, do not continue testing, and treat as a security incident per master prompt §80 ("Stop immediately on cross-tenant access or financial-integrity failure").
