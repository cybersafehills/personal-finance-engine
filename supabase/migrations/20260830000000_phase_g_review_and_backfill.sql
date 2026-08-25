-- ===========================================================================
-- Phase G: confidence tiers, review queue, conflict detection, and
-- historical backfill for the categorization policy engine.
--
-- WHAT THIS DOES:
--   1. Adds category_decision_status/suggested_category/suggested_subcategory
--      to transactions so a match can be committed (auto/provisional),
--      merely suggested without being applied (suggested), left alone
--      (uncategorized), flagged for a tied disagreement between policies
--      (conflict), or protected once a human has acted (confirmed).
--   2. Extends apply_manual_category_correction() to also stamp the new
--      status and clear any pending suggestion.
--   3. Adds confirm_transaction_category()/dismiss_suggested_category() -
--      the review-queue actions.
--   4. Adds policy_matches_transaction() plus the three functions built on
--      it (preview count, preview sample, apply-in-batches) and
--      revert_bulk_categorization() - historical backfill, always in
--      bounded batches (no unbounded UPDATE), always protecting any
--      transaction a human has since confirmed or corrected.
--
-- policy_matches_transaction() is a deliberate, narrow duplication of the
-- per-condition predicates in supabase/functions/ingest-momo/policy-engine.ts's
-- evaluatePolicies() - historical backfill only ever needs to ask "does
-- this one policy match this transaction" (no priority/multi-policy
-- resolution), which is far simpler to do here than to route every
-- backfill batch through the Deno edge function over HTTP. The two must
-- be kept in sync by hand; each file's comments point at the other.
-- Known divergence: the `regex` match_type uses Postgres POSIX regex
-- here vs. JavaScript regex in the live engine - identical for simple
-- patterns, may differ on advanced regex features.
-- ===========================================================================

-- ===========================================================================
-- 1. transactions: decision status + pending suggestion.
-- ===========================================================================

alter table public.transactions
  add column category_decision_status text not null default 'uncategorized'
    check (category_decision_status in ('uncategorized', 'suggested', 'provisional', 'auto', 'confirmed', 'conflict')),
  add column suggested_category text,
  add column suggested_subcategory text;

alter table public.transactions
  add constraint transactions_suggested_category_only_when_suggested check (
    suggested_category is null or category_decision_status = 'suggested'
  );

-- One-time backfill of the new column from data already on each row -
-- this sets metadata only, it never changes an existing category or
-- subcategory value.
update public.transactions
  set category_decision_status = case
    when category_source = 'manual' then 'confirmed'
    when category is not null then 'auto'
    else 'uncategorized'
  end
  where category_decision_status = 'uncategorized';

comment on column public.transactions.category_decision_status is
  'uncategorized (no match, or below the suggest threshold) | suggested '
  '(50-89%% evidence not yet applied - see suggested_category) | '
  'provisional (70-89%%, applied but flagged for review) | auto (90%%+, '
  'applied automatically) | confirmed (a human has confirmed or corrected '
  'it - protected from every future automatic overwrite) | conflict (two '
  'equally-credible policies disagreed - nothing applied, see the latest '
  'transaction_category_history row for which policies).';

-- ===========================================================================
-- 2. transaction_category_history: status + bulk-operation grouping.
-- ===========================================================================

alter table public.transaction_category_history
  add column new_decision_status text
    check (new_decision_status is null or new_decision_status in ('uncategorized', 'suggested', 'provisional', 'auto', 'confirmed', 'conflict')),
  add column bulk_operation_id uuid;

create index idx_transaction_category_history_bulk_operation
  on public.transaction_category_history (bulk_operation_id)
  where bulk_operation_id is not null;

-- ===========================================================================
-- 3. apply_manual_category_correction(): also stamp status + clear suggestion.
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
    new_category, new_subcategory, new_category_source, new_category_confidence, new_decision_status,
    decision_reason, actor_type, actor_user_id
  ) values (
    v_txn.id, v_txn.workspace_id,
    v_txn.category, v_txn.subcategory, v_txn.category_source, v_txn.category_confidence,
    p_category, p_subcategory, 'manual', null, 'confirmed',
    'Manually corrected by user', 'user', auth.uid()
  );

  update public.transactions
    set category = p_category, subcategory = p_subcategory, category_source = 'manual', category_confidence = null,
        category_decision_status = 'confirmed', suggested_category = null, suggested_subcategory = null
    where id = p_transaction_id
    returning * into v_txn;

  return v_txn;
end;
$$;

-- ===========================================================================
-- 4. Review-queue actions.
-- ===========================================================================

create or replace function public.confirm_transaction_category(
  p_transaction_id uuid
)
returns public.transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_txn public.transactions;
  v_new_category text;
  v_new_subcategory text;
begin
  select * into v_txn from public.transactions where id = p_transaction_id;

  if not found or not public.is_workspace_member(v_txn.workspace_id, 'member') then
    raise exception 'not_found_or_forbidden';
  end if;

  v_new_category := coalesce(v_txn.suggested_category, v_txn.category);
  v_new_subcategory := coalesce(v_txn.suggested_subcategory, v_txn.subcategory);

  insert into public.transaction_category_history (
    transaction_id, workspace_id,
    previous_category, previous_subcategory, previous_category_source, previous_category_confidence,
    new_category, new_subcategory, new_category_source, new_category_confidence, new_decision_status,
    decision_reason, actor_type, actor_user_id
  ) values (
    v_txn.id, v_txn.workspace_id,
    v_txn.category, v_txn.subcategory, v_txn.category_source, v_txn.category_confidence,
    v_new_category, v_new_subcategory, 'manual', null, 'confirmed',
    'Confirmed by user', 'user', auth.uid()
  );

  update public.transactions
    set category = v_new_category, subcategory = v_new_subcategory, category_source = 'manual', category_confidence = null,
        category_decision_status = 'confirmed', suggested_category = null, suggested_subcategory = null
    where id = p_transaction_id
    returning * into v_txn;

  return v_txn;
end;
$$;

create or replace function public.dismiss_suggested_category(
  p_transaction_id uuid
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

  if v_txn.category_decision_status not in ('suggested', 'conflict') then
    raise exception 'nothing_to_dismiss';
  end if;

  insert into public.transaction_category_history (
    transaction_id, workspace_id,
    previous_category, previous_subcategory, previous_category_source, previous_category_confidence,
    new_category, new_subcategory, new_category_source, new_category_confidence, new_decision_status,
    decision_reason, actor_type, actor_user_id
  ) values (
    v_txn.id, v_txn.workspace_id,
    v_txn.category, v_txn.subcategory, v_txn.category_source, v_txn.category_confidence,
    null, null, 'system', null, 'uncategorized',
    'Suggestion dismissed by user', 'user', auth.uid()
  );

  update public.transactions
    set category_decision_status = 'uncategorized', suggested_category = null, suggested_subcategory = null
    where id = p_transaction_id
    returning * into v_txn;

  return v_txn;
end;
$$;

revoke all on function public.confirm_transaction_category(uuid) from public;
revoke all on function public.dismiss_suggested_category(uuid) from public;
grant execute on function public.confirm_transaction_category(uuid) to authenticated;
grant execute on function public.dismiss_suggested_category(uuid) to authenticated;

-- ===========================================================================
-- 5. policy_matches_transaction() and historical backfill.
-- ===========================================================================

create or replace function public.policy_matches_transaction(
  p_policy public.categorization_policies,
  p_txn public.transactions
)
returns boolean
language sql
stable
as $$
  select
    (
      p_policy.merchant_pattern is null
      or (
        p_txn.counterparty_name is not null
        and case p_policy.match_type
          when 'exact' then lower(trim(both from p_txn.counterparty_name)) = lower(trim(both from p_policy.merchant_pattern))
          when 'contains' then lower(p_txn.counterparty_name) like '%' || lower(p_policy.merchant_pattern) || '%'
          when 'starts_with' then lower(p_txn.counterparty_name) like lower(p_policy.merchant_pattern) || '%'
          when 'regex' then p_txn.counterparty_name ~* p_policy.merchant_pattern
          else false
        end
      )
    )
    and (p_policy.direction is null or p_policy.direction = p_txn.direction)
    and (p_policy.amount_min_rwf is null or p_txn.amount_rwf >= p_policy.amount_min_rwf)
    and (p_policy.amount_max_rwf is null or p_txn.amount_rwf <= p_policy.amount_max_rwf)
    and (
      p_policy.time_start is null or p_policy.time_end is null
      or (
        case when p_policy.time_start <= p_policy.time_end then
          (p_txn.occurred_at at time zone (select w.timezone from public.workspaces w where w.id = p_policy.workspace_id))::time
            between p_policy.time_start and p_policy.time_end
        else
          (p_txn.occurred_at at time zone (select w.timezone from public.workspaces w where w.id = p_policy.workspace_id))::time >= p_policy.time_start
          or (p_txn.occurred_at at time zone (select w.timezone from public.workspaces w where w.id = p_policy.workspace_id))::time <= p_policy.time_end
        end
      )
    );
$$;

create or replace function public.preview_policy_historical_match_count(
  p_policy_id uuid
)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_policy public.categorization_policies;
  v_count bigint;
begin
  select * into v_policy from public.categorization_policies where id = p_policy_id;

  if not found or not public.is_workspace_member(v_policy.workspace_id, 'member') then
    raise exception 'not_found_or_forbidden';
  end if;

  select count(*) into v_count
  from public.transactions t
  where t.workspace_id = v_policy.workspace_id
    and t.category_decision_status = 'uncategorized'
    and public.policy_matches_transaction(v_policy, t);

  return v_count;
end;
$$;

create or replace function public.preview_policy_historical_matches(
  p_policy_id uuid,
  p_limit integer default 10
)
returns setof public.transactions
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_policy public.categorization_policies;
begin
  select * into v_policy from public.categorization_policies where id = p_policy_id;

  if not found or not public.is_workspace_member(v_policy.workspace_id, 'member') then
    raise exception 'not_found_or_forbidden';
  end if;

  return query
    select t.*
    from public.transactions t
    where t.workspace_id = v_policy.workspace_id
      and t.category_decision_status = 'uncategorized'
      and public.policy_matches_transaction(v_policy, t)
    order by t.occurred_at desc
    limit p_limit;
end;
$$;

create or replace function public.apply_policy_to_historical(
  p_policy_id uuid,
  p_bulk_operation_id uuid,
  p_batch_size integer default 200
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_policy public.categorization_policies;
  v_tier text;
  v_count integer;
begin
  select * into v_policy from public.categorization_policies where id = p_policy_id;

  if not found or not public.is_workspace_member(v_policy.workspace_id, 'member') then
    raise exception 'not_found_or_forbidden';
  end if;

  v_tier := case
    when v_policy.confidence >= 0.90 then 'auto'
    when v_policy.confidence >= 0.70 then 'provisional'
    when v_policy.confidence >= 0.50 then 'suggested'
    else 'uncategorized'
  end;

  -- Below the suggest threshold, this policy never applies historically
  -- either - nothing to do.
  if v_tier = 'uncategorized' then
    return 0;
  end if;

  with batch as (
    select t.id
    from public.transactions t
    where t.workspace_id = v_policy.workspace_id
      and t.category_decision_status = 'uncategorized'
      and public.policy_matches_transaction(v_policy, t)
    order by t.occurred_at asc
    limit p_batch_size
    for update of t
  ),
  updated as (
    update public.transactions t
      set category = case when v_tier in ('auto', 'provisional') then v_policy.category else t.category end,
          subcategory = case when v_tier in ('auto', 'provisional') then v_policy.subcategory else t.subcategory end,
          category_source = case when v_tier in ('auto', 'provisional') then 'rule' else t.category_source end,
          category_confidence = case when v_tier in ('auto', 'provisional') then v_policy.confidence else t.category_confidence end,
          suggested_category = case when v_tier = 'suggested' then v_policy.category else t.suggested_category end,
          suggested_subcategory = case when v_tier = 'suggested' then v_policy.subcategory else t.suggested_subcategory end,
          category_decision_status = v_tier
      from batch
      where t.id = batch.id
      returning t.id
  )
  insert into public.transaction_category_history (
    transaction_id, workspace_id,
    new_category, new_subcategory, new_category_source, new_category_confidence, new_decision_status,
    decision_reason, policy_id, actor_type, engine_version, bulk_operation_id
  )
  select
    u.id, v_policy.workspace_id,
    case when v_tier in ('auto', 'provisional') then v_policy.category else null end,
    case when v_tier in ('auto', 'provisional') then v_policy.subcategory else null end,
    'rule', v_policy.confidence, v_tier,
    format('Applied historically by policy "%s".', coalesce(v_policy.name, v_policy.category)),
    v_policy.id, 'system', 'policy-engine@2-backfill', p_bulk_operation_id
  from updated u;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.revert_bulk_categorization(
  p_bulk_operation_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_count integer;
begin
  select workspace_id into v_workspace_id
  from public.transaction_category_history
  where bulk_operation_id = p_bulk_operation_id
  limit 1;

  if v_workspace_id is null or not public.is_workspace_member(v_workspace_id, 'member') then
    raise exception 'not_found_or_forbidden';
  end if;

  with reverted as (
    update public.transactions t
      set category = null, subcategory = null, category_source = null, category_confidence = null,
          suggested_category = null, suggested_subcategory = null, category_decision_status = 'uncategorized'
      from public.transaction_category_history h
      where h.bulk_operation_id = p_bulk_operation_id
        and t.id = h.transaction_id
        -- Protects any transaction a human has since confirmed or
        -- corrected - the same manual-decision-protection principle as
        -- the rest of this engine. Only rows still exactly as this batch
        -- left them are reverted: an auto/provisional row only ever gets
        -- category_source='rule' set (never touched again until a human
        -- acts, which flips it to 'manual'), but a suggested row never
        -- gets category_source touched at all - its own "untouched"
        -- signal is category_decision_status still being 'suggested'
        -- (confirming sets it to 'confirmed', dismissing to
        -- 'uncategorized' already, either way nothing left to revert).
        and (
          (h.new_decision_status in ('auto', 'provisional') and t.category_source = 'rule')
          or (h.new_decision_status = 'suggested' and t.category_decision_status = 'suggested')
        )
      returning t.id
  )
  insert into public.transaction_category_history (
    transaction_id, workspace_id,
    new_category, new_subcategory, new_category_source, new_category_confidence, new_decision_status,
    decision_reason, actor_type, actor_user_id
  )
  select
    r.id, v_workspace_id,
    null, null, 'system', null, 'uncategorized',
    'Bulk categorization reverted by user.', 'user', auth.uid()
  from reverted r;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.preview_policy_historical_match_count(uuid) from public;
revoke all on function public.preview_policy_historical_matches(uuid, integer) from public;
revoke all on function public.apply_policy_to_historical(uuid, uuid, integer) from public;
revoke all on function public.revert_bulk_categorization(uuid) from public;
grant execute on function public.preview_policy_historical_match_count(uuid) to authenticated;
grant execute on function public.preview_policy_historical_matches(uuid, integer) to authenticated;
grant execute on function public.apply_policy_to_historical(uuid, uuid, integer) to authenticated;
grant execute on function public.revert_bulk_categorization(uuid) to authenticated;
