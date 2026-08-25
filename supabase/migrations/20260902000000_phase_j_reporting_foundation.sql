-- Phase J: reporting foundation - persistence schema for the Scheduled
-- Financial Reporting & Document Generation engine (master-prompt Phase B:
-- domain model / schema / RLS / migration).
--
-- Purely additive, following the exact conventions established in Phase B
-- (identity/tenancy) and Phase D (budgets): uuid pk default
-- gen_random_uuid(), timestamptz + set_updated_at() trigger, workspace_id
-- uuid not null references workspaces(id), explicit check() enums, RLS
-- built on is_workspace_member(), anon fully revoked, service_role granted
-- full CRUD.
--
-- Three tables, matching the architecture-assessment decision to omit a
-- fourth (report_artifacts/PDF) until document generation is actually
-- built - see supabase/migrations/README.md's own "purely additive, no
-- premature scaffolding" precedent (Phase D's budget_templates seeding
-- only what's used today, not a speculative future taxonomy):
--
--   report_preferences - one row per (workspace_id, user_id): a user's own
--     delivery preference *within* a workspace, not a workspace-wide
--     setting, since an organization workspace's members may each want a
--     different delivery time/email (see is_workspace_member's four-role
--     model in Phase B/organization_workspaces - report_preferences does
--     not lean on role at all, every active member manages only their own
--     row).
--
--   report_runs - the persisted, immutable structured JSON snapshot. This
--     is the reporting engine's source of truth (see the master prompt's
--     "financial facts before AI" principle) - PDF/email are renderers of
--     report_payload, never independent calculators. Idempotency is a
--     database-level unique constraint on
--     (workspace_id, user_id, report_type, period_start), not an
--     application-level check - two scheduler ticks or two concurrent
--     workers for the same logical period resolve to the same row via
--     `insert ... on conflict (...) do nothing`.
--     Only service_role may insert/update; authenticated may only ever
--     read their own rows. There is deliberately no `report_artifacts`
--     foreign key target yet.
--
--   report_deliveries - delivery *attempts* against an already-generated
--     report_run, deliberately separated from generation (master prompt
--     §8/§9/§37: a report can exist successfully even when email delivery
--     fails, and the two must never share one ambiguous boolean/status).
--     Idempotent the same way, via a unique constraint on
--     (report_run_id, channel, destination).
--
-- report_type is currently constrained to 'daily' only - weekly/monthly/
-- organization reporting (master prompt §46/§47) are explicitly deferred,
-- but the column exists now so a later migration only needs to widen the
-- check constraint, never reshape the tables.

-- ===========================================================================
-- report_preferences
-- ===========================================================================

create table public.report_preferences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  timezone text not null default 'Africa/Kigali',
  daily_report_enabled boolean not null default false,
  -- Generation runs shortly after local midnight and covers the complete
  -- previous calendar day (period_start/period_end = the full local day),
  -- not a literal 23:00 cutoff - a 23:00-generated "daily" report would
  -- exclude its own final hour. See the architecture assessment's
  -- reporting-period-semantics decision. This column remains user-
  -- configurable so a 23:00-style cutoff also remains representable.
  generation_time time not null default '00:05:00',
  delivery_time time not null default '07:00:00',
  email_enabled boolean not null default false,
  delivery_email text,
  include_ai_analysis boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_preferences_unique_recipient unique (workspace_id, user_id),
  constraint report_preferences_email_required_if_enabled check (
    not email_enabled or delivery_email is not null
  )
);

comment on table public.report_preferences is
  'One row per (workspace_id, user_id): a user''s own daily-report generation/delivery preferences within a workspace. Opt-in by default (daily_report_enabled/email_enabled both false) - this feature emails financial information, so existing users are never silently enrolled. See master prompt §73.';

create index idx_report_preferences_due_generation
  on public.report_preferences (workspace_id, user_id)
  where daily_report_enabled;

create trigger set_report_preferences_updated_at
  before update on public.report_preferences
  for each row execute function public.set_updated_at();

alter table public.report_preferences enable row level security;

-- ===========================================================================
-- report_runs
-- ===========================================================================

create table public.report_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  report_type text not null default 'daily' check (report_type in ('daily')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  timezone text not null,
  status text not null default 'scheduled'
    check (status in (
      'scheduled', 'generating', 'generated', 'generation_failed',
      'delivery_pending', 'delivering', 'delivered', 'delivery_failed'
    )),
  scheduled_for timestamptz not null,
  generation_started_at timestamptz,
  generated_at timestamptz,
  -- The authoritative structured snapshot (master prompt §5/§6/§8) - PDF
  -- and email render this, they never recompute financial facts.
  report_payload jsonb,
  -- Optional AI enrichment, persisted separately from report_payload so an
  -- AI failure/timeout never blocks or mutates the deterministic snapshot
  -- (master prompt §21/§37).
  ai_payload jsonb,
  generation_version integer not null default 1,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_runs_period_valid check (period_end > period_start),
  -- Idempotency: exactly one logical report per recipient per period,
  -- enforced at the database level (master prompt §10), not just in
  -- application code. `insert ... on conflict (...) do nothing` is how the
  -- generation job relies on this.
  constraint report_runs_unique_period unique (workspace_id, user_id, report_type, period_start)
);

comment on table public.report_runs is
  'Persisted, immutable-once-generated financial report snapshots (master prompt §32: a later merchant-rule/category/budget change never rewrites a historical report). Only service_role writes; authenticated users may only read their own rows. report_runs_unique_period is the sole idempotency guarantee - a retried or duplicate scheduler tick for the same period resolves to the same row.';

create index idx_report_runs_workspace_user on public.report_runs (workspace_id, user_id);
create index idx_report_runs_status_scheduled_for on public.report_runs (status, scheduled_for);

create trigger set_report_runs_updated_at
  before update on public.report_runs
  for each row execute function public.set_updated_at();

alter table public.report_runs enable row level security;

-- ===========================================================================
-- report_deliveries
-- ===========================================================================

create table public.report_deliveries (
  id uuid primary key default gen_random_uuid(),
  report_run_id uuid not null references public.report_runs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  channel text not null default 'email' check (channel in ('email')),
  destination text not null,
  status text not null default 'pending'
    check (status in ('pending', 'delivering', 'delivered', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  provider_message_id text,
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Idempotency for delivery specifically (master prompt §10): a retried
  -- delivery attempt for the same report/channel/destination never creates
  -- a second row; application code additionally guards on
  -- `status <> 'delivered'` before attempting a send.
  constraint report_deliveries_unique_send unique (report_run_id, channel, destination)
);

comment on table public.report_deliveries is
  'Delivery attempts against an already-generated report_runs row, deliberately separate from generation (master prompt §8/§9/§37) - a report can be generated successfully even when its delivery fails. Only service_role writes; authenticated users may only read their own rows.';

create index idx_report_deliveries_report_run on public.report_deliveries (report_run_id);
create index idx_report_deliveries_status on public.report_deliveries (status);

create trigger set_report_deliveries_updated_at
  before update on public.report_deliveries
  for each row execute function public.set_updated_at();

alter table public.report_deliveries enable row level security;

-- ===========================================================================
-- RLS policies. Uniform read boundary: a user may only read rows that are
-- both their own (user_id = auth.uid()) and within a workspace they are
-- still an active member of - mirroring accounts/budgets, but note this is
-- deliberately *stricter* than "any active member may read": a report is a
-- personal delivery artifact (master prompt §14/§59 - a report addressed
-- to one recipient must not become workspace-wide readable), not a shared
-- ledger row like a transaction. report_preferences additionally allows
-- the owning user to insert/update their own row directly (self-service
-- settings, per master prompt §29/§59); report_runs/report_deliveries have
-- no authenticated write policy at all - only service_role (the scheduler/
-- generation job) ever writes them, per master prompt §14's explicit-
-- scoping requirement for service-role operations.
-- ===========================================================================

create policy report_preferences_select_own on public.report_preferences
  for select to authenticated
  using (user_id = auth.uid() and public.is_workspace_member(workspace_id));
create policy report_preferences_insert_own on public.report_preferences
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_workspace_member(workspace_id));
create policy report_preferences_update_own on public.report_preferences
  for update to authenticated
  using (user_id = auth.uid() and public.is_workspace_member(workspace_id))
  with check (user_id = auth.uid() and public.is_workspace_member(workspace_id));

create policy report_runs_select_own on public.report_runs
  for select to authenticated
  using (user_id = auth.uid() and public.is_workspace_member(workspace_id));

create policy report_deliveries_select_own on public.report_deliveries
  for select to authenticated
  using (user_id = auth.uid());

revoke all on public.report_preferences from anon;
revoke all on public.report_runs from anon;
revoke all on public.report_deliveries from anon;

grant select, insert, update on public.report_preferences to authenticated;
grant select on public.report_runs to authenticated;
grant select on public.report_deliveries to authenticated;

grant select, insert, update, delete on public.report_preferences to service_role;
grant select, insert, update, delete on public.report_runs to service_role;
grant select, insert, update, delete on public.report_deliveries to service_role;
