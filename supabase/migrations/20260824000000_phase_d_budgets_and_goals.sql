-- Phase D (D1): budgeting foundation - system budget template, persisted
-- budgets/allocations, category-to-allocation mappings, and financial
-- goals/contributions.
--
-- Purely additive: no existing table, column, or row is touched. Every new
-- table is workspace-scoped and follows the same is_workspace_member()
-- RLS pattern established in Phase B/C (select for any active member,
-- write for the workspace owner only - this project has no multi-role
-- write model yet, see is_workspace_member's own comments).
--
-- Monetary amounts on every new table are `_minor bigint` - integer minor
-- units of the row's own currency, currency-dependent (RWF has 0 decimal
-- places, so 1 minor unit = 1 RWF; EUR/USD have 2, so 1 minor unit = 1
-- cent). This deliberately does NOT reuse the existing transactions
-- table's `_rwf` naming/precision convention, because transactions are
-- hardcoded to RWF (the only currency MTN MoMo ingestion ever produces)
-- while budgets/goals must support RWF, EUR, and USD. The currency-minor-
-- unit mapping lives in application code (web/lib/money.ts), not here -
-- Postgres has no per-row-currency numeric type to enforce it directly.
--
-- Live transaction-actuals only ever exist for RWF budgets in this first
-- release, since RWF is the only currency any ingestion path produces
-- today (see ingest-momo). A EUR/USD budget is fully usable as a
-- calculator + persisted plan; it just has no automatic actuals feed yet.
-- This is a scope decision, not a bug - documented here since it is the
-- schema's own doing (transactions has no EUR/USD rows to match against).

-- ===========================================================================
-- budget_templates / budget_template_allocations: the system-provided
-- 50/15/5/30 template, plus room for future templates. Global, not
-- workspace-scoped - every workspace reads the same system template(s).
-- ===========================================================================

create table public.budget_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(both from name)) > 0),
  description text,
  is_system_template boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.budget_templates is
  'Global, shared budget templates (e.g. the system 50/15/5/30 model). Not workspace-scoped - every workspace reads the same rows. Read-only to end users in this first release; only service_role can write.';

create trigger set_budget_templates_updated_at
  before update on public.budget_templates
  for each row execute function public.set_updated_at();

create table public.budget_template_allocations (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.budget_templates (id) on delete cascade,
  allocation_type text not null
    check (allocation_type in ('ESSENTIALS', 'INVESTING', 'EMERGENCY', 'WANTS')),
  percentage numeric(5, 2) not null check (percentage >= 0 and percentage <= 100),
  sort_order integer not null default 0,
  constraint budget_template_allocations_unique_type unique (template_id, allocation_type)
);

alter table public.budget_templates enable row level security;
alter table public.budget_template_allocations enable row level security;

create policy budget_templates_select_authenticated on public.budget_templates
  for select to authenticated
  using (is_active);

create policy budget_template_allocations_select_authenticated on public.budget_template_allocations
  for select to authenticated
  using (exists (
    select 1 from public.budget_templates t
    where t.id = template_id and t.is_active
  ));

revoke all on public.budget_templates from anon;
revoke all on public.budget_template_allocations from anon;
grant select on public.budget_templates to authenticated;
grant select on public.budget_template_allocations to authenticated;
grant select, insert, update, delete on public.budget_templates to service_role;
grant select, insert, update, delete on public.budget_template_allocations to service_role;

insert into public.budget_templates (id, name, description, is_system_template, is_active)
values (
  '00000000-0000-0000-0000-000000000001',
  '50/15/5/30 Standard',
  'Essentials 50%, Investing 15%, Emergency savings 5%, Wants 30%.',
  true,
  true
);

insert into public.budget_template_allocations (template_id, allocation_type, percentage, sort_order)
values
  ('00000000-0000-0000-0000-000000000001', 'ESSENTIALS', 50.00, 1),
  ('00000000-0000-0000-0000-000000000001', 'INVESTING', 15.00, 2),
  ('00000000-0000-0000-0000-000000000001', 'EMERGENCY', 5.00, 3),
  ('00000000-0000-0000-0000-000000000001', 'WANTS', 30.00, 4);

-- ===========================================================================
-- budgets: one row per user-owned budget period (draft/active/completed/
-- archived). Matched to transactions by currency only, not by account -
-- a budget aggregates across every account in the workspace that shares
-- its currency (see the note above on RWF-only live actuals).
-- ===========================================================================

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  template_id uuid references public.budget_templates (id),
  name text not null check (length(trim(both from name)) > 0),
  currency char(3) not null check (currency = upper(currency)),
  period_start date not null,
  period_end date not null,
  income_amount_minor bigint not null check (income_amount_minor >= 0),
  normalized_monthly_income_minor bigint not null check (normalized_monthly_income_minor >= 0),
  normalized_annual_income_minor bigint not null check (normalized_annual_income_minor >= 0),
  income_frequency text not null
    check (income_frequency in ('weekly', 'biweekly', 'semimonthly', 'monthly', 'annual')),
  income_mode text not null default 'fixed' check (income_mode in ('fixed', 'variable')),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'completed', 'archived')),
  source_budget_id uuid references public.budgets (id),
  created_by uuid references auth.users (id),
  activated_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budgets_period_valid check (period_end > period_start),
  constraint budgets_active_requires_activated_at check (
    status <> 'active' or activated_at is not null
  ),
  constraint budgets_completed_requires_timestamps check (
    status <> 'completed' or (activated_at is not null and completed_at is not null)
  )
);

comment on table public.budgets is
  'A user-owned budget period. Matched against transactions by currency only (see this migration''s header) - accounts are not distinguished. status=draft budgets can be freely edited; status=active budgets are the ones a dashboard aggregates against and are held to the 100%% allocation-total invariant continuously (see validate_budget_activation/validate_budget_active_allocations_total below).';

-- At most one active budget per workspace+currency at any time. Overlapping
-- *periods* are not separately modeled in this first release - "one active
-- budget per currency" is a stricter, simpler rule than "no overlapping
-- active periods" and fully satisfies "prevent ambiguous overlapping active
-- budgets" without a range-exclusion constraint. Documented simplification.
create unique index idx_budgets_one_active_per_workspace_currency
  on public.budgets (workspace_id, currency)
  where status = 'active';

create index idx_budgets_workspace_status on public.budgets (workspace_id, status);
create index idx_budgets_workspace_currency on public.budgets (workspace_id, currency);

-- workspace_id+id unique target for budget_allocations' composite FK below,
-- mirroring accounts_workspace_id_id_unique from the Phase C migration.
alter table public.budgets
  add constraint budgets_workspace_id_id_unique unique (workspace_id, id);

create trigger set_budgets_updated_at
  before update on public.budgets
  for each row execute function public.set_updated_at();

alter table public.budgets enable row level security;

-- ===========================================================================
-- budget_allocations: the four allocation buckets for one budget.
-- Percentages must total exactly 100%% whenever the owning budget is
-- active - enforced continuously (both at activation time and on any
-- later edit to an active budget's allocations), never just at save time,
-- via the two trigger functions below. A 0.01 tolerance absorbs benign
-- numeric(5,2) rounding, not genuine under/over-allocation.
-- ===========================================================================

create table public.budget_allocations (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references public.budgets (id) on delete cascade,
  workspace_id uuid not null,
  allocation_type text not null
    check (allocation_type in ('ESSENTIALS', 'INVESTING', 'EMERGENCY', 'WANTS')),
  percentage numeric(5, 2) not null check (percentage >= 0 and percentage <= 100),
  target_amount_minor bigint not null check (target_amount_minor >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budget_allocations_unique_type unique (budget_id, allocation_type),
  -- Same-workspace guarantee at the database level, mirroring
  -- ingestion_connections_account_same_workspace from Phase C - a budget's
  -- allocations can never be pointed at another workspace's budget row.
  constraint budget_allocations_budget_same_workspace
    foreign key (workspace_id, budget_id)
    references public.budgets (workspace_id, id)
);

create index idx_budget_allocations_budget on public.budget_allocations (budget_id);

create trigger set_budget_allocations_updated_at
  before update on public.budget_allocations
  for each row execute function public.set_updated_at();

create or replace function public.validate_budget_active_allocations_total()
returns trigger
language plpgsql
as $$
declare
  target_budget_id uuid := coalesce(new.budget_id, old.budget_id);
  budget_status text;
  total_pct numeric;
begin
  select status into budget_status from public.budgets where id = target_budget_id;

  if budget_status = 'active' then
    select coalesce(sum(percentage), 0) into total_pct
    from public.budget_allocations
    where budget_id = target_budget_id;

    if abs(total_pct - 100.00) > 0.01 then
      raise exception
        'Active budget % allocation percentages must total 100%% (got %)',
        target_budget_id, total_pct
        using errcode = 'check_violation';
    end if;
  end if;

  return null;
end;
$$;

comment on function public.validate_budget_active_allocations_total is
  'Defense-in-depth: re-validates the 100%% total any time an active budget''s allocations are edited after activation (not just at activation time itself - see validate_budget_activation for that). Server-side application code is expected to validate first and present a clean error; this trigger is what makes the invariant actually unbreakable at the database level.';

create trigger validate_budget_allocations_total_on_change
  after insert or update or delete on public.budget_allocations
  for each row execute function public.validate_budget_active_allocations_total();

create or replace function public.validate_budget_activation()
returns trigger
language plpgsql
as $$
declare
  total_pct numeric;
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    select coalesce(sum(percentage), 0) into total_pct
    from public.budget_allocations
    where budget_id = new.id;

    if abs(total_pct - 100.00) > 0.01 then
      raise exception
        'Cannot activate budget %: allocation percentages total %, must total 100%%',
        new.id, total_pct
        using errcode = 'check_violation';
    end if;

    new.activated_at := coalesce(new.activated_at, now());
  end if;

  return new;
end;
$$;

comment on function public.validate_budget_activation is
  'Refuses to transition a budget to status=active unless its allocations already total exactly 100%% (0.01 tolerance for numeric(5,2) rounding). Server-side application code validates and blocks this earlier for a clean user-facing error; this is the database-level backstop.';

create trigger validate_budget_activation_before_write
  before insert or update on public.budgets
  for each row execute function public.validate_budget_activation();

alter table public.budget_allocations enable row level security;

-- ===========================================================================
-- budget_category_mappings: maps a transaction's free-text category
-- (transactions.category has no foreign-keyed taxonomy table - see
-- merchant_rules) to one of the four allocation types, per workspace.
-- Effective-dated so a later remapping never silently rewrites how an
-- already-closed budget period's aggregates were computed - historical
-- reports stay reproducible (see the master prompt's own requirement).
-- No default/seeded mappings: this repository has no record of which
-- category strings actually exist in a given workspace's production data
-- (merchant_rules ships empty; categories are assigned out-of-band), so
-- guessing a default set would be unfounded. Unmapped categories are
-- surfaced explicitly to the user instead (see D2 dashboard work).
-- ===========================================================================

create table public.budget_category_mappings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  category text not null check (length(trim(both from category)) > 0),
  allocation_type text not null
    check (allocation_type in ('ESSENTIALS', 'INVESTING', 'EMERGENCY', 'WANTS')),
  effective_from date not null default current_date,
  effective_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budget_category_mappings_valid_range check (
    effective_until is null or effective_until >= effective_from
  )
);

-- At most one currently-open-ended mapping per (workspace, category) - a
-- remap closes the old row (sets effective_until) and inserts a new one,
-- it never overwrites history in place.
create unique index idx_budget_category_mappings_open
  on public.budget_category_mappings (workspace_id, category)
  where effective_until is null;

create index idx_budget_category_mappings_workspace
  on public.budget_category_mappings (workspace_id, category);

create trigger set_budget_category_mappings_updated_at
  before update on public.budget_category_mappings
  for each row execute function public.set_updated_at();

alter table public.budget_category_mappings enable row level security;

-- ===========================================================================
-- financial_goals / goal_contributions
-- ===========================================================================

create table public.financial_goals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  goal_type text not null
    check (goal_type in ('emergency_fund', 'investing', 'planned_purchase', 'debt', 'general_savings')),
  name text not null check (length(trim(both from name)) > 0),
  description text,
  currency char(3) not null check (currency = upper(currency)),
  target_amount_minor bigint not null check (target_amount_minor > 0),
  -- Maintained exclusively by refresh_goal_current_amount() below, never
  -- written directly by application code - it is always the authoritative
  -- sum of this goal's own goal_contributions rows.
  current_amount_minor bigint not null default 0 check (current_amount_minor >= 0),
  target_date date,
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  created_by uuid references auth.users (id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_goals_completed_requires_timestamp check (
    (status = 'completed') = (completed_at is not null)
  )
);

create index idx_financial_goals_workspace_status
  on public.financial_goals (workspace_id, status);

alter table public.financial_goals
  add constraint financial_goals_workspace_id_id_unique unique (workspace_id, id);

create trigger set_financial_goals_updated_at
  before update on public.financial_goals
  for each row execute function public.set_updated_at();

alter table public.financial_goals enable row level security;

create table public.goal_contributions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.financial_goals (id) on delete cascade,
  workspace_id uuid not null,
  -- A transaction may fund at most one goal (see the unique index below) -
  -- prevents the same MoMo transaction from being double-counted across
  -- two different goals. NULL for a manually-entered contribution with no
  -- linked transaction.
  transaction_id uuid references public.transactions (id),
  amount_minor bigint not null check (amount_minor > 0),
  contribution_date date not null default current_date,
  source text not null default 'manual' check (source in ('manual', 'transaction_link')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  constraint goal_contributions_goal_same_workspace
    foreign key (workspace_id, goal_id)
    references public.financial_goals (workspace_id, id)
);

comment on table public.goal_contributions is
  'Append-only (no updated_at/no update policy - a wrong contribution is deleted and re-entered, never edited in place, preserving an honest history). transaction_id''s unique index is what prevents a single ingested transaction from ever being linked to more than one goal.';

create unique index idx_goal_contributions_transaction_unique
  on public.goal_contributions (transaction_id)
  where transaction_id is not null;

create index idx_goal_contributions_goal on public.goal_contributions (goal_id);

create or replace function public.refresh_goal_current_amount()
returns trigger
language plpgsql
as $$
declare
  affected_goal_id uuid := coalesce(new.goal_id, old.goal_id);
begin
  update public.financial_goals
  set current_amount_minor = (
    select coalesce(sum(amount_minor), 0)
    from public.goal_contributions
    where goal_id = affected_goal_id
  )
  where id = affected_goal_id;

  return null;
end;
$$;

comment on function public.refresh_goal_current_amount is
  'Keeps financial_goals.current_amount_minor as an always-fresh recomputed sum of its own goal_contributions, rather than an incrementally-adjusted counter that could drift.';

create trigger refresh_goal_current_amount_on_change
  after insert or delete on public.goal_contributions
  for each row execute function public.refresh_goal_current_amount();

alter table public.goal_contributions enable row level security;

-- ===========================================================================
-- RLS policies. Uniform pattern across every table above: any active
-- workspace member may read; only the workspace owner may write - the
-- same boundary Phase C already established for accounts/
-- ingestion_connections (this project has no broader write-role model
-- yet). No delete policy on budgets/budget_allocations/
-- budget_category_mappings/financial_goals for authenticated - archived
-- (never deleted), matching the accounts/ingestion_connections pattern.
-- goal_contributions gets an explicit owner-only delete policy instead,
-- since removing a mis-entered manual contribution is a named workflow
-- (see the master prompt's goal requirements) with no other correction
-- path (contributions are otherwise append-only, never updated).
-- ===========================================================================

create policy budgets_select_member on public.budgets
  for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy budgets_write_owner on public.budgets
  for insert to authenticated
  with check (public.is_workspace_member(workspace_id, 'owner'));
create policy budgets_update_owner on public.budgets
  for update to authenticated
  using (public.is_workspace_member(workspace_id, 'owner'))
  with check (public.is_workspace_member(workspace_id, 'owner'));

create policy budget_allocations_select_member on public.budget_allocations
  for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy budget_allocations_write_owner on public.budget_allocations
  for insert to authenticated
  with check (public.is_workspace_member(workspace_id, 'owner'));
create policy budget_allocations_update_owner on public.budget_allocations
  for update to authenticated
  using (public.is_workspace_member(workspace_id, 'owner'))
  with check (public.is_workspace_member(workspace_id, 'owner'));
create policy budget_allocations_delete_owner on public.budget_allocations
  for delete to authenticated
  using (public.is_workspace_member(workspace_id, 'owner'));

create policy budget_category_mappings_select_member on public.budget_category_mappings
  for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy budget_category_mappings_write_owner on public.budget_category_mappings
  for insert to authenticated
  with check (public.is_workspace_member(workspace_id, 'owner'));
create policy budget_category_mappings_update_owner on public.budget_category_mappings
  for update to authenticated
  using (public.is_workspace_member(workspace_id, 'owner'))
  with check (public.is_workspace_member(workspace_id, 'owner'));

create policy financial_goals_select_member on public.financial_goals
  for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy financial_goals_write_owner on public.financial_goals
  for insert to authenticated
  with check (public.is_workspace_member(workspace_id, 'owner'));
create policy financial_goals_update_owner on public.financial_goals
  for update to authenticated
  using (public.is_workspace_member(workspace_id, 'owner'))
  with check (public.is_workspace_member(workspace_id, 'owner'));

create policy goal_contributions_select_member on public.goal_contributions
  for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy goal_contributions_write_owner on public.goal_contributions
  for insert to authenticated
  with check (public.is_workspace_member(workspace_id, 'owner'));
create policy goal_contributions_delete_owner on public.goal_contributions
  for delete to authenticated
  using (public.is_workspace_member(workspace_id, 'owner'));

revoke all on public.budgets from anon;
revoke all on public.budget_allocations from anon;
revoke all on public.budget_category_mappings from anon;
revoke all on public.financial_goals from anon;
revoke all on public.goal_contributions from anon;

grant select, insert, update on public.budgets to authenticated;
grant select, insert, update, delete on public.budget_allocations to authenticated;
grant select, insert, update on public.budget_category_mappings to authenticated;
grant select, insert, update on public.financial_goals to authenticated;
grant select, insert, delete on public.goal_contributions to authenticated;

grant select, insert, update, delete on public.budgets to service_role;
grant select, insert, update, delete on public.budget_allocations to service_role;
grant select, insert, update, delete on public.budget_category_mappings to service_role;
grant select, insert, update, delete on public.financial_goals to service_role;
grant select, insert, update, delete on public.goal_contributions to service_role;
