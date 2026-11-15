-- Manual transactions: the one write path for a signed-in user.
--
-- Phase B made `transactions` writable only by ingestion (service_role); the
-- only authenticated write is the owner's category correction. Phase E
-- (20260825000000) then relaxed `momo_message_id` for source='manual' rows
-- "for the web manual-entry action", but never gave `authenticated` an INSERT
-- grant or policy, so that action's insert (made with the user's session) is
-- denied by Postgres. Rather than open INSERT on a financial table to every
-- column (a user could then set dedupe/decision/provenance fields), this adds
-- a single audited entry point that fixes what a manual row may look like.
--
-- Authorization is the same as the category correction: an active owner of the
-- account's workspace. (Household members cannot add by hand yet; widen with a
-- capability check when Spaces needs it.) Workspace and currency come from the
-- account, never from the caller. Mirrors the rules the web action and the
-- mobile app validate first: always settled and successful, direction in/out,
-- fee only on money out, principal/fee effects exactly as the accounting
-- check constraints expect.

create or replace function public.create_manual_transaction(
  p_account_id uuid,
  p_transaction_type text,
  p_direction text,
  p_amount_minor bigint,
  p_fee_minor bigint,
  p_occurred_at timestamptz,
  p_counterparty_name text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.accounts;
  v_amount bigint := p_amount_minor;
  -- Fees on incoming money are not modelled (matches ingestion).
  v_fee bigint := case when p_direction = 'out' then coalesce(p_fee_minor, 0) else 0 end;
  v_counterparty text := nullif(btrim(coalesce(p_counterparty_name, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_id uuid;
begin
  select * into v_account
  from public.accounts
  where id = p_account_id and is_active and archived_at is null;

  if not found
     or v_account.workspace_id is null
     or not public.is_workspace_member(v_account.workspace_id, 'owner') then
    raise exception 'not_found_or_forbidden';
  end if;

  if p_transaction_type is null or p_transaction_type not in (
    'send_money', 'merchant_payment', 'money_received', 'airtime',
    'cash_withdrawal', 'cash_deposit', 'bill_payment', 'bank_transfer', 'other'
  ) then
    raise exception 'invalid_transaction_type';
  end if;
  if p_direction is null or p_direction not in ('in', 'out') then
    raise exception 'invalid_direction';
  end if;
  -- Far above any real amount; keeps every figure an exact integer client-side.
  if v_amount is null or v_amount <= 0 or v_amount > 1000000000000 then
    raise exception 'invalid_amount';
  end if;
  if v_fee < 0 or v_fee > 1000000000000 then
    raise exception 'invalid_fee';
  end if;
  -- Small allowance for clock skew; a manual entry records something that
  -- already happened.
  if p_occurred_at is null or p_occurred_at > now() + interval '5 minutes' then
    raise exception 'invalid_time';
  end if;
  if char_length(coalesce(v_counterparty, '')) > 120 or char_length(coalesce(v_notes, '')) > 500 then
    raise exception 'invalid_text';
  end if;

  insert into public.transactions (
    momo_message_id, account_id, workspace_id, source, transaction_type,
    direction, status, currency, amount_rwf, fee_rwf,
    principal_effect_rwf, fee_effect_rwf, settlement_state, affects_balance,
    effect_reason, counterparty_name, occurred_at, notes, parser_version
  ) values (
    null, v_account.id, v_account.workspace_id, 'manual', p_transaction_type,
    p_direction, 'success', v_account.currency, v_amount, v_fee,
    case when p_direction = 'out' then -v_amount else v_amount end,
    case when p_direction = 'out' then -v_fee else 0 end,
    'settled', true,
    'manual_entry', v_counterparty, p_occurred_at, v_notes, 'manual-entry-v1'
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.create_manual_transaction is
  'The only way a signed-in user creates a transaction: a settled, successful manual entry on an account in a workspace they own. Workspace and currency come from the account. Raises not_found_or_forbidden, invalid_transaction_type, invalid_direction, invalid_amount, invalid_fee, invalid_time or invalid_text.';

revoke all on function public.create_manual_transaction(uuid, text, text, bigint, bigint, timestamptz, text, text) from public;
grant execute on function public.create_manual_transaction(uuid, text, text, bigint, bigint, timestamptz, text, text) to authenticated;
