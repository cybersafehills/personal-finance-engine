-- Phase V (PR1): the notification delivery spine.
--
-- Phase T PR1 shipped should_notify(workspace, user, event_key, channel)
-- but nothing has ever called it. This migration adds the store it feeds
-- and the enqueue primitive, then wires the two clearest producers
-- (member.joined via an accepted invite, member.removed) so there is a
-- real, end-to-end path in production. Budget-threshold, source-sharing,
-- goal, and large-transaction producers, plus the email drainer, are
-- later Phase V PRs.
--
-- Numbered 20261001 to stay clear of a concurrent "bills" feature that
-- is churning September migration timestamps on its own branch.

-- ===========================================================================
-- notifications: one row per (user, channel) that should be told about an
-- event. in_app rows are read in the app (read_at); email rows are an
-- outbox (delivered_at null = not sent yet). Written only through
-- enqueue_notification / the mark-read RPCs - authenticated has SELECT
-- and nothing else.
-- ===========================================================================
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  event_key text not null,
  channel text not null check (channel in ('in_app', 'email')),
  title text not null check (length(trim(both from title)) > 0),
  body text,
  resource_type text,
  resource_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  -- in_app only: when the user marked it read.
  read_at timestamptz,
  -- email only: when the outbox row was sent (null = pending).
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.notifications is
  'Per-user notification records produced by enqueue_notification() (which gates every row through should_notify). channel=''in_app'' rows are shown in the app and cleared via read_at; channel=''email'' rows are a send outbox cleared via delivered_at. authenticated may only SELECT its own rows.';

create index idx_notifications_user_unread
  on public.notifications (user_id, created_at desc)
  where channel = 'in_app' and read_at is null;

create index idx_notifications_email_pending
  on public.notifications (created_at)
  where channel = 'email' and delivered_at is null;

alter table public.notifications enable row level security;

create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

revoke all on public.notifications from anon;
grant select on public.notifications to authenticated;
grant select, insert, update, delete on public.notifications to service_role;

-- ===========================================================================
-- enqueue_notification: fan one event out to the members who want it.
-- Internal (revoke all from public) - called only from other SECURITY
-- DEFINER RPCs, which run as the table owner and so bypass the RLS above.
-- p_user_ids null => every active member; p_exclude_user_id drops one
-- (e.g. the member who just joined shouldn't be told they joined).
-- Every candidate row is gated through should_notify per channel.
-- Returns the number of rows written.
-- ===========================================================================
create or replace function public.enqueue_notification(
  p_workspace_id uuid,
  p_user_ids uuid[],
  p_exclude_user_id uuid,
  p_event_key text,
  p_title text,
  p_body text,
  p_resource_type text default null,
  p_resource_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_written integer := 0;
  v_uid uuid;
begin
  for v_uid in
    select m.user_id
    from public.workspace_memberships m
    where m.workspace_id = p_workspace_id
      and m.status = 'active'
      and (p_user_ids is null or m.user_id = any (p_user_ids))
      and (p_exclude_user_id is null or m.user_id <> p_exclude_user_id)
  loop
    if public.should_notify(p_workspace_id, v_uid, p_event_key, 'in_app') then
      insert into public.notifications
        (workspace_id, user_id, event_key, channel, title, body, resource_type, resource_id, metadata)
      values
        (p_workspace_id, v_uid, p_event_key, 'in_app', p_title, p_body, p_resource_type, p_resource_id, coalesce(p_metadata, '{}'::jsonb));
      v_written := v_written + 1;
    end if;

    if public.should_notify(p_workspace_id, v_uid, p_event_key, 'email') then
      insert into public.notifications
        (workspace_id, user_id, event_key, channel, title, body, resource_type, resource_id, metadata)
      values
        (p_workspace_id, v_uid, p_event_key, 'email', p_title, p_body, p_resource_type, p_resource_id, coalesce(p_metadata, '{}'::jsonb));
      v_written := v_written + 1;
    end if;
  end loop;

  return v_written;
end;
$$;

comment on function public.enqueue_notification is
  'Internal: fans one event out to the workspace''s active members, one row per channel per member that should_notify() approves. Not authenticated-callable - invoked only from other SECURITY DEFINER RPCs.';

revoke all on function public.enqueue_notification(uuid, uuid[], uuid, text, text, text, text, uuid, jsonb) from public;

-- ===========================================================================
-- mark_notification_read / mark_all_notifications_read / unread count:
-- the authenticated-callable surface. All own-scoped and in_app-only.
-- ===========================================================================
create or replace function public.mark_notification_read(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications
  set read_at = now()
  where id = p_id
    and user_id = auth.uid()
    and channel = 'in_app'
    and read_at is null;
$$;

create or replace function public.mark_all_notifications_read(p_workspace_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with updated as (
    update public.notifications
    set read_at = now()
    where user_id = auth.uid()
      and channel = 'in_app'
      and read_at is null
      and (p_workspace_id is null or workspace_id = p_workspace_id)
    returning 1
  )
  select count(*) into v_count from updated;
  return v_count;
end;
$$;

create or replace function public.unread_notification_count()
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::integer
  from public.notifications
  where user_id = auth.uid()
    and channel = 'in_app'
    and read_at is null;
$$;

revoke all on function public.mark_notification_read(uuid) from public;
revoke all on function public.mark_all_notifications_read(uuid) from public;
revoke all on function public.unread_notification_count() from public;
grant execute on function public.mark_notification_read(uuid) to authenticated, service_role;
grant execute on function public.mark_all_notifications_read(uuid) to authenticated, service_role;
grant execute on function public.unread_notification_count() to authenticated, service_role;

-- ===========================================================================
-- Producers: re-issue accept_workspace_invite and remove_member to also
-- enqueue a notification. Bodies are unchanged except for the trailing
-- enqueue_notification() call.
-- ===========================================================================
create or replace function public.accept_workspace_invite(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.workspace_invites%rowtype;
begin
  select * into v_invite
  from public.workspace_invites
  where token_hash = p_token_hash
    and status = 'pending'
    and expires_at > now();

  if not found then
    raise exception 'Invite is invalid or has expired.';
  end if;

  insert into public.workspace_memberships
    (workspace_id, user_id, role, status, invited_by, joined_at)
  values
    (v_invite.workspace_id, auth.uid(), v_invite.role, 'active', v_invite.invited_by, now())
  on conflict (workspace_id, user_id) do update
    set role = excluded.role,
        status = 'active',
        invited_by = excluded.invited_by,
        joined_at = now(),
        removed_at = null;

  update public.workspace_invites
  set status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
  where id = v_invite.id;

  perform public.record_space_audit_event(
    v_invite.workspace_id, 'member.joined_via_invite', 'workspace_membership', null,
    null, jsonb_build_object('role', v_invite.role, 'invited_by', v_invite.invited_by));
  perform public.record_space_activity(
    v_invite.workspace_id, 'member.joined', 'A new member joined', 'workspace', v_invite.workspace_id);

  perform public.enqueue_notification(
    v_invite.workspace_id, null, auth.uid(),
    'member.joined', 'A new member joined this Space',
    null, 'workspace', v_invite.workspace_id,
    jsonb_build_object('role', v_invite.role));

  return v_invite.workspace_id;
end;
$$;

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

  perform public.enqueue_notification(
    v_workspace_id, null, v_user_id,
    'member.removed', 'A member was removed from this Space',
    null, 'workspace', v_workspace_id,
    jsonb_build_object('role', v_role));
end;
$$;
