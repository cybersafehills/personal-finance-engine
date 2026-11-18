-- Counterparties honour per-Space SOURCE visibility.
--
-- counterparties, counterparty_identifiers, counterparty_merge_events and
-- counterparty_split_events (20261225000000, 20261228000000) were readable by
-- every member of a workspace. They are workspace-wide, but their CONTENT is
-- derived from transactions: a counterparty's name and its identifiers (a
-- normalised phone number or merchant code) come from the transactions that
-- resolved to it. In a household Space a member must not see data for a
-- co-member's financial source unless the owner shared it in (ADR 0005), so a
-- name or phone number that appears ONLY on a co-member's unshared source must
-- not be readable by the other members. (The amounts were already safe:
-- counterparty_summaries_v is security_invoker over transactions.)
--
-- Rule (can_view_counterparty): a member may see a counterparty if
--   * the Space is not a household (personal / organization): always; or
--   * the Space is a household and the caller can see at least one
--     transaction that resolved to it - or to a counterparty merged into it,
--     so a merge never hides or exposes the survivor differently from its
--     parts. "Can see a transaction" is exactly can_view_source_in_space on
--     the transaction's source, the same primitive transactions and accounts
--     use.
-- A transaction the caller can see therefore always has a counterparty the
-- caller can see (and its survivor, if merged), so no screen loses a name for
-- data it is showing. A counterparty with no visible transaction is invisible
-- to household members.
--
-- Write paths (update / merge / undo merge / split / undo split) are SECURITY
-- DEFINER and bypass RLS, so each now refuses a counterparty the caller cannot
-- see with the SAME error as a missing one. Without that a member could rename
-- or merge a hidden counterparty by guessing its id - and merging a visible one
-- INTO a hidden one would make the hidden one (and its name) visible.
--
-- Not changed: backfill_counterparties still resolves every unresolved
-- transaction in the workspace (it must, for the data to be complete); it only
-- returns counts. A display name is the latest raw label across all sources
-- that resolve to one identifier, so a person reachable through both a shared
-- and a private source shows the same person's label; that is one identity, not
-- a second leak.
-- No data is changed. Service-role paths (erasure, export, the processors) are
-- unaffected.
-- Rollback: recreate the old four policies (using is_workspace_member(workspace_id))
-- and the previous function bodies from 20261225000000 / 20261228000000.

create or replace function public.can_view_counterparty(p_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_kind text;
begin
  select c.workspace_id into v_ws from public.counterparties c where c.id = p_id;
  if v_ws is null or not public.is_workspace_member(v_ws) then
    return false;
  end if;

  select w.kind into v_kind from public.workspaces w where w.id = v_ws;
  if coalesce(v_kind, '') <> 'household' then
    return true;
  end if;

  return exists (
    select 1
    from public.transactions t
    where t.workspace_id = v_ws
      and (t.counterparty_id = p_id
           or t.counterparty_id in (
                select ch.id from public.counterparties ch
                where ch.workspace_id = v_ws and ch.merged_into_id = p_id))
      and public.can_view_source_in_space(t.financial_source_id, v_ws)
  );
end;
$$;

comment on function public.can_view_counterparty is
  'Authorization primitive: may the current auth.uid() see counterparty p_id. Members of non-household Spaces always; in a household, only if they can see a transaction that resolved to it (or to a counterparty merged into it).';
revoke all on function public.can_view_counterparty(uuid) from public;
grant execute on function public.can_view_counterparty(uuid) to authenticated, service_role;

drop policy if exists counterparties_select_member on public.counterparties;
drop policy if exists counterparties_select_visible on public.counterparties;
create policy counterparties_select_visible on public.counterparties
  for select to authenticated
  using (public.can_view_counterparty(id));

drop policy if exists counterparty_identifiers_select_member on public.counterparty_identifiers;
drop policy if exists counterparty_identifiers_select_visible on public.counterparty_identifiers;
create policy counterparty_identifiers_select_visible on public.counterparty_identifiers
  for select to authenticated
  using (public.can_view_counterparty(counterparty_id));

drop policy if exists counterparty_merge_events_select_member on public.counterparty_merge_events;
drop policy if exists counterparty_merge_events_select_visible on public.counterparty_merge_events;
create policy counterparty_merge_events_select_visible on public.counterparty_merge_events
  for select to authenticated
  using (
    public.can_view_counterparty(survivor_id)
    and not exists (
      select 1 from unnest(merged_ids) m where not public.can_view_counterparty(m))
  );

drop policy if exists counterparty_split_events_select_member on public.counterparty_split_events;
drop policy if exists counterparty_split_events_select_visible on public.counterparty_split_events;
create policy counterparty_split_events_select_visible on public.counterparty_split_events
  for select to authenticated
  using (
    public.can_view_counterparty(source_id)
    and public.can_view_counterparty(new_id)
  );

-- ---------------------------------------------------------------------------
-- Write paths: same bodies as before, plus "the caller may see it".
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
  if not found or not public.is_workspace_member(c.workspace_id, 'member')
     or not public.can_view_counterparty(p_id) then
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
  if v_ws is null or not public.is_workspace_member(v_ws, 'member')
     or not public.can_view_counterparty(p_survivor) then
    raise exception 'counterparty_not_found' using errcode = 'P0002';
  end if;

  select array_agg(distinct x) into v_ids from unnest(p_merged) x;
  if v_ids is null or cardinality(v_ids) not between 1 and 50 or p_survivor = any(v_ids) then
    raise exception 'invalid_merge' using errcode = '22023';
  end if;
  -- every id must exist in THIS workspace, be un-merged and be one the caller may
  -- see (a hidden id is reported exactly like a missing one); so must the survivor
  if (select count(*) from public.counterparties
        where id = any(v_ids) and workspace_id = v_ws and merged_into_id is null
          and public.can_view_counterparty(id)) <> cardinality(v_ids)
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
  if not found or not public.is_workspace_member(e.workspace_id, 'member')
     or not public.can_view_counterparty(e.survivor_id)
     or exists (select 1 from unnest(e.merged_ids) m where not public.can_view_counterparty(m)) then
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
  if not found or not public.is_workspace_member(c.workspace_id, 'member')
     or not public.can_view_counterparty(p_counterparty_id) then
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
  if not found or not public.is_workspace_member(e.workspace_id, 'member')
     or not public.can_view_counterparty(e.source_id)
     or not public.can_view_counterparty(e.new_id) then
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
