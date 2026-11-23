-- Wallet lifecycle uses existing account RLS and preserves ledger history.
create function public.manage_wallet(
  p_workspace_id uuid,
  p_account_id uuid,
  p_action text,
  p_name text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.require_sensitive_assurance();
  if p_action is null or p_action not in ('rename', 'archive', 'restore') then
    raise exception 'invalid_wallet_action' using errcode = '22023';
  end if;
  if p_action = 'rename' and (p_name is null or length(trim(p_name)) not between 1 and 120) then
    raise exception 'invalid_wallet_name' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_id::text, 0));
  update public.accounts a set
    name = case when p_action = 'rename' then trim(p_name) else a.name end,
    is_primary = case when p_action in ('archive', 'restore') then false else a.is_primary end,
    is_active = case when p_action = 'archive' then false when p_action = 'restore' then true else a.is_active end,
    archived_at = case when p_action = 'archive' then coalesce(a.archived_at, now())
                       when p_action = 'restore' then null else a.archived_at end
  where a.id = p_account_id and a.workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id, 'member')
    and (p_action = 'rename' or p_action = 'archive' or a.archived_at is not null)
    and public.can_view_source_in_space(a.financial_source_id, a.workspace_id);
  if not found then
    raise exception 'wallet_not_found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.manage_wallet(uuid, uuid, text, text) from public, anon;
grant execute on function public.manage_wallet(uuid, uuid, text, text) to authenticated;

-- Validate inside the same lock used by archive/restore.
create or replace function public.set_default_wallet(p_workspace_id uuid, p_account_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_sensitive_assurance();
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_id::text, 0));
  perform 1 from public.accounts a where a.id = p_account_id and a.workspace_id = p_workspace_id
    and a.archived_at is null and public.is_workspace_member(p_workspace_id,'owner')
    and public.can_view_source_in_space(a.financial_source_id, a.workspace_id)
    for update;
  if not found then raise exception 'account_not_found' using errcode = 'P0002'; end if;
  update public.accounts set is_primary = false where workspace_id = p_workspace_id and is_primary;
  update public.accounts set is_primary = true where id = p_account_id;
end;
$$;
