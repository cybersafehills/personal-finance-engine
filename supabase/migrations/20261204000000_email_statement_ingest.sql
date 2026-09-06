-- Email statement ingestion (ADR 0018 Slice B). A user gets a per-source
-- inbound address (u+<token>@<inbound domain>); a Resend Inbound webhook
-- (supabase/functions/inbound-email) resolves the address to the source
-- and imports the statement lines through the SAME path as a manual
-- upload.
--
-- Dark by default: no address is issued until the owner asks
-- (set_source_ingest_email), and the edge function is a no-op without
-- EMAIL_STATEMENT_INGEST_ENABLED + INBOUND_EMAIL_WEBHOOK_SECRET.
--
-- Additive: one nullable column on financial_sources, four small RPCs,
-- and a service-role core extracted from import_statement_transactions so
-- the webhook can import without an auth.uid().

-- ---------------------------------------------------------------------------
-- 1. Per-source inbound token.
-- ---------------------------------------------------------------------------
alter table public.financial_sources
  add column ingest_email_token text unique;

comment on column public.financial_sources.ingest_email_token is
  'Opaque token in this source''s inbound-email address (u+<token>@<inbound domain>). NULL until the owner enables email ingestion; rotatable; clearing it disables the address. Not a secret on its own - the webhook also verifies its provider signature and rate-limits per token.';

-- ---------------------------------------------------------------------------
-- 2. Owner-managed lifecycle (authenticated, owner-gated).
-- ---------------------------------------------------------------------------
create or replace function public.set_source_ingest_email(p_source_id uuid)
  returns text
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_token text;
begin
  if not public.owns_financial_source(p_source_id) then
    raise exception 'You can only manage your own accounts'
      using errcode = 'P0001';
  end if;

  select ingest_email_token into v_token
  from public.financial_sources where id = p_source_id;

  if v_token is null then
    v_token := replace(gen_random_uuid()::text, '-', '');
    update public.financial_sources
      set ingest_email_token = v_token
    where id = p_source_id;
  end if;

  return v_token;
end;
$$;

comment on function public.set_source_ingest_email is
  'Return this source''s inbound-email token, minting one on first call. Owner-gated. Idempotent.';

revoke all on function public.set_source_ingest_email(uuid) from public;
grant execute on function public.set_source_ingest_email(uuid) to authenticated;

create or replace function public.rotate_source_ingest_email(p_source_id uuid)
  returns text
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_token text := replace(gen_random_uuid()::text, '-', '');
begin
  if not public.owns_financial_source(p_source_id) then
    raise exception 'You can only manage your own accounts'
      using errcode = 'P0001';
  end if;
  update public.financial_sources
    set ingest_email_token = v_token
  where id = p_source_id;
  return v_token;
end;
$$;

revoke all on function public.rotate_source_ingest_email(uuid) from public;
grant execute on function public.rotate_source_ingest_email(uuid) to authenticated;

create or replace function public.clear_source_ingest_email(p_source_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if not public.owns_financial_source(p_source_id) then
    raise exception 'You can only manage your own accounts'
      using errcode = 'P0001';
  end if;
  update public.financial_sources
    set ingest_email_token = null
  where id = p_source_id;
end;
$$;

revoke all on function public.clear_source_ingest_email(uuid) from public;
grant execute on function public.clear_source_ingest_email(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Webhook resolver (service_role only).
-- ---------------------------------------------------------------------------
create or replace function public.resolve_ingest_email_source(p_token text)
  returns uuid
  language sql
  security definer
  set search_path = public
  stable
as $$
  select id
  from public.financial_sources
  where ingest_email_token = p_token
    and p_token is not null
    and status <> 'archived'
  limit 1;
$$;

comment on function public.resolve_ingest_email_source is
  'inbound-email edge function: token from an inbound address -> financial_source id, or NULL. Service-role only.';

revoke all on function public.resolve_ingest_email_source(text) from public;
grant execute on function public.resolve_ingest_email_source(text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Extract a service-role core from import_statement_transactions so the
--    webhook can import for a source without an auth.uid(). Body is the
--    existing function's, minus the auth.uid() / owns_financial_source
--    checks; the caller (webhook) has already resolved the token to the
--    source, or the authenticated wrapper below has checked ownership.
-- ---------------------------------------------------------------------------
create or replace function public._import_statement_rows(
  p_financial_source_id uuid,
  p_rows jsonb,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider text;
  v_currency text;
  v_masked text;
  v_account_id uuid;
  v_workspace_id uuid;
  v_row jsonb;
  v_occurred_at timestamptz;
  v_amount bigint;
  v_direction text;
  v_counterparty text;
  v_external_ref text;
  v_fp text;
  v_payload_hash text;
  v_is_dup boolean;
  v_txn_id uuid;
  v_event_id uuid;
  v_created int := 0;
  v_flagged int := 0;
  v_skipped int := 0;
begin
  select fs.provider, fs.currency, fs.masked_identifier
    into v_provider, v_currency, v_masked
  from public.financial_sources fs
  where fs.id = p_financial_source_id;
  if not found then
    raise exception 'Financial source not found.';
  end if;

  select a.id, a.workspace_id
    into v_account_id, v_workspace_id
  from public.accounts a
  where a.financial_source_id = p_financial_source_id
  order by a.created_at
  limit 1;
  if v_account_id is null then
    raise exception 'This source is not linked to an account yet.';
  end if;

  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Rows must be a JSON array.';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_occurred_at := (v_row->>'occurred_at')::timestamptz;
    v_amount := (v_row->>'amount_minor')::bigint;
    v_direction := lower(coalesce(v_row->>'direction', ''));
    v_counterparty := nullif(btrim(coalesce(v_row->>'counterparty', '')), '');
    v_external_ref := nullif(btrim(coalesce(v_row->>'external_ref', '')), '');

    if v_occurred_at is null or v_amount is null or v_amount < 0
       or v_direction not in ('in', 'out', 'neutral') then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_fp := public.compute_transaction_fingerprint(
      v_provider, v_masked, v_amount, v_currency,
      v_direction, v_counterparty, v_occurred_at);

    v_payload_hash := md5(
      'statement|' || p_financial_source_id::text || '|'
      || to_char(v_occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || '|'
      || v_amount::text || '|' || v_direction || '|'
      || coalesce(v_counterparty, '') || '|' || coalesce(v_external_ref, ''));

    if exists (
      select 1 from public.raw_financial_events where payload_hash = v_payload_hash
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_is_dup := exists (
      select 1 from public.transactions t
      where t.workspace_id = v_workspace_id
        and t.dedupe_fingerprint = v_fp
        and t.dedupe_state <> 'merged');

    insert into public.raw_financial_events (
      financial_source_id, channel, received_at, payload_hash,
      raw_payload, parse_status, parser_version
    ) values (
      p_financial_source_id, 'statement', v_occurred_at, v_payload_hash,
      v_row, 'normalized', 'statement-import-v1'
    )
    returning id into v_event_id;

    insert into public.transactions (
      account_id, workspace_id, financial_source_id, source, transaction_type,
      direction, status, currency, amount_rwf, fee_rwf,
      counterparty_name, counterparty_reference, occurred_at, parser_version,
      principal_effect_rwf, fee_effect_rwf, settlement_state, affects_balance, effect_reason,
      dedupe_fingerprint, dedupe_state, record_created_by_user_id
    ) values (
      v_account_id, v_workspace_id, p_financial_source_id, 'statement', 'other',
      v_direction, 'success', v_currency, v_amount, 0,
      v_counterparty, v_external_ref, v_occurred_at, 'statement-import-v1',
      case v_direction when 'out' then -v_amount when 'in' then v_amount else 0 end,
      0, 'settled', true, 'statement_import',
      v_fp,
      case when v_is_dup then 'possible_duplicate' else 'unique' end,
      p_actor_user_id
    )
    returning id into v_txn_id;

    update public.raw_financial_events
      set canonical_transaction_id = v_txn_id
    where id = v_event_id;

    v_created := v_created + 1;
    if v_is_dup then
      v_flagged := v_flagged + 1;
    end if;
  end loop;

  perform public.record_space_audit_event(
    v_workspace_id, 'statement.imported', 'financial_source', p_financial_source_id,
    null,
    jsonb_build_object(
      'created', v_created,
      'flagged_possible_duplicate', v_flagged,
      'skipped', v_skipped));

  return jsonb_build_object(
    'created', v_created,
    'flagged_possible_duplicate', v_flagged,
    'skipped', v_skipped);
end;
$$;

comment on function public._import_statement_rows is
  'Service-role core of statement import: writes source=''statement'' transactions + raw_financial_events for pre-normalized rows, no auth check (the caller has already established the right to write this source). Idempotent per line via raw_financial_events.payload_hash.';

revoke all on function public._import_statement_rows(uuid, jsonb, uuid) from public;
grant execute on function public._import_statement_rows(uuid, jsonb, uuid) to service_role;

-- Re-issue the authenticated entry point as a thin ownership check over
-- the core (behaviour unchanged for the web upload flow).
create or replace function public.import_statement_transactions(
  p_financial_source_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;
  if not public.owns_financial_source(p_financial_source_id) then
    raise exception 'You can only import statements for your own accounts.';
  end if;
  return public._import_statement_rows(
    p_financial_source_id, p_rows, auth.uid());
end;
$$;

-- grants unchanged (authenticated + service_role already hold EXECUTE).

-- Service-role wrapper the inbound-email function calls (token already
-- resolved to the source).
create or replace function public.import_statement_rows_for_source(
  p_financial_source_id uuid,
  p_rows jsonb,
  p_actor_user_id uuid default null
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public._import_statement_rows(
    p_financial_source_id, p_rows, p_actor_user_id);
$$;

revoke all on function public.import_statement_rows_for_source(uuid, jsonb, uuid) from public;
grant execute on function public.import_statement_rows_for_source(uuid, jsonb, uuid) to service_role;
