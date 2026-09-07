-- Extra categorization-rule conditions: day-of-week, day-of-month,
-- transaction type, fee range, round-number amount.
--
-- categorization_policies (Phase F/G/U) matched on counterparty pattern,
-- direction, amount range and time-of-day window. This adds five more
-- optional, AND-composed conditions. As with the existing ones the match
-- logic lives in TWO hand-synced places:
--   * public.policy_matches_transaction()  (this file, below)
--   * supabase/functions/ingest-momo/policy-engine.ts evaluatePolicies()
-- Keep them in step.
--
-- Day-of-week is stored as ISO day-of-week (1 = Monday … 7 = Sunday) to
-- line up with Postgres extract(isodow ...) and JS getUTCDay()+offset.
-- All comparisons use the workspace's own timezone, same as the existing
-- time-of-day window.

alter table public.categorization_policies
  add column days_of_week smallint[],
  add column days_of_month smallint[],
  add column transaction_types text[],
  add column fee_min_rwf bigint check (fee_min_rwf is null or fee_min_rwf >= 0),
  add column fee_max_rwf bigint check (fee_max_rwf is null or fee_max_rwf >= 0),
  add column amount_round_multiple integer
    check (amount_round_multiple is null or amount_round_multiple in (100, 1000));

alter table public.categorization_policies
  add constraint categorization_policies_days_of_week_check
    check (
      days_of_week is null
      or (cardinality(days_of_week) > 0
          and days_of_week <@ array[1,2,3,4,5,6,7]::smallint[])
    ),
  add constraint categorization_policies_days_of_month_check
    check (
      days_of_month is null
      or (cardinality(days_of_month) > 0
          and days_of_month <@ array[
            1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,
            17,18,19,20,21,22,23,24,25,26,27,28,29,30,31
          ]::smallint[])
    ),
  add constraint categorization_policies_transaction_types_check
    check (
      transaction_types is null
      or (cardinality(transaction_types) > 0
          and transaction_types <@ array[
            'send_money','merchant_payment','money_received','airtime',
            'cash_withdrawal','cash_deposit','bill_payment','bank_transfer',
            'refund','reversal','other'
          ]::text[])
    ),
  add constraint categorization_policies_fee_range_check
    check (
      fee_min_rwf is null or fee_max_rwf is null
      or fee_max_rwf >= fee_min_rwf
    );

-- Widen the "at least one condition" guard to include the new fields.
alter table public.categorization_policies
  drop constraint categorization_policies_has_condition_check;
alter table public.categorization_policies
  add constraint categorization_policies_has_condition_check
    check (
      merchant_pattern is not null
      or direction is not null
      or amount_min_rwf is not null
      or amount_max_rwf is not null
      or time_start is not null
      or days_of_week is not null
      or days_of_month is not null
      or transaction_types is not null
      or fee_min_rwf is not null
      or fee_max_rwf is not null
      or amount_round_multiple is not null
    );

-- Re-issue policy_matches_transaction() with the five new AND clauses.
-- Everything above the new block is byte-identical to the Phase U
-- (20260924000000) definition.
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
    )
    -- New in 20261207000000:
    and (
      p_policy.days_of_week is null
      or extract(isodow from (p_txn.occurred_at at time zone (select w.timezone from public.workspaces w where w.id = p_policy.workspace_id)))::smallint = any(p_policy.days_of_week)
    )
    and (
      p_policy.days_of_month is null
      or extract(day from (p_txn.occurred_at at time zone (select w.timezone from public.workspaces w where w.id = p_policy.workspace_id)))::smallint = any(p_policy.days_of_month)
    )
    and (p_policy.transaction_types is null or p_txn.transaction_type = any(p_policy.transaction_types))
    and (p_policy.fee_min_rwf is null or p_txn.fee_rwf >= p_policy.fee_min_rwf)
    and (p_policy.fee_max_rwf is null or p_txn.fee_rwf <= p_policy.fee_max_rwf)
    and (p_policy.amount_round_multiple is null or p_txn.amount_rwf % p_policy.amount_round_multiple = 0);
$$;

comment on column public.categorization_policies.days_of_week is
  'ISO day-of-week list (1=Mon … 7=Sun), evaluated in the workspace timezone. Null = any day.';
comment on column public.categorization_policies.amount_round_multiple is
  'When set (100 or 1000), matches only amounts that are an exact multiple.';
