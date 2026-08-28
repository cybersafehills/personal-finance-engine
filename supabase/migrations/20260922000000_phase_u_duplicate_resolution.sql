-- Phase U (PR3, backend): the read + dismiss surface for the
-- `possible_duplicate` transactions that Phase U PR2 ingestion now
-- produces in production.
--
--   space_duplicate_review(workspace)     - the review-card feed
--   dismiss_possible_duplicate(txn)       - "not a duplicate" -> unique
--
-- The merge half already exists (merge_duplicate_transaction, PR1). This
-- migration adds no table and no column; it is two functions. The web
-- review UI and the budget/report aggregation change that must exclude
-- `merged` rows are PR3b.

-- ===========================================================================
-- space_duplicate_review: every non-merged transaction that shares a
-- fingerprint with at least one `possible_duplicate` transaction in the
-- given Space, and that the caller is allowed to see. Flat (one row per
-- transaction) - the caller groups by `fingerprint` to build a card.
-- Member-gated for the read; acting on a cluster (merge / dismiss) still
-- needs transaction.categorize.
-- ===========================================================================

create or replace function public.space_duplicate_review(
  p_workspace_id uuid
)
returns table (
  fingerprint text,
  transaction_id uuid,
  dedupe_state text,
  counterparty text,
  amount_minor bigint,
  currency text,
  direction text,
  occurred_at timestamptz,
  source text,
  financial_source_id uuid,
  category text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  with visible as (
    -- Every non-merged transaction in this Space the caller may see.
    -- can_view_source_in_space() already folds in the membership check
    -- (and, for a household, per-source visibility); the auth.uid() null
    -- branch is the service_role reconciler path, mirroring
    -- transaction_duplicate_candidates (PR1).
    select
      t.dedupe_fingerprint as fp,
      t.id,
      t.dedupe_state,
      t.counterparty_name,
      t.amount_rwf,
      t.currency,
      t.direction,
      t.occurred_at,
      t.source,
      t.financial_source_id,
      t.category,
      t.created_at
    from public.transactions t
    where t.workspace_id = p_workspace_id
      and t.dedupe_fingerprint is not null
      and t.dedupe_state <> 'merged'
      and (
        auth.uid() is null
        or public.can_view_source_in_space(t.financial_source_id, t.workspace_id)
      )
  ),
  flagged as (
    select distinct v.fp
    from visible v
    where v.dedupe_state = 'possible_duplicate'
  )
  select
    v.fp,
    v.id,
    v.dedupe_state,
    v.counterparty_name,
    v.amount_rwf,
    v.currency,
    v.direction,
    v.occurred_at,
    v.source,
    v.financial_source_id,
    v.category,
    v.created_at
  from visible v
  join flagged f on f.fp = v.fp
  order by v.fp, v.occurred_at, v.created_at;
$$;

comment on function public.space_duplicate_review is
  'Review feed for a Space''s possible-duplicate transactions: every non-merged transaction sharing a fingerprint with a possible_duplicate row there, that the caller can see. Group by fingerprint to render one card per cluster. Member-gated read; merge/dismiss still need transaction.categorize.';

revoke all on function public.space_duplicate_review(uuid) from public;
grant execute on function public.space_duplicate_review(uuid) to authenticated, service_role;

-- ===========================================================================
-- dismiss_possible_duplicate: the "not a duplicate" action. Only moves a
-- `possible_duplicate` back to `unique` - never touches `merged` or
-- `confirmed_duplicate`, never deletes. transaction.categorize in the
-- row's Space. Audited.
-- ===========================================================================

create or replace function public.dismiss_possible_duplicate(
  p_transaction_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_state text;
begin
  select workspace_id, dedupe_state into v_ws, v_state
  from public.transactions
  where id = p_transaction_id;

  if not found then
    raise exception 'Transaction not found.';
  end if;

  if v_state <> 'possible_duplicate' then
    raise exception 'Only a possible duplicate can be dismissed (this one is %).', v_state;
  end if;

  if auth.uid() is not null
     and not public.has_space_capability(v_ws, 'transaction.categorize') then
    raise exception 'You do not have permission to resolve duplicates in this Space.';
  end if;

  update public.transactions
  set dedupe_state = 'unique'
  where id = p_transaction_id;

  perform public.record_space_audit_event(
    v_ws, 'transaction.duplicate_dismissed', 'transaction', p_transaction_id,
    jsonb_build_object('dedupe_state', 'possible_duplicate'),
    jsonb_build_object('dedupe_state', 'unique'));
end;
$$;

comment on function public.dismiss_possible_duplicate is
  'Marks a possible_duplicate transaction as unique ("not a duplicate"). No-op-safe on any other state (raises). transaction.categorize-gated for an authenticated caller. Audited transaction.duplicate_dismissed.';

revoke all on function public.dismiss_possible_duplicate(uuid) from public;
grant execute on function public.dismiss_possible_duplicate(uuid) to authenticated, service_role;
