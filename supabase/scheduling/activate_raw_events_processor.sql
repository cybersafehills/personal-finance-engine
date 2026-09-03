-- One-time, MANUALLY-APPLIED setup for the raw-events processor's schedule
-- (device pairing v2, ADR 0009 / docs/ingestion-pipeline.md). Deliberately
-- NOT a tracked migration - same reasoning as the other files in this
-- directory (pg_cron/pg_net need shared_preload_libraries, which the
-- disposable CI Postgres cannot set; and deploy-supabase.yml pushes every
-- migration unconditionally on green main, which would auto-activate
-- scheduling before the Vault step below could happen). Reviewed and run
-- by hand, once, only when you are ready to turn the processor on.
--
-- PREREQUISITES (all required BEFORE running this file):
--
--   1. DEVICE_PAIRING_V2 = enabled  is set as a Supabase Edge Function
--      secret (the whole device-pairing v2 surface, including the capture
--      channel this drains, is dark otherwise).
--
--   2. RAW_EVENTS_PROCESSOR_SECRET is set as a Supabase Edge Function
--      secret. Generate it with:  openssl rand -hex 32
--
--   3. The EXACT SAME value is stored in this project's Vault - run in the
--      Supabase SQL editor (never commit the real value anywhere):
--
--        select vault.create_secret(
--          '<paste the exact RAW_EVENTS_PROCESSOR_SECRET value>',
--          'raw_events_processor_secret',
--          'Shared secret for the process-raw-events Edge Function'
--        );
--
-- Effect once run: a 1-minute pg_cron job that POSTs the process-raw-events
-- Edge Function. It is idempotent and a no-op until the two Edge secrets
-- above are set, so activating this early is low-risk.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.call_raw_events_processor()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  processor_secret text;
  functions_base text := 'https://zttxsaiywkfrbdxgzbjd.supabase.co/functions/v1';
begin
  select decrypted_secret into processor_secret
  from vault.decrypted_secrets
  where name = 'raw_events_processor_secret';

  if processor_secret is null then
    raise notice 'raw_events_processor_secret not in Vault - skipping tick';
    return;
  end if;

  perform net.http_post(
    url := functions_base || '/process-raw-events',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-processor-secret', processor_secret
    ),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.call_raw_events_processor() from public;

select cron.schedule(
  'raw-events-processor',
  '* * * * *',
  $$select public.call_raw_events_processor();$$
);

-- To deactivate:  select cron.unschedule('raw-events-processor');
