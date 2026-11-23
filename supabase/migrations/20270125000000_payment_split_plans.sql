-- Payment splits (OneLedger Pay, "Splits").
--
-- A split plan groups the parts of ONE payment that is sent as several transfers.
-- Each part is an ordinary payment_intent, so the existing lifecycle, hand-off,
-- SMS reconciliation and expiry all apply to it unchanged. The plan only records
-- what was proposed and keeps the parts in order.
--
-- Two kinds (see web/lib/pay/splits/split-math.ts):
--   capacity    - the amount EXCEEDS a network's published per-transaction capacity
--                 (eKash: RWF 10,000,000), so it cannot go as one transfer. The
--                 database re-checks the amount really is over the capacity.
--   fee_saving  - the parts cost less in fees than one transfer, per a VERIFIED
--                 provider tariff. Opt-in per user (pay_split_preferences).
--
-- Non-custodial (ADR 0001): nothing here moves money. A part is only a draft the
-- user hands off themselves, one at a time: part N+1 can be attached only after
-- part N is `successful` (verified or manually confirmed). That order is also what
-- keeps SMS reconciliation unambiguous (it matches on amount + recipient + time).

-- ---------------------------------------------------------------------------
-- Preferences
-- ---------------------------------------------------------------------------
create table public.pay_split_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Fee-saving suggestions are OFF until the user turns them on. Capacity splits
  -- (an amount that cannot fit in one transfer) do not depend on this.
  fee_saving_enabled boolean not null default false,
  threshold text not null default 'balanced' check (threshold in ('any', 'balanced', 'bigger')),
  updated_at timestamptz not null default now()
);

comment on table public.pay_split_preferences is
  'Per-user Splits settings. fee_saving_enabled defaults to false; threshold is how much each extra part must save (any=0, balanced=50, bigger=250 RWF).';

create trigger set_pay_split_preferences_updated_at
  before update on public.pay_split_preferences
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------
create table public.payment_split_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  idempotency_key text not null,
  kind text not null check (kind in ('capacity', 'fee_saving')),
  -- payment_networks.slug for a capacity plan (e.g. 'ekash'); null for fee_saving.
  network_slug text,
  payment_type text not null check (payment_type in (
    'pay_person', 'pay_merchant', 'pay_bill', 'buy_electricity', 'buy_airtime', 'government'
  )),
  currency char(3) not null default 'RWF' check (currency = upper(currency)),
  total_amount_minor bigint not null check (total_amount_minor > 0),
  -- Ordered amounts as JSON strings (bigint-safe), part 1 first.
  planned_parts jsonb not null check (
    jsonb_typeof(planned_parts) = 'array'
    and jsonb_array_length(planned_parts) between 2 and 12
  ),
  single_fee_minor bigint check (single_fee_minor is null or single_fee_minor >= 0),
  planned_fee_minor bigint check (planned_fee_minor is null or planned_fee_minor >= 0),
  -- Where any fee figure came from. 'published_maximum' is a ceiling, not a prediction.
  fee_basis text not null default 'none' check (fee_basis in ('none', 'published_maximum', 'verified_tariff')),
  threshold text check (threshold is null or threshold in ('any', 'balanced', 'bigger')),
  stopped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_split_plans_idempotency unique (workspace_id, idempotency_key),
  constraint payment_split_plans_kind_shape check (
    (kind = 'capacity' and network_slug is not null and threshold is null)
    or (kind = 'fee_saving' and network_slug is null and fee_basis = 'verified_tariff')
  )
);

comment on table public.payment_split_plans is
  'A payment sent as several transfers. Each part is a payment_intent (split_plan_id, split_index). Written only through create_payment_split_plan / stop_payment_split_plan.';

create trigger set_payment_split_plans_updated_at
  before update on public.payment_split_plans
  for each row execute function public.set_updated_at();

alter table public.payment_intents
  add column split_plan_id uuid references public.payment_split_plans (id) on delete set null,
  add column split_index smallint check (split_index is null or split_index >= 1);

alter table public.payment_intents
  add constraint payment_intents_split_pair check (
    (split_plan_id is null and split_index is null)
    or (split_plan_id is not null and split_index is not null)
  );

create unique index payment_intents_split_part_unique
  on public.payment_intents (split_plan_id, split_index)
  where split_plan_id is not null;

-- ---------------------------------------------------------------------------
-- RPCs (SECURITY DEFINER; membership-checked like create_payment_intent)
-- ---------------------------------------------------------------------------

-- Create a plan. Returns { id, existed }.
-- payload: workspace_id, idempotency_key, kind, network_slug, payment_type, currency,
--          total_amount_minor, planned_parts (array of integers or digit strings),
--          single_fee_minor, planned_fee_minor, fee_basis, threshold
create function public.create_payment_split_plan(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid := (payload->>'workspace_id')::uuid;
  v_key text := coalesce(nullif(payload->>'idempotency_key', ''), gen_random_uuid()::text);
  v_kind text := payload->>'kind';
  v_slug text := nullif(payload->>'network_slug', '');
  v_total bigint := (payload->>'total_amount_minor')::bigint;
  v_parts jsonb := payload->'planned_parts';
  v_part_sum bigint := 0;
  v_part bigint;
  v_max_part bigint := 0;
  v_cap bigint;
  v_id uuid;
  v_existed boolean := false;
  v_elem jsonb;
begin
  if not public.is_workspace_member(v_ws, 'member') then
    raise exception 'not_authorized: not a member of this workspace' using errcode = 'insufficient_privilege';
  end if;
  if v_total is null or v_total <= 0 then
    raise exception 'invalid_amount' using errcode = 'check_violation';
  end if;
  if v_parts is null or jsonb_typeof(v_parts) <> 'array' or jsonb_array_length(v_parts) not between 2 and 12 then
    raise exception 'invalid_parts' using errcode = 'check_violation';
  end if;

  for v_elem in select * from jsonb_array_elements(v_parts) loop
    v_part := (v_elem #>> '{}')::bigint;
    if v_part is null or v_part <= 0 then
      raise exception 'invalid_parts' using errcode = 'check_violation';
    end if;
    v_part_sum := v_part_sum + v_part;
    if v_part > v_max_part then v_max_part := v_part; end if;
  end loop;
  if v_part_sum <> v_total then
    raise exception 'parts_do_not_sum' using errcode = 'check_violation';
  end if;

  if v_kind = 'capacity' then
    -- Only an amount that EXCEEDS the network's published per-transaction capacity
    -- may be split this way, and every part must fit within it.
    select l.max_txn_minor into v_cap
    from public.route_limits l
    join public.payment_networks n on n.id = l.payment_network_id
    where n.slug = v_slug and l.scope = 'network' and l.max_txn_minor is not null
    order by l.max_txn_minor desc
    limit 1;
    if v_cap is null then
      raise exception 'capacity_unknown' using errcode = 'check_violation';
    end if;
    if v_total <= v_cap then
      raise exception 'not_over_capacity' using errcode = 'check_violation';
    end if;
    if v_max_part > v_cap then
      raise exception 'part_over_capacity' using errcode = 'check_violation';
    end if;
  elsif v_kind = 'fee_saving' then
    if coalesce(payload->>'fee_basis', '') <> 'verified_tariff' then
      raise exception 'fee_saving_needs_verified_tariff' using errcode = 'check_violation';
    end if;
  else
    raise exception 'invalid_kind' using errcode = 'check_violation';
  end if;

  insert into public.payment_split_plans (
    workspace_id, created_by, idempotency_key, kind, network_slug, payment_type,
    currency, total_amount_minor, planned_parts, single_fee_minor, planned_fee_minor,
    fee_basis, threshold
  ) values (
    v_ws, auth.uid(), v_key, v_kind, v_slug, payload->>'payment_type',
    coalesce(nullif(payload->>'currency', ''), 'RWF'), v_total, v_parts,
    nullif(payload->>'single_fee_minor', '')::bigint,
    nullif(payload->>'planned_fee_minor', '')::bigint,
    coalesce(nullif(payload->>'fee_basis', ''), 'none'),
    nullif(payload->>'threshold', '')
  )
  on conflict (workspace_id, idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.payment_split_plans
    where workspace_id = v_ws and idempotency_key = v_key;
    v_existed := true;
  end if;

  return jsonb_build_object('id', v_id, 'existed', v_existed);
end;
$$;

revoke all on function public.create_payment_split_plan(jsonb) from public;
grant execute on function public.create_payment_split_plan(jsonb) to authenticated;

-- Attach an existing draft intent to a plan as part `p_index`.
-- Enforces: same workspace, plan not stopped, amount equals the planned part,
-- and part N-1 is already `successful` (the user dials them one by one).
create function public.attach_intent_to_split_plan(p_plan uuid, p_intent uuid, p_index int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.payment_split_plans%rowtype;
  v_intent public.payment_intents%rowtype;
  v_planned bigint;
  v_prev_state text;
begin
  select * into v_plan from public.payment_split_plans where id = p_plan for update;
  if v_plan.id is null then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;
  if not public.is_workspace_member(v_plan.workspace_id, 'member') then
    raise exception 'not_authorized' using errcode = 'insufficient_privilege';
  end if;
  if v_plan.stopped_at is not null then
    raise exception 'plan_stopped' using errcode = 'check_violation';
  end if;
  if p_index < 1 or p_index > jsonb_array_length(v_plan.planned_parts) then
    raise exception 'invalid_part_index' using errcode = 'check_violation';
  end if;

  select * into v_intent from public.payment_intents where id = p_intent for update;
  if v_intent.id is null or v_intent.workspace_id <> v_plan.workspace_id then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;
  if v_intent.state <> 'draft' or v_intent.split_plan_id is not null then
    raise exception 'intent_not_attachable' using errcode = 'check_violation';
  end if;

  v_planned := (v_plan.planned_parts -> (p_index - 1)) #>> '{}';
  if v_intent.amount_minor <> v_planned then
    raise exception 'amount_mismatch' using errcode = 'check_violation';
  end if;

  if p_index > 1 then
    select state into v_prev_state from public.payment_intents
    where split_plan_id = p_plan and split_index = p_index - 1;
    if v_prev_state is distinct from 'successful' then
      raise exception 'previous_part_not_settled' using errcode = 'check_violation';
    end if;
  end if;

  update public.payment_intents
  set split_plan_id = p_plan, split_index = p_index
  where id = p_intent;

  insert into public.payment_events (payment_intent_id, workspace_id, event_type, actor_type, actor_user_id, evidence)
  values (p_intent, v_plan.workspace_id, 'state_change', 'user', auth.uid(),
          jsonb_build_object('split_plan_id', p_plan, 'split_index', p_index));
end;
$$;

revoke all on function public.attach_intent_to_split_plan(uuid, uuid, int) from public;
grant execute on function public.attach_intent_to_split_plan(uuid, uuid, int) to authenticated;

-- Stop a plan: no further parts can be attached, and any part still a draft is
-- cancelled. Parts already handed off are left to their own lifecycle.
create function public.stop_payment_split_plan(p_plan uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.payment_split_plans%rowtype;
  v_id uuid;
  v_cancelled int := 0;
begin
  select * into v_plan from public.payment_split_plans where id = p_plan for update;
  if v_plan.id is null then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;
  if not public.is_workspace_member(v_plan.workspace_id, 'member') then
    raise exception 'not_authorized' using errcode = 'insufficient_privilege';
  end if;

  update public.payment_split_plans
  set stopped_at = coalesce(stopped_at, now())
  where id = p_plan;

  for v_id in
    select id from public.payment_intents
    where split_plan_id = p_plan and state = 'draft'
  loop
    perform public.transition_payment_intent(v_id, 'cancelled', 'split_stopped', '{}'::jsonb);
    v_cancelled := v_cancelled + 1;
  end loop;

  return jsonb_build_object('id', p_plan, 'cancelled_drafts', v_cancelled);
end;
$$;

revoke all on function public.stop_payment_split_plan(uuid) from public;
grant execute on function public.stop_payment_split_plan(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS / grants
-- ---------------------------------------------------------------------------
alter table public.payment_split_plans enable row level security;
alter table public.pay_split_preferences enable row level security;

create policy payment_split_plans_select on public.payment_split_plans
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy pay_split_preferences_rw on public.pay_split_preferences
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.payment_split_plans from anon;
revoke all on public.pay_split_preferences from anon;

grant select on public.payment_split_plans to authenticated;
grant select, insert, update on public.pay_split_preferences to authenticated;
grant all on public.payment_split_plans to service_role;
grant all on public.pay_split_preferences to service_role;
