-- OneLedger 3.0 S4: workspace-scoped counterparty identity layer
-- (docs/oneledger-3/architecture.md I8, migration.md). ADDITIVE: new tables, one
-- nullable column on transactions. Raw labels stay on
-- transactions.counterparty_name/_reference untouched and authoritative.
--
-- Identity rules (deliberately conservative - "same display name is not
-- sufficient evidence of identity"):
--   msisdn         strong: a normalised Rwandan mobile number (2507XXXXXXXX)
--   merchant_code  strong: numeric merchant code on a merchant_payment
--   name_label     WEAK: exact normalised label; only used when no strong key
--                  exists, and the counterparty is flagged confidence 'low'
-- A transaction that carries a strong identifier NEVER joins a name-only
-- counterparty. Nothing here ever matches across workspaces.
--
-- Merge is a reversible SOFT link (merged_into_id), not a data move: rows,
-- identifiers and transaction links are preserved, so undo is exact.

-- ---------------------------------------------------------------------------
-- Pure helpers (internal; not granted to callers)
-- ---------------------------------------------------------------------------
create or replace function public.normalize_msisdn(p_raw text)
returns text
language sql
immutable
as $$
  select case
    when p_raw is null or position('*' in p_raw) > 0 then null
    else (
      with d as (select regexp_replace(p_raw, '[^0-9]', '', 'g') as v)
      select case
        when v ~ '^2507[0-9]{8}$' then v
        when v ~ '^002507[0-9]{8}$' then substr(v, 3)
        when v ~ '^07[0-9]{8}$' then '250' || substr(v, 2)
        when v ~ '^7[0-9]{8}$' then '250' || v
        else null
      end from d
    )
  end;
$$;

comment on function public.normalize_msisdn is
  'Normalises a Rwandan mobile number to 2507XXXXXXXX or NULL (masked values containing * are never identifiers). Mirrored by web/lib/counterparties/normalize.ts; both are tested against web/lib/counterparties/msisdn-vectors.json.';
revoke all on function public.normalize_msisdn(text) from public;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.counterparties (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  kind text not null default 'unknown' check (kind in ('person', 'merchant', 'unknown')),
  confidence text not null check (confidence in ('user_confirmed', 'high', 'low')),
  -- Soft merge pointer. Always points DIRECTLY at the surviving counterparty
  -- (the RPC flattens chains), so resolving the effective id is one hop.
  merged_into_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint counterparties_workspace_id_id_unique unique (workspace_id, id),
  constraint counterparties_not_self_merged check (merged_into_id is null or merged_into_id <> id),
  constraint counterparties_merge_same_workspace
    foreign key (workspace_id, merged_into_id)
    references public.counterparties (workspace_id, id)
);
create index idx_counterparties_workspace on public.counterparties (workspace_id);
create index idx_counterparties_merged_into on public.counterparties (merged_into_id)
  where merged_into_id is not null;
create trigger set_counterparties_updated_at
  before update on public.counterparties
  for each row execute function public.set_updated_at();

create table public.counterparty_identifiers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  counterparty_id uuid not null,
  identifier_type text not null check (identifier_type in ('msisdn', 'merchant_code', 'name_label')),
  -- msisdn: 2507XXXXXXXX; merchant_code: digits; name_label: lower(trim(collapse ws)).
  normalized_value text not null check (length(normalized_value) between 1 and 200),
  created_at timestamptz not null default now(),
  constraint counterparty_identifiers_unique unique (workspace_id, identifier_type, normalized_value),
  constraint counterparty_identifiers_same_workspace
    foreign key (workspace_id, counterparty_id)
    references public.counterparties (workspace_id, id) on delete cascade
);
create index idx_counterparty_identifiers_cp on public.counterparty_identifiers (counterparty_id);

create table public.counterparty_merge_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  survivor_id uuid not null,
  merged_ids uuid[] not null check (cardinality(merged_ids) between 1 and 50),
  -- child counterparty id -> its merged_into_id BEFORE this merge (null for
  -- ones merged directly; the intermediate parent for flattened children).
  previous_links jsonb not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid references auth.users (id) on delete set null,
  constraint counterparty_merge_events_survivor_same_workspace
    foreign key (workspace_id, survivor_id)
    references public.counterparties (workspace_id, id) on delete cascade
);
create index idx_counterparty_merge_events_ws on public.counterparty_merge_events (workspace_id, created_at desc);

alter table public.transactions
  add column counterparty_id uuid;
alter table public.transactions
  add constraint transactions_counterparty_same_workspace
    foreign key (workspace_id, counterparty_id)
    references public.counterparties (workspace_id, id) on delete set null (counterparty_id);
create index idx_transactions_counterparty_id
  on public.transactions (workspace_id, counterparty_id)
  where counterparty_id is not null;

comment on column public.transactions.counterparty_id is
  'Resolved counterparty (workspace-scoped), NULL until resolved. Original counterparty_name/_reference remain the raw evidence. Written only by backfill_counterparties().';

alter table public.counterparties enable row level security;
alter table public.counterparty_identifiers enable row level security;
alter table public.counterparty_merge_events enable row level security;

create policy counterparties_select_member on public.counterparties
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy counterparty_identifiers_select_member on public.counterparty_identifiers
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy counterparty_merge_events_select_member on public.counterparty_merge_events
  for select to authenticated using (public.is_workspace_member(workspace_id));

revoke all on public.counterparties, public.counterparty_identifiers, public.counterparty_merge_events
  from anon, authenticated;
grant select on public.counterparties, public.counterparty_identifiers, public.counterparty_merge_events
  to authenticated;
grant select, insert, update, delete on public.counterparties, public.counterparty_identifiers,
  public.counterparty_merge_events to service_role;

comment on table public.counterparties is
  'Workspace-scoped people/merchants. Written only through backfill_counterparties / update_counterparty / merge_counterparties RPCs. merged_into_id is a reversible soft merge.';

-- ---------------------------------------------------------------------------
-- backfill_counterparties(workspace): idempotent, incremental. Resolves every
-- unresolved, non-merged transaction in the workspace. Safe to re-run.
-- ---------------------------------------------------------------------------
create or replace function public.backfill_counterparties(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created int := 0;
  v_linked int := 0;
  v_seeded int := 0;
  v_n int;
begin
  if auth.uid() is not null and not public.is_workspace_member(p_workspace_id, 'member') then
    raise exception 'workspace_not_found' using errcode = 'P0002';
  end if;

  -- One backfill per workspace at a time (identifier unique keys + advisory lock).
  perform pg_advisory_xact_lock(hashtextextended('backfill_counterparties:' || p_workspace_id::text, 0));

  create temp table _cp_keys on commit drop as
  with src as (
    select
      t.id as txn_id,
      t.occurred_at,
      t.transaction_type,
      nullif(trim(t.counterparty_name), '') as raw_name,
      public.normalize_msisdn(t.counterparty_reference) as msisdn,
      case when t.transaction_type = 'merchant_payment'
                and t.counterparty_reference ~ '^[0-9]{4,8}$'
           then t.counterparty_reference end as merchant_code,
      lower(regexp_replace(trim(coalesce(t.counterparty_name, '')), '\s+', ' ', 'g')) as label
    from public.transactions t
    where t.workspace_id = p_workspace_id
      and t.counterparty_id is null
      and t.dedupe_state <> 'merged'
  ), keyed as (
    select s.*,
      case when s.msisdn is not null then 'msisdn'
           when s.merchant_code is not null then 'merchant_code'
           when s.label <> '' then 'name_label' end as key_type,
      coalesce(s.msisdn, s.merchant_code, nullif(s.label, '')) as key_value
    from src s
  )
  select * from keyed where key_type is not null;

  -- One row per distinct key: latest raw name becomes the display name.
  create temp table _cp_new on commit drop as
  select distinct on (k.key_type, k.key_value)
    k.key_type, k.key_value,
    coalesce(k.raw_name, k.key_value) as display_name,
    case k.key_type
      when 'msisdn' then 'person'
      when 'merchant_code' then 'merchant'
      else 'unknown' end as kind,
    case k.key_type when 'name_label' then 'low' else 'high' end as confidence,
    gen_random_uuid() as new_id
  from _cp_keys k
  where not exists (
    select 1 from public.counterparty_identifiers i
    where i.workspace_id = p_workspace_id
      and i.identifier_type = k.key_type and i.normalized_value = k.key_value)
  order by k.key_type, k.key_value, k.occurred_at desc;

  insert into public.counterparties (id, workspace_id, display_name, kind, confidence, created_by)
  select new_id, p_workspace_id, left(display_name, 120), kind, confidence, auth.uid()
  from _cp_new;
  get diagnostics v_created = row_count;

  insert into public.counterparty_identifiers (workspace_id, counterparty_id, identifier_type, normalized_value)
  select p_workspace_id, new_id, key_type, key_value from _cp_new;

  update public.transactions t
  set counterparty_id = i.counterparty_id
  from _cp_keys k
  join public.counterparty_identifiers i
    on i.workspace_id = p_workspace_id
   and i.identifier_type = k.key_type and i.normalized_value = k.key_value
  where t.id = k.txn_id and t.counterparty_id is null;
  get diagnostics v_linked = row_count;

  -- Names/kinds the user already supplied for saved payees (Assisted Pay).
  -- Never overrides a counterparty the user has already confirmed here.
  update public.counterparties c
  set display_name = left(r.display_name, 120),
      kind = case r.kind when 'phone' then 'person'
                         when 'merchant' then 'merchant'
                         when 'biller' then 'merchant'
                         else c.kind end,
      confidence = case when r.trust_status = 'trusted_by_user' then 'user_confirmed' else c.confidence end
  from public.trusted_recipients r
  join public.counterparty_identifiers i
    on i.workspace_id = r.workspace_id
   and ((i.identifier_type = 'msisdn' and i.normalized_value = r.normalized_msisdn)
     or (i.identifier_type = 'merchant_code' and i.normalized_value = r.merchant_code))
  where r.workspace_id = p_workspace_id
    and c.id = i.counterparty_id
    and c.confidence <> 'user_confirmed'
    and (c.display_name, c.kind, c.confidence) is distinct from
        (left(r.display_name, 120),
         case r.kind when 'phone' then 'person' when 'merchant' then 'merchant'
                     when 'biller' then 'merchant' else c.kind end,
         case when r.trust_status = 'trusted_by_user' then 'user_confirmed' else c.confidence end);
  get diagnostics v_seeded = row_count;

  return jsonb_build_object('created', v_created, 'linked', v_linked, 'seeded_from_saved_payees', v_seeded);
end;
$$;

revoke all on function public.backfill_counterparties(uuid) from public;
grant execute on function public.backfill_counterparties(uuid) to authenticated, service_role;
comment on function public.backfill_counterparties is
  'Idempotent, workspace-scoped resolution of unresolved transactions to counterparties. Strong identifiers (msisdn, merchant code) only; weak name labels get confidence low. Member+ or service role.';

-- ---------------------------------------------------------------------------
-- update_counterparty: correct the name and/or kind. User-confirmed from then on.
-- ---------------------------------------------------------------------------
create or replace function public.update_counterparty(
  p_id uuid, p_display_name text, p_kind text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.counterparties%rowtype;
begin
  select * into c from public.counterparties where id = p_id;
  if not found or not public.is_workspace_member(c.workspace_id, 'member') then
    raise exception 'counterparty_not_found' using errcode = 'P0002';
  end if;
  if c.merged_into_id is not null then
    raise exception 'counterparty_merged' using errcode = '22023';
  end if;
  if p_display_name is null or length(trim(p_display_name)) not between 1 and 120
     or p_kind not in ('person', 'merchant', 'unknown') then
    raise exception 'invalid_counterparty' using errcode = '22023';
  end if;

  update public.counterparties
  set display_name = trim(p_display_name), kind = p_kind, confidence = 'user_confirmed'
  where id = p_id;

  perform public.record_space_audit_event(
    c.workspace_id, 'counterparty.updated', 'counterparty', p_id,
    jsonb_build_object('display_name', c.display_name, 'kind', c.kind, 'confidence', c.confidence),
    jsonb_build_object('display_name', trim(p_display_name), 'kind', p_kind, 'confidence', 'user_confirmed'));
end;
$$;
revoke all on function public.update_counterparty(uuid, text, text) from public;
grant execute on function public.update_counterparty(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- merge_counterparties / undo_counterparty_merge: explicit, audited, reversible.
-- ---------------------------------------------------------------------------
create or replace function public.merge_counterparties(p_survivor uuid, p_merged uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_event uuid;
  v_prev jsonb;
  v_ids uuid[];
begin
  select workspace_id into v_ws from public.counterparties where id = p_survivor;
  if v_ws is null or not public.is_workspace_member(v_ws, 'member') then
    raise exception 'counterparty_not_found' using errcode = 'P0002';
  end if;

  select array_agg(distinct x) into v_ids from unnest(p_merged) x;
  if v_ids is null or cardinality(v_ids) not between 1 and 50 or p_survivor = any(v_ids) then
    raise exception 'invalid_merge' using errcode = '22023';
  end if;
  -- every id must exist in THIS workspace and be un-merged; so must the survivor
  if (select count(*) from public.counterparties
        where id = any(v_ids) and workspace_id = v_ws and merged_into_id is null) <> cardinality(v_ids)
     or exists (select 1 from public.counterparties where id = p_survivor and merged_into_id is not null) then
    raise exception 'invalid_merge' using errcode = '22023';
  end if;

  -- Remember every link we are about to change (merged ids + flattened children).
  select coalesce(jsonb_object_agg(id::text, to_jsonb(merged_into_id)), '{}'::jsonb) into v_prev
  from public.counterparties
  where workspace_id = v_ws and (id = any(v_ids) or merged_into_id = any(v_ids));

  update public.counterparties set merged_into_id = p_survivor
  where workspace_id = v_ws and (id = any(v_ids) or merged_into_id = any(v_ids));

  insert into public.counterparty_merge_events (workspace_id, survivor_id, merged_ids, previous_links, created_by)
  values (v_ws, p_survivor, v_ids, v_prev, auth.uid())
  returning id into v_event;

  perform public.record_space_audit_event(
    v_ws, 'counterparty.merged', 'counterparty', p_survivor, null,
    jsonb_build_object('event_id', v_event, 'merged_ids', v_ids));
  return v_event;
end;
$$;
revoke all on function public.merge_counterparties(uuid, uuid[]) from public;
grant execute on function public.merge_counterparties(uuid, uuid[]) to authenticated, service_role;

create or replace function public.undo_counterparty_merge(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.counterparty_merge_events%rowtype;
  k text;
  v jsonb;
begin
  select * into e from public.counterparty_merge_events where id = p_event_id for update;
  if not found or not public.is_workspace_member(e.workspace_id, 'member') then
    raise exception 'merge_event_not_found' using errcode = 'P0002';
  end if;
  if e.undone_at is not null then
    raise exception 'already_undone' using errcode = '22023';
  end if;

  -- Refuse if anything changed since (a later merge must be undone first).
  for k in select jsonb_object_keys(e.previous_links) loop
    if not exists (select 1 from public.counterparties
                   where id = k::uuid and merged_into_id = e.survivor_id) then
      raise exception 'merge_state_changed' using errcode = '22023';
    end if;
  end loop;

  for k, v in select * from jsonb_each(e.previous_links) loop
    update public.counterparties
    set merged_into_id = case when jsonb_typeof(v) = 'null' then null else (v #>> '{}')::uuid end
    where id = k::uuid;
  end loop;

  update public.counterparty_merge_events set undone_at = now(), undone_by = auth.uid() where id = p_event_id;
  perform public.record_space_audit_event(
    e.workspace_id, 'counterparty.merge_undone', 'counterparty', e.survivor_id, null,
    jsonb_build_object('event_id', p_event_id));
end;
$$;
revoke all on function public.undo_counterparty_merge(uuid) from public;
grant execute on function public.undo_counterparty_merge(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- counterparty_summaries_v: per EFFECTIVE counterparty and currency. Same
-- rules as the Insights core: settled, non-merged-duplicate, confirmed
-- self-transfers excluded, refunds reduce "sent" and are not "received".
-- security_invoker: the caller's RLS applies.
-- ---------------------------------------------------------------------------
create view public.counterparty_summaries_v
with (security_invoker = true) as
select
  eff.workspace_id,
  eff.id as counterparty_id,
  eff.display_name,
  eff.kind,
  eff.confidence,
  t.currency,
  coalesce(sum(case
    when t.direction = 'out' then abs(t.principal_effect_rwf + t.fee_effect_rwf)
    when t.direction = 'in' and t.transaction_type in ('refund', 'reversal') then -(t.principal_effect_rwf + t.fee_effect_rwf)
    when t.direction = 'in' then abs(t.fee_effect_rwf)
    else 0 end), 0)::bigint as sent_minor,
  coalesce(sum(case
    when t.direction = 'in' and t.transaction_type not in ('refund', 'reversal') then t.principal_effect_rwf
    else 0 end), 0)::bigint as received_minor,
  count(*)::bigint as txn_count,
  min(t.occurred_at) as first_at,
  max(t.occurred_at) as last_at
from public.transactions t
join public.counterparties c on c.id = t.counterparty_id
join public.counterparties eff on eff.id = coalesce(c.merged_into_id, c.id)
where t.settlement_state = 'settled'
  and t.dedupe_state <> 'merged'
  and not exists (
    select 1 from public.transfer_links l
    where l.status = 'linked' and (l.out_transaction_id = t.id or l.in_transaction_id = t.id))
group by eff.workspace_id, eff.id, eff.display_name, eff.kind, eff.confidence, t.currency;

comment on view public.counterparty_summaries_v is
  'Money sent/received/count/first/last per effective (post-merge) counterparty and currency. net = received_minor - sent_minor (computed by the caller). security_invoker.';
grant select on public.counterparty_summaries_v to authenticated, service_role;
