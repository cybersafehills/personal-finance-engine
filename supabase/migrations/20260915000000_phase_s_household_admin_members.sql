-- Phase S (PR2d): let an Admin manage members.
--
-- The Phase R capability matrix (space_role_has_capability) already grants
-- 'members.manage' to Admin, but the actual mutation surface -
-- workspace_invites' RLS and set_member_role / remove_member - was still
-- guarded by is_workspace_member(_, 'owner') from Phase C. This migration
-- swaps those guards to has_space_capability(_, 'members.manage'), so an
-- Admin (household or organization) can invite, revoke invites, and change
-- or remove members - EXCEPT anything touching an Owner, which stays
-- Owner-only. The last-owner guard is unchanged.
--
-- CREATE OR REPLACE / DROP+CREATE POLICY only - no new object, no grant
-- change, so the migration-test privilege counters are unaffected.

-- ===========================================================================
-- workspace_invites: members.manage instead of owner. The invite `role`
-- CHECK already forbids issuing an Owner invite (admin|member|viewer only),
-- so an Admin can invite at most another Admin - matching "invite/manage
-- most members" in the role model.
-- ===========================================================================

drop policy workspace_invites_select_owner on public.workspace_invites;
create policy workspace_invites_select_manager on public.workspace_invites
  for select to authenticated
  using (public.has_space_capability(workspace_id, 'members.manage'));

drop policy workspace_invites_insert_owner on public.workspace_invites;
create policy workspace_invites_insert_manager on public.workspace_invites
  for insert to authenticated
  with check (
    public.has_space_capability(workspace_id, 'members.manage')
    and invited_by = auth.uid()
  );

drop policy workspace_invites_update_owner on public.workspace_invites;
create policy workspace_invites_update_manager on public.workspace_invites
  for update to authenticated
  using (public.has_space_capability(workspace_id, 'members.manage'))
  with check (public.has_space_capability(workspace_id, 'members.manage'));

-- ===========================================================================
-- set_member_role: members.manage to act at all; Owner-only to create or
-- remove an Owner role. Last-owner guard unchanged. Audit call unchanged.
-- ===========================================================================

create or replace function public.set_member_role(p_membership_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_user_id uuid;
  v_current_role text;
  v_remaining_owners integer;
begin
  select workspace_id, user_id, role into v_workspace_id, v_user_id, v_current_role
  from public.workspace_memberships
  where id = p_membership_id and status = 'active';

  if not found then
    raise exception 'Membership not found.';
  end if;

  if not public.has_space_capability(v_workspace_id, 'members.manage') then
    raise exception 'You do not have permission to manage members of this Space.';
  end if;

  -- Promoting someone to Owner, or changing an existing Owner's role, is
  -- Owner-only - an Admin cannot mint or unseat an Owner.
  if (p_role = 'owner' or v_current_role = 'owner')
     and not public.is_workspace_member(v_workspace_id, 'owner') then
    raise exception 'Only an Owner can change ownership.';
  end if;

  if v_current_role = 'owner' and p_role <> 'owner' then
    select count(*) into v_remaining_owners
    from public.workspace_memberships
    where workspace_id = v_workspace_id
      and role = 'owner'
      and status = 'active'
      and id <> p_membership_id;

    if v_remaining_owners = 0 then
      raise exception 'A workspace must always have at least one owner.';
    end if;
  end if;

  update public.workspace_memberships
  set role = p_role
  where id = p_membership_id;

  perform public.record_space_audit_event(
    v_workspace_id, 'member.role_changed', 'workspace_membership', p_membership_id,
    jsonb_build_object('role', v_current_role, 'user_id', v_user_id),
    jsonb_build_object('role', p_role, 'user_id', v_user_id));
end;
$$;

-- ===========================================================================
-- remove_member: members.manage to act at all; removing an Owner stays
-- Owner-only. Last-owner guard, capability-grant cleanup, and audit/
-- activity calls unchanged.
-- ===========================================================================

create or replace function public.remove_member(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_user_id uuid;
  v_role text;
  v_remaining_owners integer;
begin
  select workspace_id, user_id, role into v_workspace_id, v_user_id, v_role
  from public.workspace_memberships
  where id = p_membership_id and status = 'active';

  if not found then
    raise exception 'Membership not found.';
  end if;

  if not public.has_space_capability(v_workspace_id, 'members.manage') then
    raise exception 'You do not have permission to manage members of this Space.';
  end if;

  if v_role = 'owner' then
    if not public.is_workspace_member(v_workspace_id, 'owner') then
      raise exception 'Only an Owner can remove an Owner.';
    end if;

    select count(*) into v_remaining_owners
    from public.workspace_memberships
    where workspace_id = v_workspace_id
      and role = 'owner'
      and status = 'active'
      and id <> p_membership_id;

    if v_remaining_owners = 0 then
      raise exception 'A workspace must always have at least one owner.';
    end if;
  end if;

  update public.workspace_memberships
  set status = 'removed', removed_at = now()
  where id = p_membership_id;

  delete from public.space_member_capability_grants
  where workspace_id = v_workspace_id and user_id = v_user_id;

  perform public.record_space_audit_event(
    v_workspace_id, 'member.removed', 'workspace_membership', p_membership_id,
    jsonb_build_object('role', v_role, 'user_id', v_user_id), null);
  perform public.record_space_activity(
    v_workspace_id, 'member.left', 'A member left the Space', 'workspace', v_workspace_id);
end;
$$;
