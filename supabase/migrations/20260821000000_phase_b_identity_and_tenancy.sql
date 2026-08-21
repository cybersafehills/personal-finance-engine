-- Phase B: authentication, identity, and the foundational tenant model.
--
-- Purely additive and safe to apply to production immediately: every new
-- column is nullable, every new table is new, and no existing row is
-- touched. The separate ownership-backfill migration
-- (20260821000100_phase_b_ownership_backfill_and_constraints.sql) is what
-- actually assigns the existing account/transactions/merchant_rules to a
-- workspace and tightens the new columns to NOT NULL - deliberately kept
-- apart so this file can be applied, verified, and left running for a
-- while before that irreversible-feeling step, exactly like the Phase 3
-- accounting-columns / Phase 4.1 backfill split.
--
-- This migration introduces the FIRST real browser-authenticated access
-- path this project has ever had. Until now every table only ever granted
-- service_role (see 20260818130200_revoke_anon_authenticated_privileges.sql
-- and 20260819000000_harden_function_and_sequence_default_privileges.sql).
-- Here, `authenticated` is deliberately granted table-level access to the
-- six tables below - but every one of those grants is paired with an RLS
-- policy keyed off workspace membership, so table-level access alone is
-- never sufficient to read or write a row. `anon` remains fully revoked
-- everywhere, as it already was.

-- ===========================================================================
-- profiles: one row per auth.users row. Deliberately thin - only what the
-- application needs beyond what Supabase Auth already stores.
-- ===========================================================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  preferred_currency char(3) not null default 'RWF'
    check (preferred_currency = upper(preferred_currency)),
  timezone text not null default 'Africa/Kigali',
  locale text not null default 'en',
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Application-level user record, 1:1 with auth.users. Ownership keys off auth.users.id (stable UUID) everywhere in this schema - never email, which Supabase Auth treats as mutable.';

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

-- ===========================================================================
-- workspaces: the single tenancy container for both personal and (future,
-- Phase C) organization workspaces, distinguished by `kind`. Personal and
-- organization workspaces are permanently distinct - there is no
-- conversion path, by explicit product decision. Only kind='personal' rows
-- are ever created in Phase B; 'organization' is declared now so every
-- downstream table's shape never has to change again in Phase C.
-- ===========================================================================

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('personal', 'organization')),
  name text not null,
  slug text unique,
  default_currency char(3) not null default 'RWF'
    check (default_currency = upper(default_currency)),
  timezone text not null default 'Africa/Kigali',
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.workspaces is
  'Unified tenancy container. kind=personal workspaces are created automatically, one per user, at signup and can never become kind=organization (permanently distinct, by product decision). kind=organization is declared but not populated until Phase C.';
comment on column public.workspaces.slug is
  'Organization-only human-readable identifier; NULL for personal workspaces.';

create trigger set_workspaces_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

alter table public.workspaces enable row level security;

-- ===========================================================================
-- workspace_memberships: every user<->workspace relationship goes through
-- this table, including the single owner of their own personal workspace -
-- there is deliberately no separate "personal owner" mechanism, so
-- authorization logic never special-cases personal vs organization.
-- ===========================================================================

create table public.workspace_memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  status text not null default 'active' check (status in ('invited', 'active', 'suspended', 'removed')),
  invited_by uuid references auth.users (id),
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_memberships_unique_member unique (workspace_id, user_id)
);

comment on table public.workspace_memberships is
  'The only membership mechanism in this schema - personal-workspace ownership is just a role=owner row here, not a separate concept. Phase B only ever creates role=owner/status=active rows via the signup trigger; invite/role-change workflows are Phase C.';

create trigger set_workspace_memberships_updated_at
  before update on public.workspace_memberships
  for each row execute function public.set_updated_at();

alter table public.workspace_memberships enable row level security;

create index idx_workspace_memberships_user on public.workspace_memberships (user_id, status);
create index idx_workspace_memberships_workspace on public.workspace_memberships (workspace_id, status);

-- ===========================================================================
-- is_workspace_member: the single authorization primitive every RLS policy
-- below (and every future workspace-scoped table) is built on. SECURITY
-- DEFINER so it can read workspace_memberships regardless of the calling
-- role's own RLS visibility into that table, STABLE so the planner can
-- evaluate it once per statement rather than once per row.
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
          min_role = 'member' and m.role in ('owner', 'admin', 'member')
        )
      )
  );
$$;

comment on function public.is_workspace_member is
  'Authorization primitive for RLS: is the current auth.uid() an active member of ws_id, with at least min_role. SECURITY DEFINER + STABLE. Phase B only ever has role=owner rows, so min_role is written now for Phase C''s admin/member/viewer roles to slot into without a policy rewrite, not because it is exercised yet.';

revoke all on function public.is_workspace_member(uuid, text) from public;
grant execute on function public.is_workspace_member(uuid, text) to authenticated, service_role;

-- ===========================================================================
-- Nullable workspace_id / account_id columns on existing tables. Nullable
-- deliberately - the ownership-backfill migration is what makes them
-- NOT NULL, only after the current owner's data has actually been
-- assigned. No existing row's value in any other column is touched here.
-- ===========================================================================

alter table public.accounts
  add column workspace_id uuid references public.workspaces (id);

alter table public.transactions
  add column workspace_id uuid references public.workspaces (id);

alter table public.merchant_rules
  add column workspace_id uuid references public.workspaces (id);

create index idx_accounts_workspace on public.accounts (workspace_id);
create index idx_transactions_workspace_occurred on public.transactions (workspace_id, occurred_at desc);
create index idx_merchant_rules_workspace on public.merchant_rules (workspace_id);

-- ===========================================================================
-- New-user provisioning: on every auth.users insert, deterministically
-- create the profile, the one personal workspace, and the owner
-- membership, in the same transaction as the auth row itself. This runs
-- for every new signup regardless of email-confirmation state - workspace
-- *existence* is not what email verification gates (see
-- 20260821000100_phase_b_ownership_backfill_and_constraints.sql's
-- verified-owner requirement and the application-level check on
-- email_confirmed_at that gates actual financial-data access).
-- ===========================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;

  insert into public.workspaces (kind, name, created_by)
  values ('personal', 'Personal', new.id)
  returning id into v_workspace_id;

  insert into public.workspace_memberships (workspace_id, user_id, role, status, joined_at)
  values (v_workspace_id, new.id, 'owner', 'active', now());

  return new;
end;
$$;

comment on function public.handle_new_user is
  'Provisions profile + one personal workspace + owner membership for every new auth.users row. Idempotent on the profile only (a workspace/membership pair is only ever created once, at the trigger''s single invocation per new user - there is no re-run path that would create a second personal workspace).';

revoke all on function public.handle_new_user() from public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===========================================================================
-- RLS policies. Every policy below is workspace-membership-scoped via
-- is_workspace_member(); service_role continues to bypass RLS entirely
-- (Postgres behavior, not a policy), which is how ingest-momo and any
-- remaining server-side service-role code keep working unaffected by
-- everything in this migration.
-- ===========================================================================

-- profiles: a user may only ever see/update their own profile row.
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- workspaces: readable by any active member; only the owner may update
-- workspace-level settings. No insert/delete policy for `authenticated` -
-- workspace creation only ever happens via handle_new_user() (service
-- context) in Phase B; user-initiated organization creation is Phase C.
create policy workspaces_select_member on public.workspaces
  for select to authenticated
  using (public.is_workspace_member(id));

create policy workspaces_update_owner on public.workspaces
  for update to authenticated
  using (public.is_workspace_member(id, 'owner'))
  with check (public.is_workspace_member(id, 'owner'));

-- workspace_memberships: a member can see the membership list of any
-- workspace they belong to. No insert/update/delete policy for
-- `authenticated` yet - membership rows are only ever created by
-- handle_new_user() in Phase B; invite/role-change/removal workflows are
-- Phase C and will add their own narrowly-scoped policies then.
create policy workspace_memberships_select_member on public.workspace_memberships
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- accounts / transactions / merchant_rules: readable by any active member;
-- mutable by the owner. Phase B has exactly one role in practice
-- (owner), so member-vs-owner write distinctions are inert today - written
-- this way now so Phase C's admin/member/viewer roles do not require a
-- policy rewrite, per the same reasoning as is_workspace_member's
-- min_role parameter above.
create policy accounts_select_member on public.accounts
  for select to authenticated
  using (workspace_id is not null and public.is_workspace_member(workspace_id));

create policy accounts_write_owner on public.accounts
  for insert to authenticated
  with check (public.is_workspace_member(workspace_id, 'owner'));

create policy accounts_update_owner on public.accounts
  for update to authenticated
  using (public.is_workspace_member(workspace_id, 'owner'))
  with check (public.is_workspace_member(workspace_id, 'owner'));

create policy transactions_select_member on public.transactions
  for select to authenticated
  using (workspace_id is not null and public.is_workspace_member(workspace_id));

-- Transactions are never user-deletable (financial history), and never
-- user-insertable directly (ingestion is the only writer, via
-- service_role) - only category/subcategory correction is a legitimate
-- authenticated-user write, matching what the existing category-correction
-- Server Action already does.
create policy transactions_update_categorize_member on public.transactions
  for update to authenticated
  using (public.is_workspace_member(workspace_id, 'owner'))
  with check (public.is_workspace_member(workspace_id, 'owner'));

create policy merchant_rules_select_member on public.merchant_rules
  for select to authenticated
  using (workspace_id is not null and public.is_workspace_member(workspace_id));

create policy merchant_rules_write_owner on public.merchant_rules
  for insert to authenticated
  with check (public.is_workspace_member(workspace_id, 'owner'));

create policy merchant_rules_update_owner on public.merchant_rules
  for update to authenticated
  using (public.is_workspace_member(workspace_id, 'owner'))
  with check (public.is_workspace_member(workspace_id, 'owner'));

-- ===========================================================================
-- Grants. anon remains fully revoked (unchanged from Phase 3). authenticated
-- gets exactly the table-level privileges its RLS policies above actually
-- use - never `all`, and never anything RLS doesn't also gate.
-- ===========================================================================

revoke all on public.profiles, public.workspaces, public.workspace_memberships,
  public.accounts, public.transactions, public.merchant_rules
  from anon;

grant select, update on public.profiles to authenticated;
grant select, update on public.workspaces to authenticated;
grant select on public.workspace_memberships to authenticated;
grant select, insert, update on public.accounts to authenticated;
grant select, update on public.transactions to authenticated;
grant select, insert, update on public.merchant_rules to authenticated;

grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.workspaces to service_role;
grant select, insert, update, delete on public.workspace_memberships to service_role;
