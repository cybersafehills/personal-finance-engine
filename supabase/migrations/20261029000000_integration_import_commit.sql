-- Integrations Phase 1, PR 4: commit and rollback for an import batch.
--
-- commit_import_batch turns the ready/approved staging rows of a batch
-- into source='import' transactions carrying import_batch_id, mirroring
-- import_statement_transactions (20260925000000): a per-line deterministic
-- payload_hash makes re-commit a no-op, and a Space-scoped fingerprint
-- match lands the new row as dedupe_state='possible_duplicate' for the
-- existing /transactions/review queue - never auto-merged.
--
-- rollback_import_batch removes ONLY the transactions this batch created
-- that have not since taken on a life of their own (merged, hand-edited,
-- or referenced by a split / transfer / budget link / reconciliation);
-- those are retained and reported. Audit rows are never touched.
--
-- Both RPCs are integration.import_approve-gated and require the caller
-- to own the batch's financial source. They are SECURITY DEFINER so they
-- may call record_space_audit_event and compute_transaction_fingerprint.

-- ===========================================================================
-- commit_import_batch(p_batch_id) -> { created, flagged_possible_duplicate, skipped }
-- ===========================================================================
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
      principal_effect_rwf, fee_effect_rwf, settlement_state, affects_balance, effect_reason,
      dedupe_fingerprint, dedupe_state, record_created_by_user_id
    ) values (
      v_account_id, v_workspace_id, v_batch.financial_source_id, 'import', p_batch_id,
      'other', v_direction, 'success', v_currency, v_amount, 0,
      v_counterparty, v_ext_ref, v_occurred_at, 'integration-import-v1',
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
  'Commits the ready/approved staging rows of an import batch as source=''import'' transactions with import_batch_id lineage. Idempotent per (batch,row) via raw_financial_events.payload_hash; a Space fingerprint match lands as dedupe_state=''possible_duplicate'' for /transactions/review (never auto-merged). integration.import_approve-gated; caller must own the source. Audited import.committed.';

revoke all on function public.commit_import_batch(uuid) from public;
grant execute on function public.commit_import_batch(uuid) to authenticated, service_role;

-- ===========================================================================
-- rollback_import_batch(p_batch_id) -> { removed, retained, reasons, complete }
-- ===========================================================================
create or replace function public.rollback_import_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_batch public.import_batches;
  v_txn record;
  v_removed int := 0;
  v_retained int := 0;
  v_reasons text[] := array[]::text[];
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_batch from public.import_batches where id = p_batch_id;
  if not found then
    raise exception 'Import not found.';
  end if;

  if not public.has_space_capability(v_batch.workspace_id, 'integration.import_approve') then
    raise exception 'You do not have permission to undo imports in this Space.';
  end if;
  if v_batch.status <> 'imported' then
    raise exception 'This import has not been committed.';
  end if;

  for v_txn in
    select id, dedupe_state, category_source
    from public.transactions
    where import_batch_id = p_batch_id
  loop
    if v_txn.dedupe_state = 'merged' then
      v_retained := v_retained + 1;
      v_reasons := array_append(v_reasons, 'merged');
      continue;
    end if;
    if exists (
      select 1 from public.transactions m where m.merged_into_transaction_id = v_txn.id
    ) then
      v_retained := v_retained + 1;
      v_reasons := array_append(v_reasons, 'merge_target');
      continue;
    end if;
    if v_txn.category_source = 'manual' then
      v_retained := v_retained + 1;
      v_reasons := array_append(v_reasons, 'edited');
      continue;
    end if;

    -- Any other reference (split, transfer link, budget link, category
    -- history, reconciliation, attribution...) raises a FK violation on
    -- delete - catch it per row so the rest of the batch still rolls back.
    begin
      delete from public.raw_financial_events where canonical_transaction_id = v_txn.id;
      delete from public.transactions where id = v_txn.id;
      v_removed := v_removed + 1;
    exception when foreign_key_violation then
      v_retained := v_retained + 1;
      v_reasons := array_append(v_reasons, 'referenced');
    end;
  end loop;

  -- Re-open staging rows whose transaction is gone so they can be re-committed.
  update public.import_records
    set status = 'approved', canonical_transaction_id = null
  where import_batch_id = p_batch_id
    and canonical_transaction_id is not null
    and not exists (
      select 1 from public.transactions t where t.id = import_records.canonical_transaction_id
    );

  update public.import_batches
    set status = case when v_retained = 0 then 'rolled_back' else 'imported' end,
        rolled_back_at = case when v_retained = 0 then now() else null end
  where id = p_batch_id;

  perform public.record_space_audit_event(
    v_batch.workspace_id, 'import.rolled_back', 'import_batch', p_batch_id, null,
    jsonb_build_object(
      'removed', v_removed,
      'retained', v_retained,
      'reasons', to_jsonb(v_reasons)));

  return jsonb_build_object(
    'removed', v_removed,
    'retained', v_retained,
    'reasons', to_jsonb(v_reasons),
    'complete', v_retained = 0);
end;
$$;

comment on function public.rollback_import_batch is
  'Removes only the transactions an import batch created that have not since been merged, hand-edited, or referenced by another record (those are retained and reported). Never touches audit rows. Re-opens the freed staging rows for re-commit. integration.import_approve-gated; caller must own the source. Audited import.rolled_back.';

revoke all on function public.rollback_import_batch(uuid) from public;
grant execute on function public.rollback_import_batch(uuid) to authenticated, service_role;
