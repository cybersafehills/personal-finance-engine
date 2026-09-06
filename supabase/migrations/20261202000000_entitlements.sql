-- Entitlements & plan tiers (ADR 0015 / master prompt section 52).
--
-- A per-workspace plan. The tier -> entitlement map lives in ONE place,
-- web/lib/entitlements/plans.ts (TS side) - this migration only STORES
-- the plan, it does not encode the capability map in SQL. Additive,
-- backward-compatible, and dark: nothing enforces an entitlement until
-- ENTITLEMENTS_ENABLED is set and call sites opt in. No enforcement call
-- site changes land with this migration.
--
-- Guardrail (assessment section 7): a plan NEVER gates a user's own
-- data, export, deletion, or account security - only automation volume,
-- collaboration, and operational control.
--
-- Scope decision: the plan attaches to the workspace (Space), not the
-- user - a Household Space carries the Household plan, an organization
-- carries Business, a Personal Space carries Free / Personal Plus. The
-- workspace owner is the billing contact. (No billing exists yet.)

create table public.workspace_plans (
  workspace_id uuid primary key
    references public.workspaces (id) on delete cascade,
  plan text not null default 'free'
    check (plan in ('free', 'personal_plus', 'household', 'business')),
  -- How this assignment was made, for a future billing integration to
  -- reason about. No self-serve billing exists, so today every row is
  -- 'system'.
  assigned_by text not null default 'system'
    check (assigned_by in ('system', 'admin', 'billing', 'trial')),
  -- Optional trial window; NULL = not on a trial.
  trial_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.workspace_plans is
  'One row per workspace: its current plan tier. The tier->entitlement map is web/lib/entitlements/plans.ts, not SQL. Writes are system/admin/service_role only - there is no self-serve billing. A plan never gates a user''s own data, export, deletion, or security (assessment section 7).';

create trigger set_workspace_plans_updated_at
  before update on public.workspace_plans
  for each row execute function public.set_updated_at();

alter table public.workspace_plans enable row level security;

-- Any active member may read their workspace's plan (the Billing & Plan
-- settings page). NOBODY authenticated may write it: there is no
-- insert/update/delete policy, so PostgREST denies those for the
-- authenticated role; service_role bypasses RLS and owns every write for
-- now.
create policy workspace_plans_select_member on public.workspace_plans
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

grant select on public.workspace_plans to authenticated;
grant select, insert, update, delete on public.workspace_plans to service_role;

-- Cover every existing workspace with a default free row...
insert into public.workspace_plans (workspace_id)
  select id from public.workspaces
  on conflict (workspace_id) do nothing;

-- ...and every workspace created from now on, so the invariant "exactly
-- one plan row per workspace" holds with no race against the
-- workspace-creation RPCs.
create or replace function public.ensure_workspace_plan()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  insert into public.workspace_plans (workspace_id)
    values (new.id)
    on conflict (workspace_id) do nothing;
  return new;
end;
$$;

comment on function public.ensure_workspace_plan is
  'AFTER INSERT on workspaces: provisions the default free plan row. SECURITY DEFINER because the session creating an organization/household workspace is the authenticated user, not service_role. Idempotent.';

revoke all on function public.ensure_workspace_plan() from public;

create trigger ensure_workspace_plan_after_insert
  after insert on public.workspaces
  for each row execute function public.ensure_workspace_plan();
