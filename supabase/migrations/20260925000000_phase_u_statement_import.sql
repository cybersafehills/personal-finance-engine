-- Phase U (PR7, backend): generic-CSV statement import.
--
-- The web layer parses the CSV and maps its columns to a normalized row
-- shape; this migration is the write path. Every imported line becomes a
-- transaction with source='statement'. Matching against the existing
-- ledger reuses the Phase U fingerprint (compute_transaction_fingerprint,
-- same signal SMS duplicate detection uses): a line whose fingerprint
-- already exists in the Space lands as dedupe_state='possible_duplicate'
-- and flows into the PR3 duplicate-review queue for the user to merge;
-- everything else lands as a normal new transaction. Nothing is ever
-- auto-merged here, and re-importing the same file is a no-op (each line
-- is de-duped on a deterministic payload_hash in raw_financial_events).

-- ---------------------------------------------------------------------------
-- 1. Allow source='statement'. The inline CHECK from the baseline schema
--    is auto-named <table>_<column>_check.
-- ---------------------------------------------------------------------------
alter table public.transactions
  drop constraint transactions_source_check;

alter table public.transactions
  add constraint transactions_source_check
  check (source in ('mtn_momo', 'bank_card', 'manual', 'statement'));

-- A statement row has no raw SMS to reference, same as a manual entry.
alter table public.transactions
  drop constraint transactions_momo_message_required_unless_manual;

alter table public.transactions
  add constraint transactions_momo_message_required_unless_manual check (
    momo_message_id is not null or source in ('manual', 'statement')
  );

-- ---------------------------------------------------------------------------
-- 2. import_statement_transactions: bulk write for one statement file.
--    p_rows is a JSON array of
--      { occurred_at, amount_minor, direction, counterparty?, external_ref? }
--    already normalized by the web column-mapping step. SECURITY DEFINER;
--    the caller must OWN the financial source (you import your own
--    accounts' statements). Returns { created, flagged_possible_duplicate,
--    skipped }.
-- ---------------------------------------------------------------------------
create or replace function public.import_statement_transactions(
  p_financial_source_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
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
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  select fs.provider, fs.currency, fs.masked_identifier
    into v_provider, v_currency, v_masked
  from public.financial_sources fs
  where fs.id = p_financial_source_id;
  if not found then
    raise exception 'Financial source not found.';
  end if;

  if not public.owns_financial_source(p_financial_source_id) then
    raise exception 'You can only import statements for your own accounts.';
  end if;

  -- source -> account -> workspace (the Phase Q backfill links one account
  -- per source; the earliest one wins if somehow there are several).
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

    -- Deterministic per statement line, so re-importing the same file
    -- adds nothing (raw_financial_events.payload_hash is UNIQUE).
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
      v_uid
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

comment on function public.import_statement_transactions is
  'Bulk-imports one generic-CSV bank statement (rows pre-normalized by the web column-mapping step) for a financial source the caller owns. Every line becomes a source=''statement'' transaction; a line whose Phase U fingerprint already exists in the Space is marked dedupe_state=''possible_duplicate'' for the PR3 review queue (never auto-merged). Idempotent per line via raw_financial_events.payload_hash. Audited statement.imported.';

revoke all on function public.import_statement_transactions(uuid, jsonb) from public;
grant execute on function public.import_statement_transactions(uuid, jsonb) to authenticated, service_role;
