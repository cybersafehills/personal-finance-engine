-- balance_observations: honour per-Space SOURCE visibility.
--
-- The S3 migration (20261224000000_balance_observations.sql) let any workspace
-- member read every balance observation in the workspace. In a household Space
-- that is wrong: a member must not see data for a co-member's financial source
-- unless the owner has shared it into the Space (ADR 0005; the hard privacy rule
-- that transactions and accounts already follow through
-- can_view_source_in_space()). A balance a person typed in for a private wallet
-- was therefore readable by every other member of the household straight from
-- the table, even though the Wallets page only listed wallets they may see.
--
-- Two changes, both following the pattern the newer 3.0 tables already use
-- (utility_receipts, transaction_sensitive_details):
--
--  1. READ: an observation is visible only if the caller may see the account's
--     source in that workspace. For personal and organization workspaces
--     can_view_source_in_space() collapses to plain membership, so nothing
--     changes there.
--  2. WRITE: record_manual_balance_observation() refuses an account the caller
--     cannot see, with the same error as a missing account. Without this a
--     member could append observations to a co-member's private wallet by
--     guessing its id, and tell "exists" from "does not exist".
--
-- No data is changed; existing rows simply stop being readable by members who
-- may not see their source. Service-role code (erasure, export) is unaffected.
-- Rollback: recreate the old policy
--   (using (public.is_workspace_member(workspace_id))) and the previous function
-- body from 20261224000000; no data to undo.

drop policy if exists balance_observations_select_member on public.balance_observations;
drop policy if exists balance_observations_select_visible on public.balance_observations;

create policy balance_observations_select_visible on public.balance_observations
  for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and exists (
      select 1
      from public.accounts a
      where a.id = balance_observations.account_id
        and a.workspace_id = balance_observations.workspace_id
        and public.can_view_source_in_space(a.financial_source_id, a.workspace_id)
    )
  );

create or replace function public.record_manual_balance_observation(
  p_account_id uuid,
  p_amount_minor bigint,
  p_as_of timestamptz,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_currency char(3);
  v_source uuid;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select workspace_id, currency, financial_source_id
    into v_ws, v_currency, v_source
  from public.accounts where id = p_account_id;

  -- Same error for "no such account", "not yours" and "cannot see this
  -- source": no existence oracle.
  if v_ws is null
     or not public.is_workspace_member(v_ws, 'member')
     or not public.can_view_source_in_space(v_source, v_ws) then
    raise exception 'account_not_found' using errcode = 'P0002';
  end if;

  if p_amount_minor is null or p_as_of is null then
    raise exception 'invalid_observation' using errcode = '22023';
  end if;
  if p_as_of > now() + interval '5 minutes' then
    raise exception 'as_of_in_future' using errcode = '22023';
  end if;

  insert into public.balance_observations
    (workspace_id, account_id, amount_minor, currency, as_of, note, created_by)
  values
    (v_ws, p_account_id, p_amount_minor, v_currency, p_as_of,
     nullif(trim(p_note), ''), auth.uid())
  returning id into v_id;

  perform public.record_space_audit_event(
    v_ws, 'balance.manual_observation', 'account', p_account_id,
    null,
    jsonb_build_object('observation_id', v_id, 'amount_minor', p_amount_minor,
                       'currency', v_currency, 'as_of', p_as_of)
  );
  return v_id;
end;
$$;

comment on function public.record_manual_balance_observation is
  'Member+ records a user-stated balance for an account they may see (source visibility applies in household Spaces). Append-only, audited (space_audit_events). Never overwrites provider-reported balances.';

revoke all on function public.record_manual_balance_observation(uuid, bigint, timestamptz, text) from public;
grant execute on function public.record_manual_balance_observation(uuid, bigint, timestamptz, text) to authenticated, service_role;
