-- Reconcile two counterparty migrations that were written in parallel.
--
-- 20270104000001_counterparty_kind_self (#283; originally 20270104000000) widened counterparties.kind to
-- allow 'self' ("my own account") and re-issued update_counterparty to accept it.
-- 20270105000000_counterparty_source_visibility (#282) re-issued the same function
-- to add the household source-visibility guard, but from the OLDER body, so on a
-- fresh chain it silently took 'self' back out: the CHECK allowed 'self' while the
-- function refused it.
--
-- Two files carried the version 20270104000000 (this one's predecessor and
-- 20270104000000_balance_observations_source_visibility). That broke fresh
-- databases outright (`supabase start` aborts on the duplicate schema_migrations
-- key, which turned the e2e job red for every PR) and, in production, `supabase db
-- push` applied balance_observations and never ran kind_self. kind_self has been
-- renamed to the unique version 20270104000001. That rename is safe only because
-- production had applied nothing newer than 20270104000000 and the visibility
-- migration (20270105000000) had not run yet; it is therefore pending in
-- production and applies in order (04000001, then 05, then this one).
-- Even so, kind_self's function body is overwritten by 20270105000000, so this
-- migration, with its own unique version, restores the intended end state:
--   * the kind CHECK allows 'self' (idempotent: identical to kind_self's), and
--   * update_counterparty has BOTH the 'self' kind and the source-visibility guard.
-- Safe to run on a database where kind_self already ran, and on one where it did
-- not. Same signature and grants (create or replace keeps them); no data change.
-- Rollback: re-issue update_counterparty from 20270105000000 and recreate the
-- three-value CHECK (only if no counterparty has kind 'self').

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
  if not found or not public.is_workspace_member(c.workspace_id, 'member')
     or not public.can_view_counterparty(p_id) then
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
