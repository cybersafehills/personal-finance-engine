-- Phase S (PR2b): space_member_directory - the one read the attribution
-- UI needs that plain RLS can't give it.
--
-- profiles is RLS-scoped to `id = auth.uid()` (profiles_select_own, Phase
-- B), so a normal authenticated query can only ever see the caller's own
-- display name. To attribute a household transaction to "Alice" the UI
-- needs the names of the caller's co-members. This is the dedicated
-- SECURITY DEFINER directory function Phase B's getWorkspaceMembers
-- comment anticipated - built now that it is actually needed, not
-- speculatively.
--
-- Bounded disclosure: it returns display names only for active members of
-- a Space the CALLER is themselves an active member of (the
-- is_workspace_member() guard in the WHERE clause). Nothing else about a
-- profile is exposed, and non-members get zero rows.

create or replace function public.space_member_directory(p_workspace_id uuid)
returns table (user_id uuid, display_name text, role text)
language sql
security definer
set search_path = public
stable
as $$
  select m.user_id, p.display_name, m.role
  from public.workspace_memberships m
  left join public.profiles p on p.id = m.user_id
  where m.workspace_id = p_workspace_id
    and m.status = 'active'
    and public.is_workspace_member(p_workspace_id)
  order by m.role, m.joined_at nulls last;
$$;

comment on function public.space_member_directory is
  'Active members of p_workspace_id with their display names - readable only by an active member of that Space (is_workspace_member guard). The one place another member''s display name is exposed; used by the transaction-attribution UI. SECURITY DEFINER + STABLE.';

revoke all on function public.space_member_directory(uuid) from public;
grant execute on function public.space_member_directory(uuid) to authenticated;
