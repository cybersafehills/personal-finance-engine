-- Phase L: application-shell UI preferences - persistence for the
-- responsive shell/navigation/dashboard-privacy modernization.
--
-- Purely additive, following the exact conventions established in Phase J
-- (report_preferences): uuid pk default gen_random_uuid(), timestamptz +
-- set_updated_at() trigger, workspace_id uuid not null references
-- workspaces(id), RLS built on is_workspace_member(), anon fully revoked,
-- unique (workspace_id, user_id) - one row per user's own preference
-- *within* a workspace, exactly like report_preferences, since a
-- shared/organization workspace's members may each want a different
-- navigation order or privacy default.
--
-- ui_preferences holds:
--   nav_order - the user's chosen order of the four movable primary
--     destinations (Transactions/Categories/Budgets/Settings). Home is
--     never stored here - it is permanently first in the application
--     shell and not user-configurable (master prompt §5). Reports is
--     never a member of this array - it was deliberately removed from
--     primary navigation and lives only behind the header icon and the
--     Settings "Reports" link. Stored as text[] rather than a schemaless
--     jsonb blob so the exact-permutation-of-four-known-values invariant
--     is a real database constraint, not just an application check.
--   hide_balance - the persisted state of the Current Balance card's
--     eye/eye-off control (display privacy for the main balance only).
--   privacy_mode - "full financial privacy": conceals every sensitive
--     dashboard figure (balance, today's totals, budget remaining,
--     dashboard transaction preview amounts). Broader than hide_balance,
--     which it takes precedence over on the dashboard.
--   reports_relocation_notice_dismissed - whether the user has already
--     seen and dismissed the one-time "Reports moved to the header"
--     discovery aid, so it never shows twice for the same user.
--
-- Both booleans and nav_order are display-privacy/personalization only -
-- see master prompt §6.5/§15: this table never gates authorization, and
-- is never read by any report-generation, export, or API authorization
-- path.

-- Check constraints cannot contain an inline subquery (Postgres rejects
-- it outright - "cannot use subquery in check constraint"), so the
-- duplicate-detection part of the nav_order shape check lives in this
-- small immutable helper instead, which the check constraint below then
-- simply calls.
create function public.is_valid_nav_order(order_ text[])
returns boolean
language sql
immutable
as $$
  select
    array_length(order_, 1) = 4
    and order_ <@ array['transactions', 'categories', 'budgets', 'settings']
    and (select count(distinct item) from unnest(order_) as item) = 4
$$;

create table public.ui_preferences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  nav_order text[] not null default array['transactions', 'categories', 'budgets', 'settings'],
  hide_balance boolean not null default false,
  privacy_mode boolean not null default false,
  reports_relocation_notice_dismissed boolean not null default false,
  -- Versioned so a future migration widening the allowed nav destination
  -- set (or changing preference shape) can distinguish rows written under
  -- an older schema without guessing from contents alone.
  preferences_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ui_preferences_unique_owner unique (workspace_id, user_id),
  -- Exactly the four allowed movable destinations, no duplicates, no
  -- unknown values, no omissions - enforced server-side regardless of
  -- what any client sends.
  constraint ui_preferences_nav_order_shape check (
    public.is_valid_nav_order(nav_order)
  )
);

comment on table public.ui_preferences is
  'One row per (workspace_id, user_id): a user''s own application-shell personalization (primary navigation order, balance/dashboard display-privacy, one-time UI notices) within a workspace. Display/personalization only - never an authorization boundary, see master prompt §6.5/§15.';

create trigger set_ui_preferences_updated_at
  before update on public.ui_preferences
  for each row execute function public.set_updated_at();

alter table public.ui_preferences enable row level security;

create policy ui_preferences_select_own on public.ui_preferences
  for select to authenticated
  using (user_id = auth.uid() and public.is_workspace_member(workspace_id));
create policy ui_preferences_insert_own on public.ui_preferences
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_workspace_member(workspace_id));
create policy ui_preferences_update_own on public.ui_preferences
  for update to authenticated
  using (user_id = auth.uid() and public.is_workspace_member(workspace_id))
  with check (user_id = auth.uid() and public.is_workspace_member(workspace_id));

revoke all on public.ui_preferences from anon;
grant select, insert, update on public.ui_preferences to authenticated;
