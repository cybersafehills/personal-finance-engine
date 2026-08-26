-- One-time, MANUALLY-APPLIED setup for the Scheduled Financial Reporting
-- engine's server-side scheduler (Phase F). This file is deliberately
-- NOT a tracked migration under supabase/migrations/ - see
-- supabase/scheduling/README.md for the full explanation, but in short:
-- pg_cron/pg_net require `shared_preload_libraries` set at Postgres
-- startup, which the disposable local/CI Postgres this repo's migration
-- test harness spawns cannot do - dropping this into the normal
-- migration chain would break run_migration_tests.sh (and therefore CI)
-- for everyone, AND would auto-activate scheduling in production on the
-- next merge to main (deploy-supabase.yml pushes every migration
-- unconditionally on green CI), before the manual Vault step below could
-- ever happen. This file is reviewed and run by hand, once, only when
-- you are actually ready to turn scheduling on.
--
-- PREREQUISITES (both required BEFORE running this file):
--
--   1. REPORT_CRON_SECRET is set in Vercel's PRODUCTION environment
--      variables (see web/.env.local.example). Generate a value with:
--        openssl rand -hex 32
--
--   2. The EXACT SAME value is stored in this Supabase project's Vault -
--      run this directly in the Supabase SQL editor (never commit the
--      real value to any file, including this one):
--
--        select vault.create_secret(
--          '<paste the exact REPORT_CRON_SECRET value here>',
--          'report_cron_secret',
--          'Shared secret for the report-generation/delivery cron routes'
--        );
--
-- Base URL below is already set to the confirmed production domain
-- (https://www.oneledger.me - see supabase/config.toml's own
-- `site_url`/`additional_redirect_urls`, which independently confirm
-- this is the real production domain, not the raw Vercel deployment
-- URL). Update it here first if that domain ever changes.
--
-- Effect once run: two 5-minute-interval pg_cron jobs that POST to
-- /api/cron/generate-reports and /api/cron/deliver-reports. Both routes
-- are already idempotent and currently safe to invoke at any frequency
-- regardless (report_runs_unique_period / report_deliveries_unique_send
-- back every insert) - activating this is low-risk even before any user
-- opts in, since a candidate list built from
-- report_preferences.daily_report_enabled/email_enabled = true is empty
-- until someone actually turns reporting on in Settings. Precision
-- guarantee: due work is discovered within 5 minutes of the configured
-- local generation/delivery time, not exact-minute (master prompt §12).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- SECURITY DEFINER so it can read the Vault secret
-- (vault.decrypted_secrets is not selectable by ordinary roles) - owned
-- by postgres, matching this project's "application-owned schema objects
-- stay postgres-owned" rule (supabase/migrations/README.md's own
-- documented convention, even though this file lives outside migrations/).
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
    raise exception 'report_cron_secret not found in Vault - see supabase/scheduling/README.md prerequisite 2';
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

-- Two independent ticks, matching report_runs/report_deliveries' own
-- separation of generation from delivery (master prompt §8/§9/§37).
select cron.schedule(
  'report-generation-tick',
  '*/5 * * * *',
  $$select public.call_report_cron_route('/api/cron/generate-reports');$$
);

select cron.schedule(
  'report-delivery-tick',
  '*/5 * * * *',
  $$select public.call_report_cron_route('/api/cron/deliver-reports');$$
);

-- Verification (run after activating):
--   select jobid, jobname, schedule, active from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 20;
