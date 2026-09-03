-- raw-events processor: turns `pending` capture evidence into transactions
-- (device pairing v2, ADR 0009 §2).
--
-- The processor (supabase/functions/process-raw-events) claims a batch of
-- pending capture `raw_financial_events` rows, synthesizes a `momo_messages`
-- row for each, and runs the shared normalization pipeline
-- (supabase/functions/_shared/ingestion-pipeline.ts). This migration adds:
--   * two lifecycle values on raw_financial_events.parse_status,
--   * the `iphone_capture_v2` momo_messages provenance value,
--   * a service-role claim RPC (SKIP LOCKED) + a stale-claim release RPC.
-- Additive. No RLS change, no new table.

alter table public.raw_financial_events
  drop constraint raw_financial_events_parse_status_check;

alter table public.raw_financial_events
  add constraint raw_financial_events_parse_status_check
  check (parse_status in (
    'pending',
    'processing',
    'normalized',
    'rejected',
    'superseded',
    'failed'
  ));

comment on column public.raw_financial_events.parse_status is
  'pending → processing (claimed) → normalized | rejected | superseded | failed. `failed` is a deterministic normalization failure kept for inspection; a transient failure returns to `pending`.';

alter table public.momo_messages
  drop constraint momo_messages_source_check;

alter table public.momo_messages
  add constraint momo_messages_source_check
  check (source in (
    'ios_shortcuts',
    'iphone_capture_v2',
    'manual_import',
    'system_import'
  ));

-- ---------------------------------------------------------------------------
-- claim_pending_capture_events: atomically leases up to p_limit pending
-- capture rows (SKIP LOCKED so concurrent processor invocations do not
-- collide) and returns everything the processor needs to normalize them.
-- ---------------------------------------------------------------------------
create or replace function public.claim_pending_capture_events(
  p_limit integer default 20
)
returns table (
  id uuid,
  ingestion_connection_id uuid,
  connector_installation_id uuid,
  device_credential_id uuid,
  financial_source_id uuid,
  provider_key text,
  payload_hash text,
  received_at timestamptz,
  raw_payload jsonb
)
language sql
security definer
set search_path = public
as $$
  update public.raw_financial_events e
  set parse_status = 'processing', updated_at = now()
  where e.id in (
    select c.id
    from public.raw_financial_events c
    where c.parse_status = 'pending'
      and c.ingestion_origin is not null
    order by c.received_at
    limit greatest(1, least(coalesce(p_limit, 20), 200))
    for update skip locked
  )
  returning
    e.id, e.ingestion_connection_id, e.connector_installation_id,
    e.device_credential_id, e.financial_source_id, e.provider_key,
    e.payload_hash, e.received_at, e.raw_payload;
$$;

comment on function public.claim_pending_capture_events(integer) is
  'Service-role-only. Leases pending capture raw_financial_events rows (parse_status pending→processing) with SKIP LOCKED for the process-raw-events worker.';
revoke all on function public.claim_pending_capture_events(integer) from public;
grant execute on function public.claim_pending_capture_events(integer) to service_role;

-- ---------------------------------------------------------------------------
-- release_stale_processing_capture_events: a worker that crashes mid-batch
-- leaves rows stuck in `processing`. This resets ones older than the cutoff
-- back to `pending` so the next tick retries them.
-- ---------------------------------------------------------------------------
create or replace function public.release_stale_processing_capture_events(
  p_older_than interval default interval '15 minutes'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.raw_financial_events
  set parse_status = 'pending', updated_at = now()
  where parse_status = 'processing'
    and ingestion_origin is not null
    and updated_at < now() - coalesce(p_older_than, interval '15 minutes');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.release_stale_processing_capture_events(interval) is
  'Service-role-only crash recovery: returns capture rows stuck in `processing` past the cutoff to `pending`.';
revoke all on function public.release_stale_processing_capture_events(interval) from public;
grant execute on function public.release_stale_processing_capture_events(interval) to service_role;
