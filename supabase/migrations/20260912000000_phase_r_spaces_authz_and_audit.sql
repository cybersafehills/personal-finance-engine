-- Phase R: OneLedger Spaces - authorization capability layer + audit/activity
-- write primitives, and hardening of the membership/invite mutation RPCs to
-- record what they do.
--
-- Design of record: docs/oneledger-spaces-design.md (Phase R row).
-- Builds on Phase Q (20260910000000 / 20260911000000).
--
-- Purely additive. One new table, five new functions, one nullable column
-- on workspace_invites, and CREATE OR REPLACE re-issues of four existing
-- SECURITY DEFINER RPCs (grants preserved by CREATE OR REPLACE, bodies
-- extended only to write an audit/activity row). No existing row is
-- modified. Still no user-visible behaviour change: capability checks are
-- not yet wired into any budget/goal/rule flow (that is Phase T) - RLS
-- remains the live control - and there are zero household workspaces until
-- Phase S.

-- ===========================================================================
-- space_role_has_capability: the capability matrix, as a pure IMMUTABLE
-- function rather than a table. Deliberately small (master prompt S7:
-- "avoid enterprise-level custom RBAC complexity in the first public
-- Household implementation" while keeping expansion feasible). Editing the
-- matrix = editing this one CASE; per-member exceptions live in
-- space_member_capability_grants below.
--
-- Only ever called from has_space_capability() (a SECURITY DEFINER
-- function that runs as the table owner), so it needs no EXECUTE grant of
-- its own - same reasoning as policy_matches_transaction (Phase F).
-- ===========================================================================

create or replace function public.space_role_has_capability(
  p_kind text,
  p_role text,
  p_capability text
)
returns boolean
language sql
immutable
as $$
  select case
    -- personal workspaces only ever have a single role=owner member.
    when p_kind = 'personal' then p_role = 'owner'
    -- household + organization share one matrix.
    when p_role = 'owner' then true
    when p_role = 'admin'
      then p_capability not in ('space.delete', 'space.transfer_ownership')
    when p_role = 'member'
      then p_capability in ('transaction.create', 'transaction.categorize')
    else false  -- viewer, or an unrecognised role
  end;
$$;

comment on function public.space_role_has_capability is
  'The Spaces capability matrix. Pure/IMMUTABLE. Known capabilities: space.manage_settings, space.delete, space.transfer_ownership, members.manage, budget.manage, goal.manage, rule.manage, report.config, category.manage, transaction.create, transaction.categorize, audit.view. Owner: all. Admin: all except space.delete / space.transfer_ownership. Member: transaction.create / transaction.categorize. Viewer: none. Per-member exceptions are additive via space_member_capability_grants.';

-- ===========================================================================
-- space_member_capability_grants: an owner/admin can grant one specific
-- member one specific capability beyond their role's default (e.g. let a
-- Member manage budgets - master prompt S7's "Member may be granted
-- editing permission", without building an approval workflow). Additive
-- only: there is no "deny" row. Mutated exclusively through
-- grant_space_capability / revoke_space_capability below, so it is
-- SELECT-only for authenticated (members may see who holds what).
-- ===========================================================================

create table public.space_member_capability_grants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  capability text not null,
  granted_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  constraint space_member_capability_grants_unique
    unique (workspace_id, user_id, capability)
);

comment on table public.space_member_capability_grants is
  'Per-member capability grants layered on top of the role matrix in space_role_has_capability(). Additive only. Written exclusively by grant_space_capability() / revoke_space_capability().';

create index idx_space_member_capability_grants_lookup
  on public.space_member_capability_grants (workspace_id, user_id);

alter table public.space_member_capability_grants enable row level security;

create policy space_member_capability_grants_select_member
  on public.space_member_capability_grants
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

revoke all on public.space_member_capability_grants from anon;
grant select on public.space_member_capability_grants to authenticated;
grant select, insert, update, delete
  on public.space_member_capability_grants to service_role;

-- ===========================================================================
-- has_space_capability: the single authorization primitive Phase S/T RPCs
-- and any future capability-gated RLS compose with. Mirrors
-- is_workspace_member(): SECURITY DEFINER (reads memberships/grants past
-- the caller's own RLS, and cannot recurse), STABLE, search_path pinned,
-- explicit EXECUTE grant to authenticated (it is invoked from policies /
-- RPCs that run as the calling role - the Phase L is_valid_nav_order
-- lesson).
-- ===========================================================================

create or replace function public.has_space_capability(
  p_workspace_id uuid,
  p_capability text
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    public.is_workspace_member(p_workspace_id)
    and (
      exists (
        select 1 from public.space_member_capability_grants g
        where g.workspace_id = p_workspace_id
          and g.user_id = auth.uid()
          and g.capability = p_capability
      )
      or exists (
        select 1 from public.workspace_memberships m
        where m.workspace_id = p_workspace_id
          and m.user_id = auth.uid()
          and m.status = 'active'
          and public.space_role_has_capability(
                coalesce((select kind from public.workspaces where id = p_workspace_id), ''),
                m.role,
                p_capability)
      )
    );
$$;

comment on function public.has_space_capability is
  'Authorization primitive: does the current auth.uid() hold capability p_capability in workspace p_workspace_id - by their membership role (space_role_has_capability) or an explicit space_member_capability_grants row. SECURITY DEFINER + STABLE.';

revoke all on function public.has_space_capability(uuid, text) from public;
grant execute on function public.has_space_capability(uuid, text) to authenticated, service_role;

-- ===========================================================================
-- record_space_activity / record_space_audit_event: the write side of the
-- two Phase Q collaboration logs. Internal helpers - `revoke all from
-- public`, no authenticated grant - invoked only from within other
-- SECURITY DEFINER RPCs (the re-issues below, and Phase S/T RPCs). They
-- run as the table owner, which bypasses the append-only tables' RLS
-- (neither table has an authenticated INSERT policy). actor_user_id is
-- always the calling user's auth.uid(), never a parameter.
-- ===========================================================================

create or replace function public.record_space_activity(
  p_workspace_id uuid,
  p_kind text,
  p_summary text,
  p_ref_type text default null,
  p_ref_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.space_activity
    (workspace_id, actor_user_id, kind, summary, ref_type, ref_id)
  values
    (p_workspace_id, auth.uid(), p_kind, p_summary, p_ref_type, p_ref_id);
end;
$$;

comment on function public.record_space_activity is
  'Internal: appends one human-readable row to space_activity for the calling user. Not authenticated-callable - invoked only from other SECURITY DEFINER RPCs.';

revoke all on function public.record_space_activity(uuid, text, text, text, uuid) from public;

create or replace function public.record_space_audit_event(
  p_workspace_id uuid,
  p_event_type text,
  p_resource_type text,
  p_resource_id uuid default null,
  p_old_value jsonb default null,
  p_new_value jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.space_audit_events
    (workspace_id, actor_user_id, event_type, resource_type, resource_id, old_value, new_value)
  values
    (p_workspace_id, auth.uid(), p_event_type, p_resource_type, p_resource_id, p_old_value, p_new_value);
end;
$$;

comment on function public.record_space_audit_event is
  'Internal: appends one row to the protected space_audit_events trail for the calling user. Not authenticated-callable - invoked only from other SECURITY DEFINER RPCs.';

revoke all on function public.record_space_audit_event(uuid, text, text, uuid, jsonb, jsonb) from public;

-- ===========================================================================
-- grant_space_capability / revoke_space_capability: the entire mutation
-- surface for space_member_capability_grants. members.manage-gated
-- (owner/admin), validate the capability name and that the target is an
-- active member, and write an audit event either way.
-- ===========================================================================

create or replace function public.grant_space_capability(
  p_workspace_id uuid,
  p_user_id uuid,
  p_capability text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_space_capability(p_workspace_id, 'members.manage') then
    raise exception 'You do not have permission to manage members of this Space.';
  end if;

  if p_capability not in (
    'space.manage_settings', 'space.delete', 'space.transfer_ownership',
    'members.manage', 'budget.manage', 'goal.manage', 'rule.manage',
    'report.config', 'category.manage', 'transaction.create',
    'transaction.categorize', 'audit.view'
  ) then
    raise exception 'Unknown capability: %', p_capability;
  end if;

  if not exists (
    select 1 from public.workspace_memberships
    where workspace_id = p_workspace_id
      and user_id = p_user_id
      and status = 'active'
  ) then
    raise exception 'That person is not an active member of this Space.';
  end if;

  insert into public.space_member_capability_grants
    (workspace_id, user_id, capability, granted_by)
  values (p_workspace_id, p_user_id, p_capability, auth.uid())
  on conflict (workspace_id, user_id, capability) do nothing;

  perform public.record_space_audit_event(
    p_workspace_id, 'capability.granted', 'user', p_user_id,
    null, jsonb_build_object('capability', p_capability));
end;
$$;

revoke all on function public.grant_space_capability(uuid, uuid, text) from public;
grant execute on function public.grant_space_capability(uuid, uuid, text) to authenticated;

create or replace function public.revoke_space_capability(
  p_workspace_id uuid,
  p_user_id uuid,
  p_capability text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_space_capability(p_workspace_id, 'members.manage') then
    raise exception 'You do not have permission to manage members of this Space.';
  end if;

  delete from public.space_member_capability_grants
  where workspace_id = p_workspace_id
    and user_id = p_user_id
    and capability = p_capability;

  perform public.record_space_audit_event(
    p_workspace_id, 'capability.revoked', 'user', p_user_id,
    jsonb_build_object('capability', p_capability), null);
end;
$$;

revoke all on function public.revoke_space_capability(uuid, uuid, text) from public;
grant execute on function public.revoke_space_capability(uuid, uuid, text) to authenticated;

-- ===========================================================================
-- workspace_invites.accepted_by: which user actually redeemed a bearer
-- token. accept_workspace_invite is intentionally token-only (no email
-- match - Phase C's documented bearer model), so recording the redeemer
-- is the audit compensation for that.
-- ===========================================================================

alter table public.workspace_invites
  add column accepted_by uuid references auth.users (id);

comment on column public.workspace_invites.accepted_by is
  'The user who redeemed this bearer-token invite (set by accept_workspace_invite). NULL until accepted. Audit compensation for the deliberately email-agnostic redemption model.';

-- ===========================================================================
-- Re-issues (CREATE OR REPLACE - grants and signatures unchanged, bodies
-- extended only to record what already happens):
--   accept_workspace_invite - stamp accepted_by + audit + activity
--   set_member_role         - audit the role change
--   remove_member           - audit the removal
--   create_household_workspace - activity row for "Household created"
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

  return v_invite.workspace_id;
end;
$$;

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

  if not public.is_workspace_member(v_workspace_id, 'owner') then
    raise exception 'Only a workspace owner can change member roles.';
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

  if not public.is_workspace_member(v_workspace_id, 'owner') then
    raise exception 'Only a workspace owner can remove a member.';
  end if;

  if v_role = 'owner' then
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

  -- Any per-member capability grants leave with the member.
  delete from public.space_member_capability_grants
  where workspace_id = v_workspace_id and user_id = v_user_id;

  perform public.record_space_audit_event(
    v_workspace_id, 'member.removed', 'workspace_membership', p_membership_id,
    jsonb_build_object('role', v_role, 'user_id', v_user_id), null);
  perform public.record_space_activity(
    v_workspace_id, 'member.left', 'A member left the Space', 'workspace', v_workspace_id);
end;
$$;

create or replace function public.create_household_workspace(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
begin
  insert into public.workspaces (kind, name, default_currency, timezone, created_by)
  values (
    'household',
    p_name,
    coalesce((select preferred_currency from public.profiles where id = auth.uid()), 'RWF'),
    coalesce((select timezone from public.profiles where id = auth.uid()), 'Africa/Kigali'),
    auth.uid()
  )
  returning id into v_workspace_id;

  insert into public.workspace_memberships (workspace_id, user_id, role, status, joined_at)
  values (v_workspace_id, auth.uid(), 'owner', 'active', now());

  perform public.record_space_activity(
    v_workspace_id, 'space.created', 'Household created', 'workspace', v_workspace_id);
  perform public.record_space_audit_event(
    v_workspace_id, 'space.created', 'workspace', v_workspace_id,
    null, jsonb_build_object('kind', 'household', 'name', p_name));

  return v_workspace_id;
end;
$$;
