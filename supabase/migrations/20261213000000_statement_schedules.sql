-- Financial Documents Engine - Scheduled Statements (master prompt section
-- 30). "Generate last month's statement on day N of every month." The
-- statement lands in /reports/statements history ("save to OneLedger");
-- email/notification delivery is a later step.
--
-- Unlike `statements` (immutable, service-role-written), a schedule is a
-- plain config row - authenticated members create / edit / delete their
-- own, like report_preferences. The cron tick (run-statement-schedules,
-- NOT yet scheduled) enqueues a status='generating' stub for each due
-- schedule; the existing statement-jobs worker finalizes it.

create table public.statement_schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,

  statement_type text not null default 'standard'
    check (statement_type in ('standard', 'detailed')),
  -- financial_sources ids; empty = every account in the workspace. Verified
  -- against `statements`/`financial_sources` RLS when the schedule is saved.
  account_ids uuid[] not null default '{}'::uuid[],
  filters jsonb not null default '{}'::jsonb,

  -- Monthly cadence only for now. Capped at 28 so every month has the day.
  day_of_month integer not null default 1
    check (day_of_month between 1 and 28),
  timezone text not null,

  enabled boolean not null default true,
  last_run_at timestamptz,
  next_run_at timestamptz not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.statement_schedules is
  'A recurring "generate last month''s statement on day N" rule. Config row: authenticated workspace members (>= member) manage their own. The run-statement-schedules cron enqueues a statements stub per due schedule for the statement-jobs worker to finalize.';

create index idx_statement_schedules_workspace_created
  on public.statement_schedules (workspace_id, created_at desc);
create index idx_statement_schedules_due
  on public.statement_schedules (next_run_at)
  where enabled;

create trigger set_statement_schedules_updated_at
  before update on public.statement_schedules
  for each row execute function public.set_updated_at();

alter table public.statement_schedules enable row level security;

revoke all on public.statement_schedules from anon, authenticated;
grant select, insert, update, delete on public.statement_schedules to authenticated;
grant select, insert, update, delete on public.statement_schedules to service_role;

create policy statement_schedules_select_member on public.statement_schedules
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy statement_schedules_insert_member on public.statement_schedules
  for insert to authenticated
  with check (
    public.is_workspace_member(workspace_id, 'member')
    and created_by = auth.uid()
  );

create policy statement_schedules_update_member on public.statement_schedules
  for update to authenticated
  using (public.is_workspace_member(workspace_id, 'member'))
  with check (public.is_workspace_member(workspace_id, 'member'));

create policy statement_schedules_delete_member on public.statement_schedules
  for delete to authenticated
  using (public.is_workspace_member(workspace_id, 'member'));
