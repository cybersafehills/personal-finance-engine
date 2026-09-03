-- Integrations Phase 1, PR 6: scheduled exports + operational-health
-- coverage for the import/export subsystem.
--
-- export_schedules is a data-model + execution surface, not a cron DSL:
-- a schedule stores a coarse cadence and an explicit next_run_at, and the
-- existing run-export-jobs cron materialises due schedules into
-- export_jobs and advances next_run_at. No new scheduler is introduced.
-- The whole surface is gated behind INTEGRATIONS_SYNC_ENABLED (default
-- off) in the web layer.

create table public.export_schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  template_id uuid references public.export_templates (id) on delete set null,
  created_by uuid references auth.users (id),
  name text not null check (length(trim(both from name)) > 0),
  -- resolved export configuration (same shape as export_jobs.config)
  config jsonb not null default '{}'::jsonb,
  cadence text not null check (cadence in ('daily', 'weekly', 'monthly')),
  -- 0-23 local hour; weekly uses day_of_week (0=Sun); monthly uses day_of_month (1-28)
  hour integer not null default 6 check (hour between 0 and 23),
  day_of_week integer check (day_of_week between 0 and 6),
  day_of_month integer check (day_of_month between 1 and 28),
  timezone text not null default 'UTC',
  enabled boolean not null default true,
  last_run_at timestamptz,
  next_run_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.export_schedules is
  'A recurring export. run-export-jobs materialises a schedule whose next_run_at has passed into one export_jobs row and advances next_run_at. Coarse cadence only; no cron expression. Gated by INTEGRATIONS_SYNC_ENABLED in the web layer.';

create index idx_export_schedules_workspace
  on public.export_schedules (workspace_id);
create index idx_export_schedules_due
  on public.export_schedules (next_run_at)
  where enabled;

create trigger set_export_schedules_updated_at
  before update on public.export_schedules
  for each row execute function public.set_updated_at();

alter table public.export_schedules enable row level security;

create policy export_schedules_select_member on public.export_schedules
  for select to authenticated
  using (public.has_space_capability(workspace_id, 'integration.view'));

revoke all on public.export_schedules from anon;
grant select on public.export_schedules to authenticated;
grant select, insert, update, delete on public.export_schedules to service_role;

-- ---------------------------------------------------------------------------
-- Extend the operator health snapshot with import/export aggregates.
-- Forward-only replace; adds one top-level 'integrations' key, no
-- identifiers / payloads / financial values (same contract as before).
-- ---------------------------------------------------------------------------

-- Forward declaration so the wrapper below (LANGUAGE sql, body-checked at
-- CREATE time) resolves; the real body is installed further down.
create or replace function public.get_operational_health_snapshot_core(
  p_window_minutes integer
)
returns jsonb language sql immutable as $$ select '{}'::jsonb $$;

create or replace function public.get_operational_health_snapshot(
  p_window_minutes integer default 60
)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with bounds as (
    select
      greatest(5, least(coalesce(p_window_minutes, 60), 10080)) as window_minutes,
      statement_timestamp() as captured_at
  ), windowed as (
    select
      window_minutes,
      captured_at,
      captured_at - make_interval(mins => window_minutes) as window_start
    from bounds
  )
  select public.get_operational_health_snapshot_core(w.window_minutes)
    || jsonb_build_object(
    'integrations', jsonb_build_object(
      'import_batches_created', (
        select count(*) from public.import_batches b
        where b.created_at >= w.window_start
      ),
      'import_batches_failed', (
        select count(*) from public.import_batches b
        where b.updated_at >= w.window_start and b.status = 'failed'
      ),
      'import_review_backlog', (
        select count(*) from public.import_batches b
        where b.status = 'validated'
      ),
      'oldest_import_review_age_seconds', (
        select coalesce(
          extract(epoch from (w.captured_at - min(b.created_at)))::bigint, 0)
        from public.import_batches b
        where b.status = 'validated'
      ),
      'export_jobs_created', (
        select count(*) from public.export_jobs j
        where j.requested_at >= w.window_start
      ),
      'export_jobs_failed', (
        select count(*) from public.export_jobs j
        where coalesce(j.completed_at, j.requested_at) >= w.window_start
          and j.status = 'failed'
      ),
      'export_jobs_stuck', (
        select count(*) from public.export_jobs j
        where j.status = 'processing'
          and coalesce(j.started_at, j.requested_at) < w.captured_at - interval '15 minutes'
      ),
      'export_schedules_enabled', (
        select count(*) from public.export_schedules s where s.enabled
      ),
      'export_schedules_overdue', (
        select count(*) from public.export_schedules s
        where s.enabled and s.next_run_at < w.captured_at - interval '30 minutes'
      )
    )
  )
  from windowed w;
$$;

-- The pre-existing body, extracted verbatim so the replace above stays
-- readable. Same service-role-only contract.
create or replace function public.get_operational_health_snapshot_core(
  p_window_minutes integer
)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with bounds as (
    select
      greatest(5, least(coalesce(p_window_minutes, 60), 10080)) as window_minutes,
      statement_timestamp() as captured_at
  ), windowed as (
    select
      window_minutes,
      captured_at,
      captured_at - make_interval(mins => window_minutes) as window_start
    from bounds
  )
  select jsonb_build_object(
    'captured_at', w.captured_at,
    'window_minutes', w.window_minutes,
    'ingestion', jsonb_build_object(
      'received', (select count(*) from public.momo_messages m where m.server_received_at >= w.window_start),
      'processed', (select count(*) from public.momo_messages m where m.server_received_at >= w.window_start and m.processing_status = 'processed'),
      'needs_review', (select count(*) from public.momo_messages m where m.server_received_at >= w.window_start and m.processing_status = 'needs_review'),
      'failed', (select count(*) from public.momo_messages m where m.server_received_at >= w.window_start and m.processing_status = 'failed'),
      'stale_processing_backlog', (select count(*) from public.momo_messages m where m.processing_status in ('pending', 'processing') and m.server_received_at < w.captured_at - interval '5 minutes'),
      'raw_event_pending_backlog', (select count(*) from public.raw_financial_events r where r.parse_status = 'pending' and r.received_at < w.captured_at - interval '5 minutes')
    ),
    'duplicates', jsonb_build_object(
      'transactions_created', (select count(*) from public.transactions t where t.created_at >= w.window_start),
      'possible_duplicates_created', (select count(*) from public.transactions t where t.created_at >= w.window_start and t.dedupe_state = 'possible_duplicate'),
      'merged_created', (select count(*) from public.transactions t where t.created_at >= w.window_start and t.dedupe_state = 'merged'),
      'review_backlog', (select count(*) from public.transactions t where t.dedupe_state = 'possible_duplicate'),
      'oldest_review_age_seconds', (select coalesce(extract(epoch from (w.captured_at - min(t.created_at)))::bigint, 0) from public.transactions t where t.dedupe_state = 'possible_duplicate')
    ),
    'jobs', jsonb_build_object(
      'report_runs_due', (select count(*) from public.report_runs r where r.scheduled_for >= w.window_start and r.scheduled_for <= w.captured_at),
      'report_runs_failed', (select count(*) from public.report_runs r where r.scheduled_for >= w.window_start and r.status in ('generation_failed', 'delivery_failed')),
      'report_runs_overdue', (select count(*) from public.report_runs r where r.status in ('scheduled', 'generating') and r.scheduled_for < w.captured_at - interval '15 minutes'),
      'report_deliveries_attempted', (select count(*) from public.report_deliveries d where coalesce(d.last_attempt_at, d.created_at) >= w.window_start),
      'report_deliveries_failed', (select count(*) from public.report_deliveries d where coalesce(d.last_attempt_at, d.created_at) >= w.window_start and d.status = 'failed')
    ),
    'email', jsonb_build_object(
      'attempted', (select count(*) from public.email_send_log e where e.created_at >= w.window_start),
      'sent', (select count(*) from public.email_send_log e where e.created_at >= w.window_start and e.outcome = 'sent'),
      'skipped', (select count(*) from public.email_send_log e where e.created_at >= w.window_start and e.outcome = 'skipped'),
      'failed', (select count(*) from public.email_send_log e where e.created_at >= w.window_start and e.outcome = 'failed'),
      'pending_outbox', (select count(*) from public.notifications n where n.channel = 'email' and n.delivered_at is null),
      'oldest_pending_age_seconds', (select coalesce(extract(epoch from (w.captured_at - min(n.created_at)))::bigint, 0) from public.notifications n where n.channel = 'email' and n.delivered_at is null)
    ),
    'reconciliation', jsonb_build_object(
      'created', (select count(*) from public.payment_reconciliations r where r.created_at >= w.window_start),
      'linked', (select count(*) from public.payment_reconciliations r where r.created_at >= w.window_start and r.status = 'linked'),
      'conflicts', (select count(*) from public.payment_reconciliations r where r.created_at >= w.window_start and r.status = 'conflict'),
      'rejected', (select count(*) from public.payment_reconciliations r where r.created_at >= w.window_start and r.status = 'rejected'),
      'review_backlog', (select count(*) from public.payment_intents i where i.state = 'requires_reconciliation'),
      'oldest_review_age_seconds', (select coalesce(extract(epoch from (w.captured_at - min(i.updated_at)))::bigint, 0) from public.payment_intents i where i.state = 'requires_reconciliation')
    )
  )
  from windowed w;
$$;

comment on function public.get_operational_health_snapshot_core(integer) is
  'Internal: the pre-Integrations body of get_operational_health_snapshot, split out so the wrapper can append the integrations aggregates. Service-role-only.';

comment on function public.get_operational_health_snapshot(integer) is
  'Service-only aggregate health snapshot: ingestion, duplicate review, report jobs, email, payment reconciliation, and Integrations import/export. No tenant/customer identifiers, payloads, credentials, destinations, or financial values.';

revoke all on function public.get_operational_health_snapshot_core(integer) from public;
grant execute on function public.get_operational_health_snapshot_core(integer) to service_role;
revoke all on function public.get_operational_health_snapshot(integer) from public;
grant execute on function public.get_operational_health_snapshot(integer) to service_role;
