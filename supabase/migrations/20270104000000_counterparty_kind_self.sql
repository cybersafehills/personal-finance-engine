-- A counterparty can now be marked as the user's OWN account ('self').
--
-- Money moving between your own accounts (a bank top-up into MoMo, a transfer to
-- your own savings) is neither income nor spending. Confirmed transfer links
-- already exclude those legs, but only when both sides are matched. Marking a
-- name as "me" lets every summary surface skip transactions with that
-- counterparty, so the forecast and totals stop counting your own money as income.
--
-- No new table, grant or function: this only widens the kind CHECK and re-issues
-- update_counterparty (same signature, same grants) to accept it.

-- The original CHECK was declared inline (unnamed), so find it by what it checks.
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.counterparties'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%''merchant''%'
  loop
    execute format('alter table public.counterparties drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.counterparties
  add constraint counterparties_kind_check
  check (kind in ('person', 'merchant', 'unknown', 'self'));

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
     or p_kind not in ('person', 'merchant', 'unknown', 'self') then
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
