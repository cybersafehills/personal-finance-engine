-- Phase U (PR1): ingestion routing + duplicate-detection primitives.
--
-- Lays the SQL foundation the ingest-momo cutover (PR2, a Deno change)
-- will call, without touching the Edge Function yet:
--
--   compute_transaction_fingerprint(...)     - the dedup signal
--   resolve_ingestion_target(connection, at) - where a new txn routes
--   transaction_duplicate_candidates(fp, ..) - same-fingerprint peers
--   merge_duplicate_transaction(dup, canon)  - reconcile, never delete
--
-- Additive: 3 columns on transactions, 4 functions, no new table. No
-- behaviour change until PR2 wires ingestion to these.

-- ===========================================================================
-- transactions: duplicate-detection state. Evidence is never destroyed on
-- a merge (master prompt §16) - the row stays, dedupe_state='merged' and
-- merged_into_transaction_id points at the canonical one. Budget/report
-- aggregation excludes merged rows (a PR2/PR3 query change).
-- ===========================================================================

alter table public.transactions
  add column dedupe_fingerprint text,
  add column dedupe_state text not null default 'unique'
    check (dedupe_state in ('unique', 'possible_duplicate', 'confirmed_duplicate', 'merged')),
  add column merged_into_transaction_id uuid references public.transactions (id);

alter table public.transactions
  add constraint transactions_merged_consistent check (
    (dedupe_state = 'merged') = (merged_into_transaction_id is not null)
  );

comment on column public.transactions.dedupe_fingerprint is
  'Normalized duplicate-detection signal (compute_transaction_fingerprint). NULL for pre-Phase-U rows; populated by ingestion going forward.';
comment on column public.transactions.dedupe_state is
  'unique | possible_duplicate (surfaced for review) | confirmed_duplicate | merged (superseded by merged_into_transaction_id; row kept for evidence, excluded from aggregation).';

create index idx_transactions_dedupe_fingerprint
  on public.transactions (dedupe_fingerprint)
  where dedupe_fingerprint is not null;

-- ===========================================================================
-- compute_transaction_fingerprint: pure/IMMUTABLE. Source + masked id +
-- amount + currency + direction + counterparty (whitespace-collapsed) +
-- occurred_at rounded to the minute. Ingestion-only (service_role).
-- ===========================================================================

create or replace function public.compute_transaction_fingerprint(
  p_source text,
  p_masked_identifier text,
  p_amount_minor bigint,
  p_currency text,
  p_direction text,
  p_counterparty text,
  p_occurred_at timestamptz
)
returns text
language sql
immutable
as $$
  select
    lower(coalesce(p_source, '')) || '|'
    || lower(regexp_replace(coalesce(p_masked_identifier, ''), '[^A-Za-z0-9]', '', 'g')) || '|'
    || coalesce(p_amount_minor, 0)::text || '|'
    || upper(coalesce(p_currency, '')) || '|'
    || lower(coalesce(p_direction, '')) || '|'
    || lower(btrim(regexp_replace(coalesce(p_counterparty, ''), '\s+', ' ', 'g'))) || '|'
    || to_char(
         date_trunc('minute', coalesce(p_occurred_at, 'epoch'::timestamptz) at time zone 'UTC'),
         'YYYY-MM-DD"T"HH24:MI');
$$;

comment on function public.compute_transaction_fingerprint is
  'Deterministic duplicate-detection fingerprint for a transaction. Pure/IMMUTABLE. Ingestion-only.';

revoke all on function public.compute_transaction_fingerprint(text, text, bigint, text, text, text, timestamptz) from public;
grant execute on function public.compute_transaction_fingerprint(text, text, bigint, text, text, text, timestamptz) to service_role;

-- ===========================================================================
-- resolve_ingestion_target: given an ingestion connection and a
-- transaction's date, where does the canonical transaction go? Default is
-- the connection's own bound workspace; a source with an active
-- is_default_target link whose window has opened (effective_from <= at)
-- overrides it. Ingestion-only (service_role).
-- ===========================================================================

create or replace function public.resolve_ingestion_target(
  p_ingestion_connection_id uuid,
  p_occurred_at timestamptz
)
returns table (workspace_id uuid, financial_source_id uuid)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_conn_ws uuid;
  v_account_id uuid;
  v_source_id uuid;
  v_link_ws uuid;
  v_target_ws uuid;
begin
  select ic.workspace_id, ic.account_id
    into v_conn_ws, v_account_id
  from public.ingestion_connections ic
  where ic.id = p_ingestion_connection_id and ic.status = 'active';
  if not found then
    return;  -- unknown or revoked connection: no target
  end if;

  select a.financial_source_id into v_source_id
  from public.accounts a where a.id = v_account_id;

  v_target_ws := v_conn_ws;

  if v_source_id is not null then
    select l.workspace_id into v_link_ws
    from public.source_space_links l
    where l.financial_source_id = v_source_id
      and l.is_default_target
      and l.status = 'active'
      and l.effective_from <= p_occurred_at
    limit 1;

    if v_link_ws is not null then
      v_target_ws := v_link_ws;
    end if;
  end if;

  return query select v_target_ws, v_source_id;
end;
$$;

comment on function public.resolve_ingestion_target is
  'Routing decision for one incoming transaction: (workspace_id, financial_source_id). Default = the connection''s bound workspace; an active is_default_target source link that has opened (effective_from <= p_occurred_at) overrides it. Ingestion-only.';

revoke all on function public.resolve_ingestion_target(uuid, timestamptz) from public;
grant execute on function public.resolve_ingestion_target(uuid, timestamptz) to service_role;

-- ===========================================================================
-- transaction_duplicate_candidates: same-fingerprint transactions the
-- caller can see (or all, for a service-role reconciler), excluding
-- already-merged rows and an optional self id.
-- ===========================================================================

create or replace function public.transaction_duplicate_candidates(
  p_fingerprint text,
  p_exclude_id uuid default null
)
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select t.id
  from public.transactions t
  where t.dedupe_fingerprint is not null
    and t.dedupe_fingerprint = p_fingerprint
    and t.dedupe_state <> 'merged'
    and (p_exclude_id is null or t.id <> p_exclude_id)
    and (
      auth.uid() is null
      or public.can_view_source_in_space(t.financial_source_id, t.workspace_id)
    );
$$;

revoke all on function public.transaction_duplicate_candidates(text, uuid) from public;
grant execute on function public.transaction_duplicate_candidates(text, uuid) to authenticated, service_role;

-- ===========================================================================
-- merge_duplicate_transaction: mark p_duplicate_id as merged into
-- p_canonical_id. The row is NOT deleted (evidence is preserved). Both
-- must be in the same Space; an authenticated caller needs
-- transaction.categorize there. Audited.
-- ===========================================================================

create or replace function public.merge_duplicate_transaction(
  p_duplicate_id uuid,
  p_canonical_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dup_ws uuid;
  v_dup_state text;
  v_canon_ws uuid;
begin
  if p_duplicate_id = p_canonical_id then
    raise exception 'A transaction cannot be merged into itself.';
  end if;

  select workspace_id, dedupe_state into v_dup_ws, v_dup_state
  from public.transactions where id = p_duplicate_id;
  if not found then
    raise exception 'Transaction not found.';
  end if;

  select workspace_id into v_canon_ws
  from public.transactions where id = p_canonical_id;
  if not found then
    raise exception 'Canonical transaction not found.';
  end if;

  if v_dup_ws <> v_canon_ws then
    raise exception 'Both transactions must be in the same Space.';
  end if;
  if v_dup_state = 'merged' then
    raise exception 'That transaction is already merged.';
  end if;

  if auth.uid() is not null
     and not public.has_space_capability(v_dup_ws, 'transaction.categorize') then
    raise exception 'You do not have permission to reconcile transactions in this Space.';
  end if;

  update public.transactions
  set dedupe_state = 'merged',
      merged_into_transaction_id = p_canonical_id
  where id = p_duplicate_id;

  perform public.record_space_audit_event(
    v_dup_ws, 'transaction.duplicate_merged', 'transaction', p_duplicate_id,
    null, jsonb_build_object('merged_into', p_canonical_id));
end;
$$;

revoke all on function public.merge_duplicate_transaction(uuid, uuid) from public;
grant execute on function public.merge_duplicate_transaction(uuid, uuid) to authenticated, service_role;
