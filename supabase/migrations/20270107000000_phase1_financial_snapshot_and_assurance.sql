-- Generated with `supabase migration new`, then ordered after the existing
-- forward-dated chain. Additive read contract; old feeds/signatures stay intact.
create or replace function public.require_sensitive_assurance()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if exists (select 1 from auth.mfa_factors where user_id = auth.uid() and status = 'verified')
     and coalesce(auth.jwt()->>'aal', 'aal1') <> 'aal2' then
    raise exception 'mfa_required' using errcode = '42501';
  end if;
end; $$;
revoke all on function public.require_sensitive_assurance() from public, anon;
grant execute on function public.require_sensitive_assurance() to authenticated;

-- One authorization-respecting classification for web and native snapshots.
create view public.financial_activity_v with (security_invoker = true) as
select t.*, (
  exists(select 1 from public.transfer_links l where l.workspace_id = t.workspace_id
    and l.status = 'linked' and (l.out_transaction_id = t.id or l.in_transaction_id = t.id))
  or exists(with recursive ancestry as (
    select c.id, c.kind, c.merged_into_id, array[c.id] as path
      from public.counterparties c where c.id = t.counterparty_id
    union all
    select c.id, c.kind, c.merged_into_id, a.path || c.id
      from public.counterparties c join ancestry a on c.id = a.merged_into_id
      where not c.id = any(a.path)
  ) select 1 from ancestry where kind = 'self' and merged_into_id is null)
) as is_own_transfer
from public.transactions t;
grant select on public.financial_activity_v to authenticated;

-- A full keyset snapshot repairs late commits, hard deletions and RLS visibility
-- loss. No service role / SECURITY DEFINER: every page re-evaluates caller RLS.
-- JSON envelope is deliberate: PostgREST max_rows cannot silently cap its rows.
create or replace function public.sync_financial_snapshot_page(p_after_id uuid default null, p_limit integer default 200)
returns jsonb language sql stable security invoker set search_path = public as $$
with page as (
  select id, account_id, workspace_id, source, transaction_type, direction,
    status, currency::text, amount_rwf, fee_rwf, principal_effect_rwf, fee_effect_rwf,
    settlement_state, balance_after_rwf, counterparty_name, counterparty_reference,
    occurred_at, category, subcategory, category_decision_status, suggested_category,
    dedupe_state, notes, updated_at, is_own_transfer
  from public.financial_activity_v
  where p_after_id is null or id > p_after_id
  order by id limit least(greatest(coalesce(p_limit,200),1),500)
), spaces as (
  select w.id, w.kind from public.workspaces w
  join public.workspace_memberships m on m.workspace_id = w.id
  where m.user_id = auth.uid() and m.status = 'active'
)
select jsonb_build_object('server_time', now(),
 'rows', coalesce((select jsonb_agg(to_jsonb(p) order by id) from page p),'[]'::jsonb),
 'workspaces', coalesce((select jsonb_agg(to_jsonb(s)) from spaces s),'[]'::jsonb));
$$;
revoke all on function public.sync_financial_snapshot_page(uuid, integer) from public, anon;
grant execute on function public.sync_financial_snapshot_page(uuid, integer) to authenticated;

-- Atomic default selection; membership + source visibility, not a UI guard.
create or replace function public.set_default_wallet(p_workspace_id uuid, p_account_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_sensitive_assurance();
  perform 1 from public.accounts a where a.id = p_account_id and a.workspace_id = p_workspace_id
    and a.archived_at is null and public.is_workspace_member(p_workspace_id,'owner')
    and public.can_view_source_in_space(a.financial_source_id, a.workspace_id);
  if not found then raise exception 'account_not_found' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0));
  update public.accounts set is_primary = false where workspace_id = p_workspace_id and is_primary;
  update public.accounts set is_primary = true where id = p_account_id;
end; $$;
revoke all on function public.set_default_wallet(uuid, uuid) from public, anon;
grant execute on function public.set_default_wallet(uuid, uuid) to authenticated;

-- Preserve signature/grants; tighten the actual execution boundary.
create or replace function public._payment_request_for_update(p_id uuid, p_require_unexpired boolean)
returns public.payment_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.payment_requests%rowtype;
begin
  perform public.require_sensitive_assurance();
  select * into r from public.payment_requests where id = p_id for update;
  if not found
     or not (public.is_workspace_member(r.workspace_id, 'member')
             and (r.created_by = auth.uid() or public.is_workspace_member(r.workspace_id, 'owner'))) then
    raise exception 'payment_request_not_found' using errcode = 'P0002';
  end if;
  if r.status <> 'open' then
    raise exception 'invalid_state_transition' using errcode = '22023';
  end if;
  if p_require_unexpired and r.expires_at <= now() then
    raise exception 'payment_request_expired' using errcode = '22023';
  end if;
  return r;
end;
$$;

-- Preserve signature/grants; tighten the actual execution boundary.
create or replace function public.create_payment_request(
  p_workspace_id uuid,
  p_amount_minor bigint,
  p_currency text,
  p_destination_type text,
  p_destination_value text,
  p_recipient_display text,
  p_reference text,
  p_expires_at timestamptz,
  p_token_hash text,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dest text;
  v_id uuid;
  v_display text := trim(p_recipient_display);
  v_ref text := nullif(trim(p_reference), '');
begin
  perform public.require_sensitive_assurance();
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_workspace_member(p_workspace_id, 'member') then
    raise exception 'workspace_not_found' using errcode = 'P0002';
  end if;

  -- Idempotent retry (same workspace + key) returns the original request.
  if p_idempotency_key is not null then
    select id into v_id from public.payment_requests
    where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key;
    if found then return v_id; end if;
  end if;

  if p_amount_minor is null or p_amount_minor <= 0 or p_amount_minor > 1000000000000
     or p_currency not in ('RWF', 'USD', 'EUR')
     or v_display is null or length(v_display) not between 1 and 80 or v_display ~ '[[:cntrl:]]'
     or (v_ref is not null and (length(v_ref) > 64 or v_ref ~ '[[:cntrl:]]'))
     or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_payment_request' using errcode = '22023';
  end if;
  if p_expires_at is null or p_expires_at <= now() + interval '1 minute'
     or p_expires_at > now() + interval '90 days' then
    raise exception 'invalid_expiry' using errcode = '22023';
  end if;

  if p_destination_type = 'momo_phone' then
    v_dest := public.normalize_msisdn(p_destination_value);
  elsif p_destination_type = 'merchant_code' and p_destination_value ~ '^[0-9]{4,8}$' then
    v_dest := p_destination_value;
  end if;
  if v_dest is null then
    raise exception 'invalid_destination' using errcode = '22023';
  end if;

  if (select count(*) from public.payment_requests
        where created_by = auth.uid() and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  if (select count(*) from public.payment_requests
        where workspace_id = p_workspace_id and status = 'open' and expires_at > now()) >= 200 then
    raise exception 'too_many_open_requests' using errcode = '54000';
  end if;

  insert into public.payment_requests
    (workspace_id, created_by, amount_minor, currency, destination_type, destination_value,
     recipient_display, reference, expires_at, token_hash, idempotency_key)
  values
    (p_workspace_id, auth.uid(), p_amount_minor, p_currency, p_destination_type, v_dest,
     v_display, v_ref, p_expires_at, p_token_hash, p_idempotency_key)
  returning id into v_id;

  insert into public.payment_request_events (workspace_id, payment_request_id, event_type, actor_user_id, metadata)
  values (p_workspace_id, v_id, 'created', auth.uid(),
          jsonb_build_object('amount_minor', p_amount_minor, 'currency', p_currency, 'expires_at', p_expires_at));
  perform public.record_space_audit_event(p_workspace_id, 'payment_request.created', 'payment_request', v_id, null,
          jsonb_build_object('amount_minor', p_amount_minor, 'currency', p_currency));
  return v_id;
end;
$$;

-- Preserve signature/grants; tighten the actual execution boundary.
create or replace function public.link_payment_request_transaction(p_id uuid, p_transaction_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.payment_requests%rowtype;
  t public.transactions%rowtype;
begin
  perform public.require_sensitive_assurance();
  r := public._payment_request_for_update(p_id, false);
  select * into t from public.transactions where id = p_transaction_id and workspace_id = r.workspace_id
    and public.can_view_source_in_space(financial_source_id, workspace_id);
  if not found then
    raise exception 'transaction_not_found' using errcode = 'P0002';
  end if;
  if t.direction <> 'in' or t.settlement_state is distinct from 'settled' or t.dedupe_state = 'merged'
     or t.currency <> r.currency or t.principal_effect_rwf is distinct from r.amount_minor then
    raise exception 'transaction_does_not_match' using errcode = '22023';
  end if;
  if exists (select 1 from public.payment_requests where matched_transaction_id = p_transaction_id) then
    raise exception 'transaction_already_linked' using errcode = '23505';
  end if;
  update public.payment_requests set status = 'matched', matched_transaction_id = p_transaction_id where id = p_id;
  insert into public.payment_request_events (workspace_id, payment_request_id, event_type, actor_user_id, metadata)
  values (r.workspace_id, p_id, 'matched', auth.uid(), jsonb_build_object('transaction_id', p_transaction_id));
  perform public.record_space_audit_event(r.workspace_id, 'payment_request.matched', 'payment_request', p_id, null,
          jsonb_build_object('transaction_id', p_transaction_id));
end; $$;

create or replace function public.sync_visible_transaction_ids(p_ids uuid[])
returns jsonb language sql stable security invoker set search_path = public as $$
 select coalesce(jsonb_agg(id),'[]'::jsonb) from public.transactions
 where id = any(p_ids) and cardinality(p_ids) <= 500;
$$;
revoke all on function public.sync_visible_transaction_ids(uuid[]) from public, anon;
grant execute on function public.sync_visible_transaction_ids(uuid[]) to authenticated;

-- Supported manual wallet creation is atomic with its source; it never enables
-- capture or fabricates a provider connection/balance. Household source sharing
-- remains an explicit, separate owner-controlled workflow.
create or replace function public.create_supported_wallet(p_workspace_id uuid, p_name text, p_provider text, p_currency text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_source uuid; v_account uuid;
begin
  perform public.require_sensitive_assurance();
  if not public.is_workspace_member(p_workspace_id,'owner')
    or not exists(select 1 from public.workspaces where id = p_workspace_id and kind in ('personal','organization')) then
    raise exception 'workspace_not_found' using errcode = 'P0002';
  end if;
  if length(trim(p_name)) not between 1 and 120 or p_name is null
    or p_provider is null or p_provider not in ('bank','cash','mtn_momo','airtel_money','other')
    or p_currency is null or p_currency not in ('RWF','USD','EUR') then
    raise exception 'invalid_wallet' using errcode = '22023';
  end if;
  insert into public.financial_sources(owner_user_id,provider,source_type,display_name,currency,created_by)
    values(auth.uid(),p_provider,case when p_provider='bank' then 'bank_account' when p_provider in ('cash','other') then 'cash' else 'mobile_money' end,trim(p_name),p_currency,auth.uid()) returning id into v_source;
  insert into public.accounts(workspace_id,name,provider,currency,financial_source_id)
    values(p_workspace_id,trim(p_name),case when p_provider='cash' then 'other' else p_provider end,p_currency,v_source) returning id into v_account;
  perform public.record_space_audit_event(p_workspace_id,'account.created','account',v_account);
  return v_account;
end; $$;
revoke all on function public.create_supported_wallet(uuid,text,text,text) from public, anon;
grant execute on function public.create_supported_wallet(uuid,text,text,text) to authenticated;
