-- Phase W (PR2): tell a member they were removed from a Space.
--
-- Phase V PR1 wired member.removed into remove_member, but deliberately
-- only to the *remaining* members (the actor-exclusion pattern). The one
-- person who most needs to know - the removed member - got nothing, and
-- getActiveWorkspaceId() silently drops them back to their personal
-- workspace with no explanation. This re-issues remove_member to also
-- enqueue a "You were removed" notification for that user, placed before
-- the status flip so enqueue_notification's active-member filter still
-- reaches them. member.removed is security-notable, so it always
-- delivers regardless of their preferences.
--
-- Re-issue only: signature, grants, and every other line are unchanged.

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

  -- Notify the departing member while they are still active (the fan-out
  -- only targets active members).
  perform public.enqueue_notification(
    v_workspace_id, array[v_user_id], null,
    'member.removed', 'You were removed from this Space',
    null, 'workspace', v_workspace_id,
    jsonb_build_object('role', v_role, 'self', true));

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

  perform public.enqueue_notification(
    v_workspace_id, null, v_user_id,
    'member.removed', 'A member was removed from this Space',
    null, 'workspace', v_workspace_id,
    jsonb_build_object('role', v_role));
end;
$$;
