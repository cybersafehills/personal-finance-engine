-- Phase R3 (Scan to pay - review & hand-off): give payment_intents an
-- explicit provenance so a QR-scan-originated intent is distinguishable
-- from an Assisted Quick Pay one in activity, reconciliation and
-- analytics. Additive and backwards-compatible: one NOT NULL column with
-- a default, plus create_payment_intent() learning one optional payload
-- key. Existing callers are unaffected (source defaults to 'assisted').
--
-- Builds on 20260907000000_phase_n_payment_orchestration.sql. Does not
-- touch RLS, grants, the state machine, or any other RPC.
--
-- !! PRE-MERGE: run supabase/migrations/tests/run_migration_tests.sh
--    (needs PostgreSQL 17). It was authored against a pg16-only host and
--    could NOT be executed there; a manual `psql -f` apply of the full
--    chain on pg16 verified only that this file parses/applies. The
--    "Phase N" block of that script should also gain:
--      * create_payment_intent with an explicit source='qr_scan' stores it
--      * an unknown source value is rejected by the CHECK
--      * the default path still yields source='assisted'

alter table public.payment_intents
  add column source text not null default 'assisted'
    check (source in ('assisted', 'qr_scan'));

comment on column public.payment_intents.source is
  'How this intent originated: assisted (Assisted Quick Pay form) or qr_scan (Scan to pay). Set once at creation; never changes.';

create index idx_payment_intents_workspace_source
  on public.payment_intents (workspace_id, source, created_at desc);

-- create_payment_intent gains an optional "source" payload key. The body
-- is otherwise byte-identical to the Phase N definition; only the column
-- list, the values list, and this comment differ.
create or replace function public.create_payment_intent(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace uuid := (payload->>'workspace_id')::uuid;
  v_key text := coalesce(nullif(payload->>'idempotency_key', ''), gen_random_uuid()::text);
  v_id uuid;
  v_existed boolean := false;
  v_amount bigint := (payload->>'amount_minor')::bigint;
begin
  if not public.is_workspace_member(v_workspace, 'member') then
    raise exception 'not_authorized: not a member of this workspace' using errcode = 'insufficient_privilege';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'invalid_amount' using errcode = 'check_violation';
  end if;

  insert into public.payment_intents (
    workspace_id, created_by, idempotency_key, payment_type, provider,
    source_account_id, currency, amount_minor,
    recipient_kind, recipient_name, recipient_msisdn_normalized, recipient_msisdn_masked,
    merchant_code, meter_number, billing_reference, government_reference,
    service_code_id, ussd_string_redacted, note, category, budget_id,
    trusted_recipient_id, template_id, source, expires_at, session_fresh_at_creation
  ) values (
    v_workspace, auth.uid(), v_key,
    payload->>'payment_type',
    nullif(payload->>'provider', ''),
    nullif(payload->>'source_account_id', '')::uuid,
    coalesce(nullif(payload->>'currency', ''), 'RWF'),
    v_amount,
    nullif(payload->>'recipient_kind', ''),
    nullif(payload->>'recipient_name', ''),
    nullif(payload->>'recipient_msisdn_normalized', ''),
    nullif(payload->>'recipient_msisdn_masked', ''),
    nullif(payload->>'merchant_code', ''),
    nullif(payload->>'meter_number', ''),
    nullif(payload->>'billing_reference', ''),
    nullif(payload->>'government_reference', ''),
    nullif(payload->>'service_code_id', '')::uuid,
    nullif(payload->>'ussd_string_redacted', ''),
    nullif(payload->>'note', ''),
    nullif(payload->>'category', ''),
    nullif(payload->>'budget_id', '')::uuid,
    nullif(payload->>'trusted_recipient_id', '')::uuid,
    nullif(payload->>'template_id', '')::uuid,
    coalesce(nullif(payload->>'source', ''), 'assisted'),
    now() + make_interval(hours => coalesce((payload->>'ttl_hours')::int, 24)),
    coalesce((payload->>'session_fresh')::boolean, null)
  )
  on conflict (workspace_id, idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.payment_intents
    where workspace_id = v_workspace and idempotency_key = v_key;
    v_existed := true;
  else
    insert into public.payment_events (payment_intent_id, workspace_id, event_type, to_state, actor_type, actor_user_id)
    values (v_id, v_workspace, 'created', 'draft', 'user', auth.uid());
  end if;

  return jsonb_build_object(
    'id', v_id,
    'idempotency_key', v_key,
    'state', (select state from public.payment_intents where id = v_id),
    'existed', v_existed
  );
end;
$$;

revoke all on function public.create_payment_intent(jsonb) from public;
grant execute on function public.create_payment_intent(jsonb) to authenticated;
