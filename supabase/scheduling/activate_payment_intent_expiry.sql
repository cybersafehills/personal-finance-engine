-- One-time, MANUALLY-APPLIED activation for the Assisted Quick Pay
-- (Phase 2a) stale-intent expiry tick. Like
-- activate_report_scheduler.sql, this is deliberately NOT a tracked
-- migration under supabase/migrations/ - pg_cron/pg_net require
-- shared_preload_libraries set at Postgres startup, which the disposable
-- local/CI Postgres the migration test harness spawns cannot do. Run
-- this by hand, once, only when Assisted Quick Pay is live in production
-- and you want the stored intent state (not just the UI's lazy view) to
-- be swept automatically.
--
-- PREREQUISITES (both required BEFORE running this file):
--   1. REPORT_CRON_SECRET is set in Vercel's PRODUCTION environment
--      (this route reuses the same shared secret + x-report-cron-secret
--      header as the report cron routes - lib/cron-auth.ts).
--   2. The same value is in this Supabase project's Vault as
--      'report_cron_secret' (already done if the report scheduler was
--      activated - see activate_report_scheduler.sql prerequisite 2).
--
-- Effect once run: a 10-minute pg_cron job that POSTs to
-- /api/cron/expire-payment-intents. The route is idempotent and safe to
-- call at any frequency - expire_stale_payment_intents() only touches
-- genuinely past-due, non-terminal intents.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Reuses public.call_report_cron_route(text) from
-- activate_report_scheduler.sql (it takes any route path). If that file
-- has not been run yet, run it first (or inline the function here).

select cron.schedule(
  'payment-intent-expiry-tick',
  '*/10 * * * *',
  $$select public.call_report_cron_route('/api/cron/expire-payment-intents');$$
);

-- Verification (run after activating):
--   select jobid, jobname, schedule, active from cron.job;
--   select * from cron.job_run_details where jobname = 'payment-intent-expiry-tick'
--     order by start_time desc limit 20;
--
-- To deactivate:
--   select cron.unschedule('payment-intent-expiry-tick');
