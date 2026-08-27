-- One-time, MANUALLY-APPLIED activation for the Phase 2b SMS
-- reconciliation retry tick. Like the other files in this directory,
-- this is deliberately NOT a tracked migration (pg_cron/pg_net need
-- shared_preload_libraries set at Postgres startup, which the disposable
-- local/CI Postgres the migration test harness spawns cannot do).
--
-- PREREQUISITES:
--   1. SMS_RECONCILIATION_ENABLED = "true" in Vercel's PRODUCTION env
--      AND as a Supabase edge-function secret (for the ingest-momo
--      hook). SMS_RECONCILIATION_MODE = "observe" until accuracy has
--      been reviewed on /pay/reconciliation, then "apply".
--   2. REPORT_CRON_SECRET set in Vercel prod + Supabase Vault as
--      'report_cron_secret' (already done if any other scheduler is
--      active - see activate_report_scheduler.sql).
--
-- Effect once run: a 10-minute pg_cron job POSTing to
-- /api/cron/reconcile-pending-payments. That route no-ops unless
-- SMS_RECONCILIATION_ENABLED is "true", so activating this before the
-- flag is set is harmless.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Reuses public.call_report_cron_route(text) from
-- activate_report_scheduler.sql.
select cron.schedule(
  'payment-reconciliation-tick',
  '*/10 * * * *',
  $$select public.call_report_cron_route('/api/cron/reconcile-pending-payments');$$
);

-- Verification:
--   select jobid, jobname, schedule, active from cron.job;
--   select * from cron.job_run_details where jobname = 'payment-reconciliation-tick'
--     order by start_time desc limit 20;
--
-- To deactivate:
--   select cron.unschedule('payment-reconciliation-tick');
