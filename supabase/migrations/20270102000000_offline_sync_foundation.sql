-- Offline-first sync foundation (additive; no existing object is changed).
--
-- 1. client_operations: the idempotency ledger. Every mutation a device
--    uploads carries a client-generated op_id. The first delivery applies it
--    and stores its outcome here, in the SAME database transaction as the
--    financial write; any redelivery (retry, lost response, replay after a
--    crash) returns the stored outcome and changes nothing. This is what
--    turns at-least-once delivery into an effectively-once business outcome.
--
-- 2. sync_create_manual_transaction: the idempotent, offline-capable twin of
--    create_manual_transaction (20261222000000, left untouched for the web
--    and older app builds). Differences: the transaction id is chosen by the
--    device (stable identity across retries), the call is keyed by op_id, and
--    the result says whether it was applied or replayed. Authorization and
--    every business rule are identical and re-checked server-side.
--
-- 3. sync_transactions_changes: an incremental read feed (keyset on
--    updated_at, id) so a device downloads only what changed. SECURITY
--    INVOKER: Row Level Security decides which rows a caller may see, exactly
--    as for direct table reads. Merged duplicates are returned (flagged) so
--    the device can drop them; they are evidence, never live transactions.

create table public.client_operations (
  op_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  op_type text not null check (op_type in ('create_manual_transaction')),
  entity_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create index idx_client_operations_user on public.client_operations (user_id, created_at desc);

-- Written only by the SECURITY DEFINER functions below; never directly.
alter table public.client_operations enable row level security;
revoke all on public.client_operations from public, anon, authenticated;
grant select, insert, update, delete on public.client_operations to service_role;

create or replace function public.sync_create_manual_transaction(
  p_op_id uuid,
  p_id uuid,
  p_account_id uuid,
  p_transaction_type text,
  p_direction text,
  p_amount_minor bigint,
  p_fee_minor bigint,
  p_occurred_at timestamptz,
  p_counterparty_name text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_existing public.client_operations;
  v_account public.accounts;
  v_amount bigint := p_amount_minor;
  v_fee bigint := case when p_direction = 'out' then coalesce(p_fee_minor, 0) else 0 end;
  v_counterparty text := nullif(btrim(coalesce(p_counterparty_name, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_result jsonb;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;
  if p_op_id is null or p_id is null then
    raise exception 'invalid_operation';
  end if;

  -- Serialise concurrent deliveries of the same operation (a retry racing the
  -- original request) so exactly one of them applies it.
  perform pg_advisory_xact_lock(hashtextextended(p_op_id::text, 0));

  select * into v_existing from public.client_operations where op_id = p_op_id;
  if found then
    if v_existing.user_id <> v_user or v_existing.entity_id <> p_id then
      -- The same op_id presented for a different user/entity is a client bug
      -- or an attack; never answer with someone else's stored outcome.
      raise exception 'op_id_conflict';
    end if;
    return jsonb_set(v_existing.result, '{status}', '"replayed"');
  end if;

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
  if v_amount is null or v_amount <= 0 or v_amount > 1000000000000 then
    raise exception 'invalid_amount';
  end if;
  if v_fee < 0 or v_fee > 1000000000000 then
    raise exception 'invalid_fee';
  end if;
  if p_occurred_at is null or p_occurred_at > now() + interval '5 minutes' then
    raise exception 'invalid_time';
  end if;
  if char_length(coalesce(v_counterparty, '')) > 120 or char_length(coalesce(v_notes, '')) > 500 then
    raise exception 'invalid_text';
  end if;

  -- A device-chosen id that already belongs to a row from some other
  -- operation must never be adopted or overwritten.
  if exists (select 1 from public.transactions where id = p_id) then
    raise exception 'entity_exists';
  end if;

  insert into public.transactions (
    id, momo_message_id, account_id, workspace_id, source, transaction_type,
    direction, status, currency, amount_rwf, fee_rwf,
    principal_effect_rwf, fee_effect_rwf, settlement_state, affects_balance,
    effect_reason, counterparty_name, occurred_at, notes, parser_version
  ) values (
    p_id, null, v_account.id, v_account.workspace_id, 'manual', p_transaction_type,
    p_direction, 'success', v_account.currency, v_amount, v_fee,
    case when p_direction = 'out' then -v_amount else v_amount end,
    case when p_direction = 'out' then -v_fee else 0 end,
    'settled', true,
    'manual_entry', v_counterparty, p_occurred_at, v_notes, 'manual-entry-v1'
  );

  v_result := jsonb_build_object(
    'status', 'applied',
    'id', p_id,
    'server_updated_at', (select updated_at from public.transactions where id = p_id)
  );

  insert into public.client_operations (op_id, user_id, op_type, entity_id, result)
  values (p_op_id, v_user, 'create_manual_transaction', p_id, v_result);

  return v_result;
end;
$$;

comment on function public.sync_create_manual_transaction is
  'Idempotent manual transaction create for offline devices. Keyed by op_id (replay returns the stored outcome, status "replayed"), the transaction id is chosen by the device. Same authorization and validation as create_manual_transaction. Raises not_authenticated, invalid_operation, op_id_conflict, not_found_or_forbidden, invalid_*, entity_exists.';

revoke all on function public.sync_create_manual_transaction(uuid, uuid, uuid, text, text, bigint, bigint, timestamptz, text, text) from public, anon;
grant execute on function public.sync_create_manual_transaction(uuid, uuid, uuid, text, text, bigint, bigint, timestamptz, text, text) to authenticated;

create or replace function public.sync_transactions_changes(
  p_after_updated_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 200
)
returns table (
  id uuid,
  account_id uuid,
  workspace_id uuid,
  source text,
  transaction_type text,
  direction text,
  status text,
  currency text,
  amount_rwf bigint,
  fee_rwf bigint,
  principal_effect_rwf bigint,
  fee_effect_rwf bigint,
  settlement_state text,
  balance_after_rwf bigint,
  counterparty_name text,
  counterparty_reference text,
  occurred_at timestamptz,
  category text,
  subcategory text,
  category_decision_status text,
  suggested_category text,
  dedupe_state text,
  notes text,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select t.id, t.account_id, t.workspace_id, t.source, t.transaction_type,
         t.direction, t.status, t.currency::text, t.amount_rwf, t.fee_rwf,
         t.principal_effect_rwf, t.fee_effect_rwf, t.settlement_state,
         t.balance_after_rwf, t.counterparty_name, t.counterparty_reference,
         t.occurred_at, t.category, t.subcategory, t.category_decision_status,
         t.suggested_category, t.dedupe_state, t.notes, t.updated_at
  from public.transactions t
  where p_after_updated_at is null
     or (t.updated_at, t.id) > (p_after_updated_at, coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid))
  order by t.updated_at asc, t.id asc
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;

comment on function public.sync_transactions_changes is
  'Incremental transaction feed for offline devices: rows with (updated_at, id) after the cursor, oldest first, at most 500. SECURITY INVOKER, so RLS scopes it. Includes merged duplicates (dedupe_state = merged) so devices can drop them.';

revoke all on function public.sync_transactions_changes(timestamptz, uuid, integer) from public, anon;
grant execute on function public.sync_transactions_changes(timestamptz, uuid, integer) to authenticated;

-- Keyset index for the feed.
create index if not exists idx_transactions_updated_at_id on public.transactions (updated_at, id);
