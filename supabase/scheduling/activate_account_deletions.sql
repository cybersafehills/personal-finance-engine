-- One-time, MANUALLY-APPLIED setup for the account-erasure tick
-- (ADR 0016 section 3, audit F12). Deliberately NOT a tracked migration -
-- same reasoning as every other file in supabase/scheduling/ (pg_cron /
-- pg_net need shared_preload_libraries the disposable CI Postgres can't
-- set; and deploy-supabase.yml pushes every migration unconditionally on
-- green main, which would auto-activate this before the Vault + flag steps
-- below could happen). Reviewed and run by hand, once, only when you are
-- ready to let scheduled erasures actually run.
--
-- WHAT IT DOES: a once-daily pg_cron job that POSTs
-- /api/cron/process-account-deletions. That route drains
-- account_deletion_requests whose 30-day grace window has closed
-- (`pending_account_deletions()`), erasing each via
-- `execute_account_deletion()` (both RPCs are service-role only,
-- migration 20261203000000).
--
-- IT IS A NO-OP UNTIL you ALSO set, in Vercel's PRODUCTION environment:
--     ACCOUNT_DELETION_EXECUTE_ENABLED = true
-- Without it the route returns {"skipped":"disabled","erased":0} on every
-- tick - so activating this cron early is safe. Users can already
-- schedule and cancel deletion with ACCOUNT_DELETION_ENABLED alone;
-- nothing is ever erased until BOTH that execute flag is on AND a
-- request's 30-day window has elapsed.
--
-- PREREQUISITES (all required BEFORE running this file):
--
--   1. REPORT_CRON_SECRET is set in Vercel's PRODUCTION environment
--      variables (shared by every /api/cron/* route). Already set for the
--      reporting scheduler; generate with `openssl rand -hex 32` if not.
--
--   2. The EXACT SAME value is in this project's Vault as
--      `report_cron_secret`. If you already ran
--      activate_report_scheduler.sql this is done. Otherwise, in the
--      Supabase SQL editor (never commit the real value):
--
--        select vault.create_secret(
--          '<paste the exact REPORT_CRON_SECRET value>',
--          'report_cron_secret',
--          'Shared secret for the /api/cron/* routes'
--        );
--
--   3. Migration 20261203000000_account_erasure.sql is deployed (it is -
--      Remote database up to date as of 2026-09-06).
--
-- Base URL is the confirmed production domain (matches
-- supabase/config.toml's site_url). Update here first if it ever changes.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Same helper the reporting scheduler uses (reproduced with `create or
-- replace` so this file stands alone if activate_report_scheduler.sql was
-- never run). SECURITY DEFINER so it can read the Vault secret; owned by
-- postgres; no grants to anon/authenticated - only cron job execution
-- calls it.
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
    raise exception 'report_cron_secret not found in Vault - see supabase/scheduling/README.md';
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

-- Once a day. The grace window is 30 days, so there is no urgency to erase
-- within minutes of it lapsing; the route batches (BATCH = 25) and catches
-- up on the next tick if a day ever exceeds that.
select cron.schedule(
  'account-deletion-tick',
  '15 3 * * *',
  $$select public.call_report_cron_route('/api/cron/process-account-deletions');$$
);

-- Verification (run after activating):
--   select jobid, jobname, schedule, active from cron.job
--     where jobname = 'account-deletion-tick';
--   select * from cron.job_run_details
--     where command like '%process-account-deletions%'
--     order by start_time desc limit 10;
--
-- Manual smoke test (safe; returns {"skipped":"disabled"} until the
-- execute flag is on, then {"due":0,"erased":0,...}):
--   curl -X POST https://www.oneledger.me/api/cron/process-account-deletions \
--     -H "x-report-cron-secret: <the REPORT_CRON_SECRET value>"
--
-- Rollback:  select cron.unschedule('account-deletion-tick');
