-- ===========================================================================
-- Phase F: Categorization Policy Engine, increment 1 (deterministic core).
--
-- WHAT THIS DOES:
--   1. Renames merchant_rules -> categorization_policies (metadata-only,
--      no data rewrite) and extends it with direction/amount-range/
--      time-of-day conditions, plus name/description/created_by so a
--      policy can be explained in plain language. Every new column is
--      nullable and existing rows are untouched, so every rule seeded
--      before this migration keeps matching exactly as it did before -
--      this is purely additive from the data's point of view.
--   2. Adds transaction_category_history: an append-only audit trail for
--      every category assignment or correction (no update/delete policy
--      for authenticated, matching this project's established
--      append-only convention - see goal_contributions, processing_errors).
--   3. Adds apply_manual_category_correction(): a SECURITY DEFINER
--      function that makes "update the transaction" and "write the
--      history row" a single atomic operation, replacing the two
--      separate client-side calls the correctCategory Server Action used
--      to make.
--
-- WHAT THIS NEVER DOES: touch existing transaction category assignments,
-- reclassify history, or introduce a review queue / learned suggestions /
-- background jobs / AI / location - those are later increments per the
-- categorization-policy-engine plan. See categorization_policies'
-- comments below for the still-unimplemented parts of the full spec
-- (confidence-tier scoring, conflict detection) that this table's shape
-- deliberately leaves room for without committing to them yet.
-- ===========================================================================

-- ===========================================================================
-- 1. merchant_rules -> categorization_policies
-- ===========================================================================

alter table public.merchant_rules rename to categorization_policies;

alter index idx_merchant_rules_active_priority
  rename to idx_categorization_policies_active_priority;
alter index idx_merchant_rules_workspace
  rename to idx_categorization_policies_workspace;

alter table public.categorization_policies
  rename constraint merchant_rules_pkey to categorization_policies_pkey;

-- merchant_pattern was `not null` with a non-empty check - loosened here so
-- a policy can rely purely on direction/amount/time conditions without a
-- counterparty pattern. The condition-presence check further down still
-- guarantees a policy can never be a condition-less wildcard.
alter table public.categorization_policies
  alter column merchant_pattern drop not null;

alter table public.categorization_policies
  drop constraint merchant_rules_merchant_pattern_check;

alter table public.categorization_policies
  add constraint categorization_policies_merchant_pattern_check
    check (merchant_pattern is null or length(trim(both from merchant_pattern)) > 0);

alter table public.categorization_policies
  add column name text,
  add column description text,
  add column created_by uuid references auth.users (id),
  add column direction text
    check (direction is null or direction in ('in', 'out', 'neutral')),
  add column amount_min_rwf bigint check (amount_min_rwf is null or amount_min_rwf >= 0),
  add column amount_max_rwf bigint check (amount_max_rwf is null or amount_max_rwf >= 0),
  add column time_start time,
  add column time_end time;

alter table public.categorization_policies
  add constraint categorization_policies_amount_range_check
    check (
      amount_min_rwf is null or amount_max_rwf is null
      or amount_max_rwf >= amount_min_rwf
    ),
  add constraint categorization_policies_time_window_check
    check ((time_start is null) = (time_end is null)),
  add constraint categorization_policies_has_condition_check
    check (
      merchant_pattern is not null
      or direction is not null
      or amount_min_rwf is not null
      or amount_max_rwf is not null
      or time_start is not null
    );

comment on table public.categorization_policies is
  'Deterministic categorization policies (formerly merchant_rules). Each '
  'row is a set of AND-composed, optional conditions (counterparty '
  'pattern, direction, amount range, time-of-day window) plus a category '
  'outcome. First match wins, evaluated in ascending priority order with '
  'condition-count (specificity) as a tie-breaker - see '
  'evaluatePolicies() in supabase/functions/ingest-momo/policy-engine.ts. '
  'confidence remains a static per-row value in this increment; dynamic '
  'evidence-weighted scoring and explicit conflict-requiring-review '
  'states are deferred to a later increment.';

-- Rename RLS policies for consistency with the new table name. Same
-- authorization shape as before (unchanged from
-- 20260827000000_organization_workspaces.sql), just re-created under
-- categorization_policies_* names.
drop policy merchant_rules_select_member on public.categorization_policies;
drop policy merchant_rules_write_member on public.categorization_policies;
drop policy merchant_rules_update_member on public.categorization_policies;

create policy categorization_policies_select_member on public.categorization_policies
  for select to authenticated
  using (workspace_id is not null and public.is_workspace_member(workspace_id));

create policy categorization_policies_write_member on public.categorization_policies
  for insert to authenticated
  with check (public.is_workspace_member(workspace_id, 'member'));

create policy categorization_policies_update_member on public.categorization_policies
  for update to authenticated
  using (public.is_workspace_member(workspace_id, 'member'))
  with check (public.is_workspace_member(workspace_id, 'member'));

-- ===========================================================================
-- 2. transaction_category_history - append-only audit trail.
-- ===========================================================================

create table public.transaction_category_history (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id),
  workspace_id uuid not null references public.workspaces (id),
  previous_category text,
  previous_subcategory text,
  previous_category_source text,
  previous_category_confidence numeric(5, 4),
  new_category text,
  new_subcategory text,
  new_category_source text not null
    check (new_category_source in ('rule', 'ai', 'manual', 'system')),
  new_category_confidence numeric(5, 4)
    check (new_category_confidence is null or (new_category_confidence >= 0 and new_category_confidence <= 1)),
  decision_reason text,
  policy_id uuid references public.categorization_policies (id) on delete set null,
  actor_type text not null check (actor_type in ('user', 'ingestion_engine', 'system')),
  actor_user_id uuid references auth.users (id),
  engine_version text,
  created_at timestamptz not null default now(),
  constraint transaction_category_history_actor_consistency check (
    (actor_type = 'user' and actor_user_id is not null)
    or (actor_type <> 'user' and actor_user_id is null)
  )
);

comment on table public.transaction_category_history is
  'Append-only record of every category assignment or correction. No '
  'update or delete is ever permitted (matching the goal_contributions / '
  'processing_errors convention) - a wrong entry is superseded by a new '
  'row, never edited in place. Rows are written either by the ingest '
  'edge function (service_role, actor_type=''ingestion_engine'') or via '
  'apply_manual_category_correction() (actor_type=''user'') - '
  'authenticated has no direct insert grant on this table.';

create index idx_transaction_category_history_transaction
  on public.transaction_category_history (transaction_id, created_at desc);
create index idx_transaction_category_history_workspace
  on public.transaction_category_history (workspace_id);

alter table public.transaction_category_history enable row level security;

create policy transaction_category_history_select_member on public.transaction_category_history
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

revoke all on public.transaction_category_history from anon, authenticated;
grant select on public.transaction_category_history to authenticated;
grant select, insert, update, delete on public.transaction_category_history to service_role;

-- ===========================================================================
-- 3. apply_manual_category_correction - atomic manual override.
-- ===========================================================================

create or replace function public.apply_manual_category_correction(
  p_transaction_id uuid,
  p_category text,
  p_subcategory text
)
returns public.transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_txn public.transactions;
begin
  select * into v_txn from public.transactions where id = p_transaction_id;

  if not found or not public.is_workspace_member(v_txn.workspace_id, 'member') then
    raise exception 'not_found_or_forbidden';
  end if;

  insert into public.transaction_category_history (
    transaction_id, workspace_id,
    previous_category, previous_subcategory, previous_category_source, previous_category_confidence,
    new_category, new_subcategory, new_category_source, new_category_confidence,
    decision_reason, actor_type, actor_user_id
  ) values (
    v_txn.id, v_txn.workspace_id,
    v_txn.category, v_txn.subcategory, v_txn.category_source, v_txn.category_confidence,
    p_category, p_subcategory, 'manual', null,
    'Manually corrected by user', 'user', auth.uid()
  );

  update public.transactions
    set category = p_category, subcategory = p_subcategory, category_source = 'manual', category_confidence = null
    where id = p_transaction_id
    returning * into v_txn;

  return v_txn;
end;
$$;

comment on function public.apply_manual_category_correction(uuid, text, text) is
  'Atomically updates a transaction''s category and writes the matching '
  'transaction_category_history row. Runs SECURITY DEFINER (so it can '
  'write the history table, which authenticated has no direct insert '
  'grant on) but re-checks workspace membership itself via '
  'is_workspace_member(), independent of the caller''s RLS - a caller '
  'outside the transaction''s workspace gets not_found_or_forbidden, '
  'never a peek at the row.';

revoke all on function public.apply_manual_category_correction(uuid, text, text) from public;
grant execute on function public.apply_manual_category_correction(uuid, text, text) to authenticated;
