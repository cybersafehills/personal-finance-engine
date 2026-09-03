-- op:"capture" ingestion (device pairing v2, ADR 0009).
--
-- The `capture` Edge Function's op:"capture" writes a real inbound transaction
-- message as canonical `raw_financial_events` evidence (parse_status='pending')
-- and returns 202. A separate processor (next PR) turns pending capture rows
-- into `transactions`. This migration is purely additive:
--   * two nullable columns on raw_financial_events tagging the origin + the
--     detected provider,
--   * one 'capture_accepted' audit event value,
--   * a partial index so the future processor can scan only pending capture
--     rows.
-- No RLS change - raw_financial_events is already service-role-only. Every
-- existing row stays valid (both new columns nullable).

alter table public.raw_financial_events
  add column ingestion_origin text
    check (
      ingestion_origin is null
      or ingestion_origin ~ '^[a-z][a-z0-9_]{2,63}$'
    ),
  add column provider_key text
    check (
      provider_key is null
      or provider_key ~ '^[a-z][a-z0-9_]{2,63}$'
    );

comment on column public.raw_financial_events.ingestion_origin is
  'How this evidence entered OneLedger, e.g. iphone_capture_v2 (op:"capture"). NULL for legacy ingest-momo / statement rows.';
comment on column public.raw_financial_events.provider_key is
  'Provider detected from the raw text at capture time (supabase/functions/_shared/providers.ts). Advisory - the processor''s parser is authoritative.';

-- The processor sweeps pending capture rows only; keep it off the hot path of
-- the always-present parse_status index.
create index idx_raw_events_pending_capture
  on public.raw_financial_events (received_at)
  where parse_status = 'pending' and ingestion_origin is not null;

-- Add the success counterpart to the existing 'capture_rejected' audit value.
alter table public.connector_pairing_events
  drop constraint connector_pairing_events_event_check;

alter table public.connector_pairing_events
  add constraint connector_pairing_events_event_check
  check (event in (
    'device_pairing_started',
    'device_paired',
    'device_pairing_failed',
    'device_test_succeeded',
    'device_test_failed',
    'capture_accepted',
    'capture_rejected'
  ));
