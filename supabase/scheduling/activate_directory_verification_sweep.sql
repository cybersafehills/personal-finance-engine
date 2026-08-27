-- One-time, MANUALLY-APPLIED activation for the Phase P directory
-- verification-freshness sweep. Like activate_payment_intent_expiry.sql
-- and activate_report_scheduler.sql, this is deliberately NOT a tracked
-- migration under supabase/migrations/ - pg_cron/pg_net require
-- shared_preload_libraries set at Postgres startup, which the disposable
-- local/CI Postgres cannot do. Run this by hand, once, only when the
-- Pay & Services directory is live in production.
--
-- PREREQUISITES (both required BEFORE running this file):
--   1. REPORT_CRON_SECRET is set in Vercel's PRODUCTION environment
--      (this route reuses the same shared secret + x-report-cron-secret
--      header as the other cron routes - web/lib/cron-auth.ts).
--   2. The same value is in this Supabase project's Vault as
--      'report_cron_secret' (already done if any other scheduler was
--      activated - see activate_report_scheduler.sql prerequisite 2).
--
-- Effect once run: a daily pg_cron job that POSTs to
-- /api/cron/directory-verification-sweep. The route is READ-ONLY over
-- directory content - it never unpublishes anything - and idempotent, so
-- it is safe to call at any frequency.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Reuses public.call_report_cron_route(text) from
-- activate_report_scheduler.sql (it takes any route path). If that file
-- has not been run yet, run it first (or inline the function here).

select cron.schedule(
  'directory-verification-sweep',
  '17 6 * * *',
  $$select public.call_report_cron_route('/api/cron/directory-verification-sweep');$$
);

-- Verification (run after activating):
--   select jobid, jobname, schedule, active from cron.job;
--   select * from cron.job_run_details where jobname = 'directory-verification-sweep'
--     order by start_time desc limit 20;
--
-- To deactivate:
--   select cron.unschedule('directory-verification-sweep');
