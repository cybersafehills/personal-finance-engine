-- Phase U (PR6, backend): a `scope` on categorization policies.
--
-- A policy is either 'space'-scoped (the existing behaviour - it applies
-- to every transaction in the workspace) or 'source'-scoped (it applies
-- only to transactions from one financial source, e.g. "everything from
-- my Airtel line is Personal"). A source-scoped policy outranks a
-- space-scoped one *within the same priority tier* - priority is still
-- the primary ordering, so a deliberately-high-priority space rule is
-- never overridden by a narrower one.
--
-- Additive: two columns (one defaulted, one nullable), a consistency
-- CHECK, and a scope clause folded into policy_matches_transaction(). No
-- new table / grant / function / policy - existing policies get
-- scope_type = 'space' and behave exactly as before.
--
-- 'member' scope (apply only to a given member's spend) is deliberately
-- NOT added here: attribution is unknown at ingestion time, so it would
-- need a post-attribution re-categorization pass that does not exist yet.

alter table public.categorization_policies
  add column scope_type text not null default 'space'
    check (scope_type in ('space', 'source')),
  add column scope_source_id uuid references public.financial_sources (id);

alter table public.categorization_policies
  add constraint categorization_policies_scope_consistent check (
    (scope_type = 'space' and scope_source_id is null)
    or (scope_type = 'source' and scope_source_id is not null)
  );

comment on column public.categorization_policies.scope_type is
  'space (default - every transaction in the workspace) | source (only transactions whose financial_source_id = scope_source_id). A source-scoped policy outranks a space-scoped one within the same priority tier; priority still wins across tiers.';

create index idx_categorization_policies_scope_source
  on public.categorization_policies (scope_source_id)
  where scope_source_id is not null;

-- policy_matches_transaction() (Phase G, 20260830000000) gains the scope
-- gate so historical preview / backfill against a single policy honours
-- it too. This mirrors matchesScope() in
-- supabase/functions/ingest-momo/policy-engine.ts - keep the two in sync
-- by hand, as its comment already notes for the condition matchers.
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
      p_policy.scope_type <> 'source'
      or p_policy.scope_source_id = p_txn.financial_source_id
    )
    and (
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
