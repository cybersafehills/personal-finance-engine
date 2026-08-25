-- ===========================================================================
-- Phase H: learned-policy suggestions (spec §14).
--
-- WHAT THIS DOES: detects repeated manual corrections to the same
-- counterparty landing on the same category/subcategory, and surfaces
-- them as a proposed (never auto-created) policy. There is no background
-- job infrastructure in this app (see increment 1's investigation), so
-- suggestions are computed on demand from data that already exists
-- (transaction_category_history + transactions) rather than materialized
-- by a scheduled job. Accepting a suggestion creates an ordinary
-- categorization_policies row - no new "apply" mechanism, it's the exact
-- same table the policy management UI (Phase F/G) already writes to.
--
-- learned_policy_suggestion_decisions exists only so a dismissed or
-- accepted suggestion never resurfaces - since suggestions are computed
-- fresh every time (never stored as rows), a stable synthetic key
-- (md5 of counterparty|category|subcategory) is the only way to
-- recognize "this is the same suggestion as before" across recomputations.
-- ===========================================================================

create table public.learned_policy_suggestion_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id),
  suggestion_key text not null
    check (length(trim(both from suggestion_key)) > 0),
  status text not null check (status in ('accepted', 'dismissed')),
  decided_by uuid references auth.users (id),
  decided_at timestamptz not null default now(),
  constraint learned_policy_suggestion_decisions_unique unique (workspace_id, suggestion_key)
);

create index idx_learned_policy_suggestion_decisions_workspace
  on public.learned_policy_suggestion_decisions (workspace_id);

alter table public.learned_policy_suggestion_decisions enable row level security;

create policy learned_policy_suggestion_decisions_select_member on public.learned_policy_suggestion_decisions
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy learned_policy_suggestion_decisions_write_member on public.learned_policy_suggestion_decisions
  for insert to authenticated
  with check (public.is_workspace_member(workspace_id, 'member'));

revoke all on public.learned_policy_suggestion_decisions from anon;
grant select, insert on public.learned_policy_suggestion_decisions to authenticated;
grant select, insert, update, delete on public.learned_policy_suggestion_decisions to service_role;

-- ===========================================================================
-- detect_learned_policy_suggestions(): the detection query itself.
-- ===========================================================================

create or replace function public.detect_learned_policy_suggestions(
  p_workspace_id uuid,
  p_min_occurrences integer default 3
)
returns table (
  suggestion_key text,
  counterparty_name text,
  category text,
  subcategory text,
  occurrence_count bigint,
  last_occurred_at timestamptz,
  sample_transaction_ids uuid[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'not_found_or_forbidden';
  end if;

  return query
    with corrections as (
      select
        trim(both from t.counterparty_name) as counterparty_name,
        h.new_category as category,
        h.new_subcategory as subcategory,
        t.id as transaction_id,
        t.occurred_at
      from public.transaction_category_history h
      join public.transactions t on t.id = h.transaction_id
      where h.workspace_id = p_workspace_id
        and h.actor_type = 'user'
        and h.new_category_source = 'manual'
        and h.new_category is not null
        and t.counterparty_name is not null
        and trim(both from t.counterparty_name) <> ''
    ),
    grouped as (
      select
        md5(
          lower(c.counterparty_name) || '|' || c.category || '|' || coalesce(c.subcategory, '')
        ) as suggestion_key,
        c.counterparty_name,
        c.category,
        c.subcategory,
        count(*) as occurrence_count,
        max(c.occurred_at) as last_occurred_at,
        (array_agg(c.transaction_id order by c.occurred_at desc))[1:5] as sample_transaction_ids
      from corrections c
      group by 1, 2, 3, 4
      having count(*) >= p_min_occurrences
    )
    select g.*
    from grouped g
    where not exists (
      select 1 from public.learned_policy_suggestion_decisions d
      where d.workspace_id = p_workspace_id and d.suggestion_key = g.suggestion_key
    )
    and not exists (
      select 1 from public.categorization_policies p
      where p.workspace_id = p_workspace_id
        and p.is_active
        and p.category = g.category
        and coalesce(p.subcategory, '') = coalesce(g.subcategory, '')
        and p.merchant_pattern is not null
        and (
          (p.match_type = 'exact' and lower(p.merchant_pattern) = lower(g.counterparty_name))
          or (p.match_type = 'contains' and lower(g.counterparty_name) like '%' || lower(p.merchant_pattern) || '%')
        )
    )
    order by last_occurred_at desc;
end;
$$;

revoke all on function public.detect_learned_policy_suggestions(uuid, integer) from public;
grant execute on function public.detect_learned_policy_suggestions(uuid, integer) to authenticated;
