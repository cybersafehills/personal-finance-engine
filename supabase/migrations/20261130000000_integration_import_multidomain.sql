-- Integrations Track B / gap analysis G1 (slice 1): multi-domain import.
--
-- The Import Studio has only ever created plain transactions. This adds
-- two constrained modes over the SAME `transactions` target — "expense"
-- (every row is money out, a category is required) and "income" (every
-- row is money in, a category is required) — because in OneLedger's
-- ledger model an expense IS an out transaction with a category and
-- income IS an in transaction with a category. There is no new domain
-- table.
--
-- Invoice import stays out of scope: `public.bills` has
-- `bill_document_id uuid NOT NULL` + `bills_one_per_document`, so a bill
-- cannot exist without an uploaded document — importing invoices from a
-- spreadsheet would require a Bills-program schema change, not an
-- Integrations one.
--
-- This migration also FIXES a pre-existing bug: commit_import_batch never
-- persisted the mapped `category` onto the created transaction, so even a
-- plain transaction import that mapped a Category column silently dropped
-- it. It is now written with category_source = 'system' (an automated
-- assignment, not a human review or a rule — and, unlike 'manual', it
-- does not make rollback_import_batch retain the row).

-- --------------------------------------------------------------------------
-- import_batches.target_object — what an import's rows become on commit.
-- Additive, defaulted; every existing row reads 'transaction'.
-- --------------------------------------------------------------------------
alter table public.import_batches
  add column target_object text not null default 'transaction'
  check (target_object in ('transaction', 'expense', 'income'));

comment on column public.import_batches.target_object is
  'Import mode: transaction (default) | expense (rows forced money-out, category required) | income (rows forced money-in, category required). Direction is enforced by the mapping''s amountMode; the category requirement is enforced in validation before commit.';

-- --------------------------------------------------------------------------
-- commit_import_batch — unchanged behaviour, plus: persist the mapped
-- category (category_source = 'system'). Full redefinition so the change
-- is reviewable in one place.
-- --------------------------------------------------------------------------
create or replace function public.commit_import_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_batch public.import_batches;
  v_provider text;
  v_source_currency text;
  v_masked text;
  v_account_id uuid;
  v_workspace_id uuid;
  v_rec record;
  v_norm jsonb;
  v_occurred_at timestamptz;
  v_amount bigint;
  v_direction text;
  v_description text;
  v_merchant text;
  v_ext_ref text;
  v_ext_id text;
  v_currency text;
  v_category text;
  v_counterparty text;
  v_fp text;
  v_payload_hash text;
  v_is_dup boolean;
  v_existing_txn uuid;
  v_txn_id uuid;
  v_event_id uuid;
  v_created int := 0;
  v_flagged int := 0;
  v_skipped int := 0;
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_batch from public.import_batches where id = p_batch_id;
  if not found then
    raise exception 'Import not found.';
  end if;

  if not public.has_space_capability(v_batch.workspace_id, 'integration.import_approve') then
    raise exception 'You do not have permission to approve imports in this Space.';
  end if;

  if v_batch.financial_source_id is null then
    raise exception 'Choose which account this import belongs to first.';
  end if;
  if not public.owns_financial_source(v_batch.financial_source_id) then
    raise exception 'You can only import into your own accounts.';
  end if;
  if v_batch.status not in ('validated', 'committing', 'imported', 'rolled_back') then
    raise exception 'This import is not ready to commit.';
  end if;

  select fs.provider, fs.currency, fs.masked_identifier
    into v_provider, v_source_currency, v_masked
  from public.financial_sources fs
  where fs.id = v_batch.financial_source_id;

  select a.id, a.workspace_id
    into v_account_id, v_workspace_id
  from public.accounts a
  where a.financial_source_id = v_batch.financial_source_id
  order by a.created_at
  limit 1;
  if v_account_id is null then
    raise exception 'That account is not linked yet.';
  end if;

  update public.import_batches set status = 'committing' where id = p_batch_id;

  for v_rec in
    select * from public.import_records
    where import_batch_id = p_batch_id
      and status in ('ready', 'approved', 'possible_duplicate')
    order by row_index
  loop
    v_norm := v_rec.normalized;
    v_occurred_at := (v_norm->>'occurred_at')::timestamptz;
    v_amount := (v_norm->>'amount_minor')::bigint;
    v_direction := lower(coalesce(v_norm->>'direction', ''));
    v_description := nullif(btrim(coalesce(v_norm->>'description', '')), '');
    v_merchant := nullif(btrim(coalesce(v_norm->>'merchant', '')), '');
    v_ext_ref := nullif(btrim(coalesce(v_norm->>'external_reference', '')), '');
    v_ext_id := nullif(btrim(coalesce(v_norm->>'external_transaction_id', '')), '');
    v_currency := upper(coalesce(
      nullif(btrim(coalesce(v_norm->>'currency', '')), ''), v_source_currency, 'RWF'));
    v_category := nullif(btrim(coalesce(v_norm->>'category', '')), '');
    v_counterparty := coalesce(v_merchant, v_description);

    if v_occurred_at is null or v_amount is null or v_amount <= 0
       or v_direction not in ('in', 'out', 'neutral') then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Deterministic per (batch,row): a repeat run adds nothing.
    v_payload_hash := md5(
      'import|' || p_batch_id::text || '|' || v_rec.row_index::text || '|'
      || to_char(v_occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || '|'
      || v_amount::text || '|' || v_direction || '|'
      || coalesce(v_counterparty, '') || '|'
      || coalesce(v_ext_ref, '') || '|' || coalesce(v_ext_id, ''));

    select id into v_existing_txn
    from public.raw_financial_events
    where payload_hash = v_payload_hash;
    if v_existing_txn is not null then
      update public.import_records
        set status = 'imported',
            canonical_transaction_id = (
              select canonical_transaction_id from public.raw_financial_events
              where payload_hash = v_payload_hash)
      where id = v_rec.id;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_fp := public.compute_transaction_fingerprint(
      v_provider, coalesce(v_masked, ''), v_amount, v_currency,
      v_direction, v_counterparty, v_occurred_at);

    v_is_dup := exists (
      select 1 from public.transactions t
      where t.workspace_id = v_workspace_id
        and t.dedupe_fingerprint = v_fp
        and t.dedupe_state <> 'merged');

    insert into public.raw_financial_events (
      financial_source_id, channel, received_at, payload_hash,
      raw_payload, parse_status, parser_version
    ) values (
      v_batch.financial_source_id, 'statement', v_occurred_at, v_payload_hash,
      v_norm, 'normalized', 'integration-import-v1'
    )
    returning id into v_event_id;

    insert into public.transactions (
      account_id, workspace_id, financial_source_id, source, import_batch_id,
      transaction_type, direction, status, currency, amount_rwf, fee_rwf,
      counterparty_name, counterparty_reference, occurred_at, parser_version,
      category, category_source,
      principal_effect_rwf, fee_effect_rwf, settlement_state, affects_balance, effect_reason,
      dedupe_fingerprint, dedupe_state, record_created_by_user_id
    ) values (
      v_account_id, v_workspace_id, v_batch.financial_source_id, 'import', p_batch_id,
      'other', v_direction, 'success', v_currency, v_amount, 0,
      v_counterparty, v_ext_ref, v_occurred_at, 'integration-import-v1',
      v_category, case when v_category is not null then 'system' else null end,
      case v_direction when 'out' then -v_amount when 'in' then v_amount else 0 end,
      0, 'settled', true, 'import',
      v_fp,
      case when v_is_dup then 'possible_duplicate' else 'unique' end,
      v_uid
    )
    returning id into v_txn_id;

    update public.raw_financial_events
      set canonical_transaction_id = v_txn_id
    where id = v_event_id;

    update public.import_records
      set status = 'imported', canonical_transaction_id = v_txn_id
    where id = v_rec.id;

    v_created := v_created + 1;
    if v_is_dup then
      v_flagged := v_flagged + 1;
    end if;
  end loop;

  update public.import_batches
    set status = 'imported',
        committed_at = now(),
        rolled_back_at = null,
        row_counts = coalesce(row_counts, '{}'::jsonb) || jsonb_build_object(
          'imported', v_created,
          'possible_duplicate', v_flagged,
          'skipped', v_skipped)
  where id = p_batch_id;

  perform public.record_space_audit_event(
    v_workspace_id, 'import.committed', 'import_batch', p_batch_id, null,
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

comment on function public.commit_import_batch is
  'Commits the ready/approved staging rows of an import batch as source=''import'' transactions with import_batch_id lineage, carrying the mapped category (category_source=''system''). Idempotent per (batch,row) via raw_financial_events.payload_hash; a Space fingerprint match lands as dedupe_state=''possible_duplicate'' for /transactions/review (never auto-merged). integration.import_approve-gated; caller must own the source. Audited import.committed.';

revoke all on function public.commit_import_batch(uuid) from public;
grant execute on function public.commit_import_batch(uuid) to authenticated, service_role;
