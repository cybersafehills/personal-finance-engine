-- OneLedger 3.0 E4: split a counterparty (the counterpart to merge, S4).
-- Two ways to separate what was grouped together, both explicit, audited and
-- reversible:
--   * by IDENTIFIER: move an identifier (a phone number / merchant code / name
--     label) - and the transactions that carry it - to a new counterparty;
--   * by TRANSACTION: move chosen transactions to a new counterparty. This is
--     the only way to separate two people who share one name label (the
--     weak-identity case: "same display name is not sufficient evidence").
-- Raw labels on transactions are never touched. After a split, new
-- transactions carrying a moved identifier resolve to the NEW counterparty on
-- the next backfill_counterparties run.

create table public.counterparty_split_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  source_id uuid not null,
  new_id uuid not null,
  moved_identifier_ids uuid[] not null default '{}',
  moved_transaction_ids uuid[] not null default '{}',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid references auth.users (id) on delete set null,
  constraint counterparty_split_events_source_fk
    foreign key (workspace_id, source_id) references public.counterparties (workspace_id, id) on delete cascade,
  constraint counterparty_split_events_new_fk
    foreign key (workspace_id, new_id) references public.counterparties (workspace_id, id) on delete cascade
);
create index idx_counterparty_split_events_ws on public.counterparty_split_events (workspace_id, created_at desc);
alter table public.counterparty_split_events enable row level security;
create policy counterparty_split_events_select_member on public.counterparty_split_events
  for select to authenticated using (public.is_workspace_member(workspace_id));
revoke all on public.counterparty_split_events from anon, authenticated;
grant select on public.counterparty_split_events to authenticated;
grant select, insert, update, delete on public.counterparty_split_events to service_role;

-- The identity key a transaction resolves to, as 'type:value' - the SAME rules
-- backfill_counterparties uses (msisdn > merchant code > exact label). Internal.
create or replace function public._counterparty_txn_key(
  p_transaction_type text, p_name text, p_reference text
)
returns text
language sql
immutable
as $$
  select coalesce(
    'msisdn:' || public.normalize_msisdn(p_reference),
    case when p_transaction_type = 'merchant_payment' and p_reference ~ '^[0-9]{4,8}$'
         then 'merchant_code:' || p_reference end,
    case when lower(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g')) <> ''
         then 'name_label:' || lower(regexp_replace(trim(p_name), '\s+', ' ', 'g')) end
  );
$$;
revoke all on function public._counterparty_txn_key(text, text, text) from public;

create or replace function public.split_counterparty(
  p_counterparty_id uuid,
  p_identifier_ids uuid[] default '{}',
  p_transaction_ids uuid[] default '{}',
  p_new_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.counterparties%rowtype;
  v_ident uuid[] := coalesce(p_identifier_ids, '{}');
  v_txn uuid[] := coalesce(p_transaction_ids, '{}');
  v_moved_txn uuid[];
  v_new uuid := gen_random_uuid();
  v_name text := nullif(trim(p_new_name), '');
  v_kind text := 'unknown';
  v_conf text := 'low';
  v_event uuid;
  v_remaining_ident int;
  v_remaining_txn int;
begin
  select * into c from public.counterparties where id = p_counterparty_id;
  if not found or not public.is_workspace_member(c.workspace_id, 'member') then
    raise exception 'counterparty_not_found' using errcode = 'P0002';
  end if;
  if c.merged_into_id is not null then
    raise exception 'counterparty_merged' using errcode = '22023';
  end if;
  if (cardinality(v_ident) + cardinality(v_txn)) = 0
     or cardinality(v_ident) > 50 or cardinality(v_txn) > 5000
     or (v_name is not null and length(v_name) > 120) then
    raise exception 'invalid_split' using errcode = '22023';
  end if;

  -- every identifier must belong to THIS counterparty
  if (select count(*) from public.counterparty_identifiers
        where id = any(v_ident) and counterparty_id = c.id and workspace_id = c.workspace_id)
     <> (select count(distinct x) from unnest(v_ident) x) then
    raise exception 'invalid_split' using errcode = '22023';
  end if;
  -- every chosen transaction must currently belong to THIS counterparty
  if (select count(*) from public.transactions
        where id = any(v_txn) and counterparty_id = c.id and workspace_id = c.workspace_id)
     <> (select count(distinct x) from unnest(v_txn) x) then
    raise exception 'invalid_split' using errcode = '22023';
  end if;

  -- the transactions that move: the chosen ones + those carrying a moved identifier
  select coalesce(array_agg(distinct t.id), '{}') into v_moved_txn
  from public.transactions t
  where t.workspace_id = c.workspace_id and t.counterparty_id = c.id
    and (t.id = any(v_txn)
         or public._counterparty_txn_key(t.transaction_type, t.counterparty_name, t.counterparty_reference) in (
              select i.identifier_type || ':' || i.normalized_value
              from public.counterparty_identifiers i where i.id = any(v_ident)));

  -- the source must keep something (otherwise: rename it, don't split it)
  select count(*) into v_remaining_ident from public.counterparty_identifiers
    where counterparty_id = c.id and not (id = any(v_ident));
  select count(*) into v_remaining_txn from public.transactions
    where counterparty_id = c.id and workspace_id = c.workspace_id and not (id = any(v_moved_txn));
  if v_remaining_ident = 0 and v_remaining_txn = 0 then
    raise exception 'split_would_empty' using errcode = '22023';
  end if;

  -- kind/confidence of the new counterparty follow the strongest moved identifier
  select case
           when bool_or(identifier_type = 'msisdn') then 'person'
           when bool_or(identifier_type = 'merchant_code') then 'merchant'
           else 'unknown' end,
         case when bool_or(identifier_type in ('msisdn', 'merchant_code')) then 'high' else 'low' end
    into v_kind, v_conf
  from public.counterparty_identifiers where id = any(v_ident);
  v_kind := coalesce(v_kind, 'unknown');
  v_conf := coalesce(v_conf, 'low');
  if v_name is not null then v_conf := 'user_confirmed'; end if;

  if v_name is null then
    select t.counterparty_name into v_name
    from public.transactions t
    where t.id = any(v_moved_txn) and nullif(trim(t.counterparty_name), '') is not null
    order by t.occurred_at desc limit 1;
  end if;
  if v_name is null then
    select i.normalized_value into v_name from public.counterparty_identifiers i
    where i.id = any(v_ident) order by i.created_at limit 1;
  end if;
  v_name := left(coalesce(v_name, c.display_name), 120);

  insert into public.counterparties (id, workspace_id, display_name, kind, confidence, created_by)
  values (v_new, c.workspace_id, v_name, v_kind, v_conf, auth.uid());
  update public.counterparty_identifiers set counterparty_id = v_new where id = any(v_ident);
  update public.transactions set counterparty_id = v_new where id = any(v_moved_txn);

  insert into public.counterparty_split_events
    (workspace_id, source_id, new_id, moved_identifier_ids, moved_transaction_ids, created_by)
  values (c.workspace_id, c.id, v_new, v_ident, v_moved_txn, auth.uid())
  returning id into v_event;

  perform public.record_space_audit_event(
    c.workspace_id, 'counterparty.split', 'counterparty', c.id, null,
    jsonb_build_object('event_id', v_event, 'new_counterparty_id', v_new,
                       'identifiers', cardinality(v_ident), 'transactions', cardinality(v_moved_txn)));
  return v_event;
end;
$$;
revoke all on function public.split_counterparty(uuid, uuid[], uuid[], text) from public;
grant execute on function public.split_counterparty(uuid, uuid[], uuid[], text) to authenticated, service_role;

-- Undo: everything currently on the split-off counterparty (including items
-- that joined it AFTER the split, e.g. new transactions resolved by a moved
-- identifier) returns to the source, and the emptied split-off row is retired.
-- Refused if the split-off counterparty has since been merged into/away or has
-- merged children (undo that first).
create or replace function public.undo_counterparty_split(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.counterparty_split_events%rowtype;
  n public.counterparties%rowtype;
begin
  select * into e from public.counterparty_split_events where id = p_event_id for update;
  if not found or not public.is_workspace_member(e.workspace_id, 'member') then
    raise exception 'split_event_not_found' using errcode = 'P0002';
  end if;
  if e.undone_at is not null then
    raise exception 'already_undone' using errcode = '22023';
  end if;

  select * into n from public.counterparties where id = e.new_id for update;
  if not found
     or n.merged_into_id is not null
     or exists (select 1 from public.counterparties where merged_into_id = e.new_id) then
    raise exception 'split_state_changed' using errcode = '22023';
  end if;

  update public.counterparty_identifiers set counterparty_id = e.source_id where counterparty_id = e.new_id;
  update public.transactions set counterparty_id = e.source_id
    where counterparty_id = e.new_id and workspace_id = e.workspace_id;
  -- The emptied split-off row is RETIRED (soft-merged into the source) rather
  -- than deleted: deleting it would cascade away this event and its history.
  update public.counterparties set merged_into_id = e.source_id where id = e.new_id;
  update public.counterparty_split_events set undone_at = now(), undone_by = auth.uid() where id = p_event_id;
  perform public.record_space_audit_event(
    e.workspace_id, 'counterparty.split_undone', 'counterparty', e.source_id, null,
    jsonb_build_object('event_id', p_event_id, 'removed_counterparty_id', e.new_id));
end;
$$;
revoke all on function public.undo_counterparty_split(uuid) from public;
grant execute on function public.undo_counterparty_split(uuid) to authenticated, service_role;
