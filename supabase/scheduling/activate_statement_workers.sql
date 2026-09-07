-- One-time, MANUALLY-APPLIED activation for the Financial Documents
-- Engine's two background workers:
--
--   * run-statement-schedules - enqueues a `status='generating'` stub for
--     every due `statement_schedules` row and advances its `next_run_at`.
--   * run-statement-jobs - finalizes those stubs (and any created by
--     createStatement's async-threshold path): fetches, computes, renders
--     the immutable snapshot, flips the row to `ready`, and sends the
--     optional link-only "your scheduled statement is ready" email.
--
-- Like activate_report_scheduler.sql, this is deliberately NOT a tracked
-- migration under supabase/migrations/ - pg_cron/pg_net require
-- `shared_preload_libraries` set at Postgres startup, which the disposable
-- local/CI Postgres the migration test harness spawns cannot do, and
-- deploy-supabase.yml would otherwise auto-activate scheduling on the next
-- merge to main before the manual Vault step below could happen. Review
-- and run this by hand, once, only when you actually want the workers
-- ticking. See supabase/scheduling/README.md.
--
-- PREREQUISITES (all required BEFORE running this file):
--
--   1. The Statements feature is deployed and LIVE:
--      FINANCIAL_STATEMENTS_ENABLED = "true" in Vercel's PRODUCTION
--      environment. Both ticks hard-check this and return
--      {"disabled": true} while it is unset - so scheduling them early is
--      harmless, they simply no-op until the flag is on.
--
--   2. REPORT_CRON_SECRET is set in Vercel's PRODUCTION environment
--      (these routes reuse the same shared secret + x-report-cron-secret
--      header as every other /api/cron route - web/lib/cron-auth.ts).
--      Generate with: openssl rand -hex 32
--
--   3. The EXACT SAME value is stored in this Supabase project's Vault as
--      'report_cron_secret'. Already done if activate_report_scheduler.sql
--      (or activate_payment_intent_expiry.sql / activate_account_deletions.sql)
--      was ever run. Otherwise, in the Supabase SQL editor
--      (never commit the real value to any file, including this one):
--
--        select vault.create_secret(
--          '<paste the exact REPORT_CRON_SECRET value here>',
--          'report_cron_secret',
--          'Shared secret for the /api/cron/* routes'
--        );
--
--   4. Manually smoke-test both routes first, so a scheduling problem and
--      a worker problem are never debugged at the same time:
--
--        curl -X POST https://www.oneledger.me/api/cron/run-statement-schedules \
--          -H "x-report-cron-secret: <the REPORT_CRON_SECRET value>"
--        curl -X POST https://www.oneledger.me/api/cron/run-statement-jobs \
--          -H "x-report-cron-secret: <the REPORT_CRON_SECRET value>"
--
--      Both are idempotent: run-statement-schedules advances next_run_at
--      per row per tick; run-statement-jobs' finalize wipes each stub's
--      children and the flip to `ready` is conditional on status still
--      being `generating`. With no enabled schedules and no queued
--      statements, both return zeroed counters and do nothing else.
--
-- Base URL below is the confirmed production domain (matches
-- supabase/config.toml's own site_url and activate_report_scheduler.sql).
-- Change it here first if that domain ever changes.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent re-declaration of the shared helper from
-- activate_report_scheduler.sql, so this file is self-sufficient if that
-- one was never run. Byte-identical body - running both is harmless.
-- SECURITY DEFINER so it can read the Vault secret
-- (vault.decrypted_secrets is not selectable by ordinary roles); owned by
-- postgres, per this project's "application-owned objects stay
-- postgres-owned" convention (supabase/migrations/README.md).
create or replace function public.call_report_cron_route(route_path text)
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  cron_secret text;
  base_url text := 'https://www.oneledger.me';
begin
  select decrypted_secret into cron_secret
  from vault.decrypted_secrets
  where name = 'report_cron_secret';

  if cron_secret is null then
    raise exception 'report_cron_secret not found in Vault - see supabase/scheduling/README.md prerequisite';
  end if;

  perform net.http_post(
    url := base_url || route_path,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-report-cron-secret', cron_secret
    ),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.call_report_cron_route(text) from public;
revoke all on function public.call_report_cron_route(text) from anon, authenticated;

-- Two independent ticks, mirroring the schedules -> stub -> finalize
-- pipeline. Schedules are day-granular (cadence + day_of_month/day_of_week
-- + timezone), so a 15-minute discovery interval is ample; jobs run every
-- 5 minutes so a queued statement (scheduled OR pushed past
-- STATEMENT_ASYNC_THRESHOLD) is finalized promptly.
select cron.schedule(
  'statement-schedules-tick',
  '*/15 * * * *',
  $$select public.call_report_cron_route('/api/cron/run-statement-schedules');$$
);

select cron.schedule(
  'statement-jobs-tick',
  '*/5 * * * *',
  $$select public.call_report_cron_route('/api/cron/run-statement-jobs');$$
);

-- Verification (run after activating):
--   select jobid, jobname, schedule, active from cron.job
--     where jobname in ('statement-schedules-tick', 'statement-jobs-tick');
--   select * from cron.job_run_details
--     where jobname in ('statement-schedules-tick', 'statement-jobs-tick')
--     order by start_time desc limit 20;
--
-- To deactivate (leaves call_report_cron_route + all statement data
-- untouched; no statement generates automatically again until re-run):
--   select cron.unschedule('statement-schedules-tick');
--   select cron.unschedule('statement-jobs-tick');
