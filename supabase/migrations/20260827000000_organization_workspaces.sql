-- Organization workspaces: creation, invites, role changes, removal.
--
-- Phase B (20260821000000_phase_b_identity_and_tenancy.sql) declared
-- workspaces.kind = 'organization', the four-role workspace_memberships
-- shape, and a min_role-parameterized is_workspace_member() specifically
-- so this could slot in without a schema rewrite - but shipped zero
-- mutation capability for any of it. This migration is that capability.
--
-- Two deliberate defaults, matching the plan this migration was built
-- from: (1) 'admin' and 'member' get the same financial read/write
-- access 'owner' has today - a shared ledger is the point of an
-- organization workspace, only membership/workspace-settings management
-- stays owner-only; (2) invites are a bearer token
-- (accept_workspace_invite requires no email match, same model
-- ingestion_connections already uses), not an emailed link - no
-- SMTP/ESP is configured anywhere in this project yet.

-- ===========================================================================
-- is_workspace_member: add the missing 'admin' tier. Only 'owner' and
-- 'member' branches existed before this, so min_role = 'admin' could
-- never match anything.
-- ===========================================================================

create or replace function public.is_workspace_member(
  ws_id uuid,
  min_role text default null
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.workspace_memberships m
    where m.workspace_id = ws_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and (
        min_role is null
        or (
          min_role = 'owner' and m.role = 'owner'
        )
        or (
          min_role = 'admin' and m.role in ('owner', 'admin')
        )
        or (
          min_role = 'member' and m.role in ('owner', 'admin', 'member')
        )
      )
  );
$$;

-- ===========================================================================
-- Loosen accounts/transactions/merchant_rules writes from owner-only to
-- member-or-above, per the shared-ledger decision above. workspaces
-- itself (workspace settings) stays owner-only - unchanged, not reissued
-- here.
-- ===========================================================================

drop policy accounts_write_owner on public.accounts;
create policy accounts_write_member on public.accounts
  for insert to authenticated
  with check (public.is_workspace_member(workspace_id, 'member'));

drop policy accounts_update_owner on public.accounts;
create policy accounts_update_member on public.accounts
  for update to authenticated
  using (public.is_workspace_member(workspace_id, 'member'))
  with check (public.is_workspace_member(workspace_id, 'member'));

drop policy transactions_update_categorize_member on public.transactions;
create policy transactions_update_categorize_member on public.transactions
  for update to authenticated
  using (public.is_workspace_member(workspace_id, 'member'))
  with check (public.is_workspace_member(workspace_id, 'member'));

drop policy merchant_rules_write_owner on public.merchant_rules;
create policy merchant_rules_write_member on public.merchant_rules
  for insert to authenticated
  with check (public.is_workspace_member(workspace_id, 'member'));

drop policy merchant_rules_update_owner on public.merchant_rules;
create policy merchant_rules_update_member on public.merchant_rules
  for update to authenticated
  using (public.is_workspace_member(workspace_id, 'member'))
  with check (public.is_workspace_member(workspace_id, 'member'));

-- ===========================================================================
-- create_organization_workspace: same shape as handle_new_user()'s
-- personal-workspace provisioning, callable directly by an already
-- signed-in user. This is why no INSERT policy is needed on workspaces
-- or workspace_memberships for `authenticated` - same reasoning
-- handle_new_user() already established for the personal-workspace path.
-- ===========================================================================

create or replace function public.create_organization_workspace(
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
begin
  insert into public.workspaces (kind, name, created_by)
  values ('organization', p_name, auth.uid())
  returning id into v_workspace_id;

  insert into public.workspace_memberships (workspace_id, user_id, role, status, joined_at)
  values (v_workspace_id, auth.uid(), 'owner', 'active', now());

  return v_workspace_id;
end;
$$;

comment on function public.create_organization_workspace is
  'Creates a new organization workspace with the caller as its sole owner. The only user-initiated workspace-creation path - personal workspaces remain exclusively provisioned by handle_new_user() at signup.';

revoke all on function public.create_organization_workspace(text) from public;
grant execute on function public.create_organization_workspace(text) to authenticated;

-- ===========================================================================
-- workspace_invites: an owner-issued, bearer-token invite to join an
-- organization workspace at a given role. Never issues role='owner' -
-- ownership only ever changes via set_member_role's last-owner-guarded
-- path below, not an invite.
-- ===========================================================================

create table public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'member', 'viewer')),
  token_hash text not null unique,
  token_prefix text not null,
  invited_by uuid references auth.users (id),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

comment on table public.workspace_invites is
  'Owner-issued bearer-token invites into an organization workspace. Only the SHA-256 hash of the token is stored, same convention as ingestion_connections.credential_hash - the plaintext link is shown to the owner exactly once at creation time.';

create index idx_workspace_invites_workspace on public.workspace_invites (workspace_id, status);

alter table public.workspace_invites enable row level security;

revoke all on public.workspace_invites from anon;

create policy workspace_invites_select_owner on public.workspace_invites
  for select to authenticated
  using (public.is_workspace_member(workspace_id, 'owner'));

create policy workspace_invites_insert_owner on public.workspace_invites
  for insert to authenticated
  with check (
    public.is_workspace_member(workspace_id, 'owner')
    and invited_by = auth.uid()
  );

-- Update is revoke-only in practice (status -> 'revoked') - there is no
-- delete policy, matching this schema's no-hard-delete convention.
create policy workspace_invites_update_owner on public.workspace_invites
  for update to authenticated
  using (public.is_workspace_member(workspace_id, 'owner'))
  with check (public.is_workspace_member(workspace_id, 'owner'));

grant select, insert, update on public.workspace_invites to authenticated;
grant select, insert, update, delete on public.workspace_invites to service_role;

-- ===========================================================================
-- invite_preview: the one read a not-yet-a-member visitor needs - just
-- enough to render the invite landing page - without granting them
-- anything workspace_invites' owner-only RLS would otherwise block.
-- ===========================================================================

create or replace function public.invite_preview(p_token_hash text)
returns table (workspace_name text, role text, valid boolean)
language sql
security definer
set search_path = public
stable
as $$
  select
    w.name,
    i.role,
    (i.status = 'pending' and i.expires_at > now())
  from public.workspace_invites i
  join public.workspaces w on w.id = i.workspace_id
  where i.token_hash = p_token_hash;
$$;

revoke all on function public.invite_preview(text) from public;
grant execute on function public.invite_preview(text) to authenticated, anon;

-- ===========================================================================
-- accept_workspace_invite: token-only acceptance, no email match
-- required - same bearer-credential model ingestion_connections already
-- uses. Handles the re-invite-after-removal case via ON CONFLICT.
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
  set status = 'accepted', accepted_at = now()
  where id = v_invite.id;

  return v_invite.workspace_id;
end;
$$;

comment on function public.accept_workspace_invite is
  'Redeems a pending, unexpired invite token for the calling (already-authenticated) user. Token-only - does not check the invite email against the caller''s own, by design (see this migration''s header comment).';

revoke all on function public.accept_workspace_invite(text) from public;
grant execute on function public.accept_workspace_invite(text) to authenticated;

-- ===========================================================================
-- set_member_role / remove_member: the only two ways a
-- workspace_memberships row changes after creation. Both owner-only and
-- both refuse to leave a workspace with zero active owners - this is the
-- one invariant worth centralizing in SQL rather than trusting the UI.
-- No raw INSERT/UPDATE/DELETE policy exists on workspace_memberships for
-- `authenticated` - it stays select-only, exactly as Phase B left it -
-- these two SECURITY DEFINER functions are the entire mutation surface.
-- ===========================================================================

create or replace function public.set_member_role(p_membership_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_current_role text;
  v_remaining_owners integer;
begin
  select workspace_id, role into v_workspace_id, v_current_role
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
end;
$$;

revoke all on function public.set_member_role(uuid, text) from public;
grant execute on function public.set_member_role(uuid, text) to authenticated;

create or replace function public.remove_member(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_role text;
  v_remaining_owners integer;
begin
  select workspace_id, role into v_workspace_id, v_role
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
end;
$$;

revoke all on function public.remove_member(uuid) from public;
grant execute on function public.remove_member(uuid) to authenticated;
