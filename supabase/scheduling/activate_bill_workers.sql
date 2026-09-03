-- One-time, MANUALLY-APPLIED activation for the Bills & Expenses
-- background workers (Phase 8). Like activate_report_scheduler.sql this
-- is deliberately NOT a tracked migration - pg_cron/pg_net need
-- shared_preload_libraries set at Postgres startup, which the disposable
-- local/CI cluster the migration harness spawns cannot do, and dropping
-- it into the migration chain would auto-activate scheduling in
-- production on the next merge. Reviewed and run by hand, once, only when
-- you are actually ready to turn the workers on.
--
-- PREREQUISITES:
--   1. BILLS_ENABLED=true (and, for the extraction worker,
--      BILLS_EXTRACTION_ENABLED=true + AI_PROVIDER + a key) in Vercel's
--      PRODUCTION environment. Optionally BILLS_WORKSPACE_ALLOWLIST for a
--      staged internal beta.
--   2. REPORT_CRON_SECRET set in Vercel production AND stored in this
--      project's Vault as 'report_cron_secret' (the Bills cron routes
--      reuse the same shared-secret check as every other app/api/cron/*
--      route - see web/lib/cron-auth.ts). If activate_report_scheduler.sql
--      has already been run, the Vault secret and
--      public.call_report_cron_route() already exist and this file only
--      needs the cron.schedule() calls below.
--
-- Effect once run: two 5-minute pg_cron jobs POSTing to
--   /api/cron/process-bill-documents   - claim queued documents, run
--                                        extraction + validation + the
--                                        candidate engines, advance to
--                                        needs_review. Idempotent; does
--                                        nothing unless the flags are on.
--   /api/cron/bill-monitoring          - emit coarse [bill-metrics] logs.
-- Both are safe to invoke at any frequency.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Reuse public.call_report_cron_route(route_path) from
-- activate_report_scheduler.sql. If that file has not been run, create it
-- here (identical body).
do $$
begin
  if to_regprocedure('public.call_report_cron_route(text)') is null then
    execute $fn$
      create function public.call_report_cron_route(route_path text)
      returns void
      language plpgsql
      security definer
      set search_path = public, extensions, vault
      as $body$
      declare
        cron_secret text;
        base_url text := 'https://www.oneledger.me';
      begin
        select decrypted_secret into cron_secret
        from vault.decrypted_secrets where name = 'report_cron_secret';
        if cron_secret is null then
          raise exception 'report_cron_secret not found in Vault - see supabase/scheduling/README.md';
        end if;
        perform net.http_post(
          url := base_url || route_path,
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-report-cron-secret', cron_secret),
          body := '{}'::jsonb
        );
      end;
      $body$;
    $fn$;
    revoke all on function public.call_report_cron_route(text) from public, anon, authenticated;
  end if;
end
$$;

select cron.schedule(
  'bill-processing-tick',
  '*/5 * * * *',
  $$select public.call_report_cron_route('/api/cron/process-bill-documents');$$
);

select cron.schedule(
  'bill-monitoring-tick',
  '*/5 * * * *',
  $$select public.call_report_cron_route('/api/cron/bill-monitoring');$$
);

-- To pause without deleting app data:
--   select cron.unschedule('bill-processing-tick');
--   select cron.unschedule('bill-monitoring-tick');
--
-- Verification (run after activating):
--   select jobid, jobname, schedule, active from cron.job where jobname like 'bill-%';
--   select * from cron.job_run_details order by start_time desc limit 20;
