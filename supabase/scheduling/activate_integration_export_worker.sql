-- One-time, MANUALLY-APPLIED activation for the Integrations Export
-- Center's background worker:
--
--   * run-export-jobs - runs export_jobs left `queued` because the row
--     estimate exceeded the 20 000-row inline threshold, re-claims jobs
--     stuck in `processing` past a 15-minute lease, and purges the stored
--     file (not the history row) of exports older than 7 days.
--
-- Like activate_report_scheduler.sql / activate_statement_workers.sql,
-- this is deliberately NOT a tracked migration under supabase/migrations/
-- - pg_cron/pg_net require `shared_preload_libraries` set at Postgres
-- startup, which the disposable local/CI Postgres the migration test
-- harness spawns cannot do, and deploy-supabase.yml would otherwise
-- auto-activate scheduling on the next merge to main before the manual
-- Vault step below could happen. Review and run this by hand, once, only
-- when you actually want the worker ticking. See
-- supabase/scheduling/README.md and docs/integrations-rollout-runbook.md
-- section 4.
--
-- NOT REQUIRED FOR GENERAL AVAILABILITY. Small exports run inline in the
-- createExportJob action; only >20 000-row exports queue, and the
-- 7-day file-retention purge is simply deferred until this is scheduled.
-- Activate it before advertising large exports.
--
-- PREREQUISITES (all required BEFORE running this file):
--
--   1. The Integrations Export Center is deployed and reachable in
--      production (it is - Phase 1 PR 5). The route itself does NOT check
--      any INTEGRATIONS_* flag: with the Export Center flag off, no new
--      export_jobs rows are created, so the tick is a harmless no-op that
--      only performs retention purge. Scheduling this before or after the
--      flag flip is equally safe.
--
--   2. REPORT_CRON_SECRET is set in Vercel's PRODUCTION environment
--      (this route reuses the same shared secret + x-report-cron-secret
--      header as every other /api/cron route - web/lib/cron-auth.ts).
--      Generate with: openssl rand -hex 32
--
--   3. The EXACT SAME value is stored in this Supabase project's Vault as
--      'report_cron_secret'. Already done if activate_report_scheduler.sql
--      (or activate_statement_workers.sql / activate_account_deletions.sql
--      / activate_payment_intent_expiry.sql) was ever run. Otherwise, in
--      the Supabase SQL editor (never commit the real value to any file,
--      including this one):
--
--        select vault.create_secret(
--          '<paste the exact REPORT_CRON_SECRET value here>',
--          'report_cron_secret',
--          'Shared secret for the /api/cron/* routes'
--        );
--
--   4. Manually smoke-test the route first, so a scheduling problem and a
--      worker problem are never debugged at the same time:
--
--        curl -X POST https://www.oneledger.me/api/cron/run-export-jobs \
--          -H "x-report-cron-secret: <the REPORT_CRON_SECRET value>"
--
--      Idempotent: it claims each job with a per-run claim_token before
--      running it, re-claims only leases older than 15 minutes, and the
--      retention purge is a plain age filter. With no queued / stuck jobs
--      it returns zeroed counters and only runs the purge.
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

-- One tick. Export jobs are user-triggered and rare (large exports only),
-- and the retention purge is not time-critical, so a 10-minute interval
-- is ample - a queued export is picked up within 10 minutes, matching the
-- "inline for small, promptly-batched for large" contract.
select cron.schedule(
  'integration-export-jobs-tick',
  '*/10 * * * *',
  $$select public.call_report_cron_route('/api/cron/run-export-jobs');$$
);

-- Verification (run after activating):
--   select jobid, jobname, schedule, active from cron.job
--     where jobname = 'integration-export-jobs-tick';
--   select * from cron.job_run_details
--     where jobname = 'integration-export-jobs-tick'
--     order by start_time desc limit 20;
--
-- To deactivate (leaves call_report_cron_route + all export data
-- untouched; large exports queue again with no worker, small ones still
-- run inline):
--   select cron.unschedule('integration-export-jobs-tick');
