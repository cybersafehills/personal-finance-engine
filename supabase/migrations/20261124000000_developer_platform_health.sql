-- Integrations Phase 4, P4-PR7: widen the operator health snapshot's
-- `integrations` block with developer-platform aggregates (API request
-- volume, active key count, webhook delivery failures, failing
-- subscriptions). Forward-only replace of the wrapper only
-- (get_operational_health_snapshot_core is unchanged). Still
-- identifier-free / service-role only - no tenant ids, no key material,
-- no endpoint URLs, no financial values.

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
        select count(*) from public.import_batches b where b.created_at >= w.window_start
      ),
      'import_batches_failed', (
        select count(*) from public.import_batches b
        where b.updated_at >= w.window_start and b.status = 'failed'
      ),
      'import_review_backlog', (
        select count(*) from public.import_batches b where b.status = 'validated'
      ),
      'oldest_import_review_age_seconds', (
        select coalesce(extract(epoch from (w.captured_at - min(b.created_at)))::bigint, 0)
        from public.import_batches b where b.status = 'validated'
      ),
      'export_jobs_created', (
        select count(*) from public.export_jobs j where j.requested_at >= w.window_start
      ),
      'export_jobs_failed', (
        select count(*) from public.export_jobs j
        where coalesce(j.completed_at, j.requested_at) >= w.window_start and j.status = 'failed'
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
      ),
      'sync_runs_failed', (
        select count(*) from public.integration_sync_runs r
        where coalesce(r.finished_at, r.created_at) >= w.window_start and r.status = 'failed'
      ),
      'sync_runs_stuck', (
        select count(*) from public.integration_sync_runs r
        where r.status = 'running'
          and coalesce(r.started_at, r.created_at) < w.captured_at - interval '15 minutes'
      ),
      'open_conflicts', (
        select count(*) from public.integration_conflicts c where c.status = 'open'
      ),
      'oldest_open_conflict_age_seconds', (
        select coalesce(extract(epoch from (w.captured_at - min(c.created_at)))::bigint, 0)
        from public.integration_conflicts c where c.status = 'open'
      ),
      'destinations_needing_auth', (
        select count(*) from public.integration_destinations d where d.status = 'needs_auth'
      ),
      'accountant_packages_created', (
        select count(*) from public.accountant_packages p
        where p.requested_at >= w.window_start
      ),
      'accountant_packages_failed', (
        select count(*) from public.accountant_packages p
        where coalesce(p.completed_at, p.requested_at) >= w.window_start
          and p.status = 'failed'
      ),
      'oldest_pending_accountant_package_age_seconds', (
        select coalesce(extract(epoch from (w.captured_at - min(p.requested_at)))::bigint, 0)
        from public.accountant_packages p where p.status in ('queued', 'building')
      ),
      'ledger_syncs_failed', (
        select count(*) from public.integration_sync_runs r
        where r.connected_ledger_id is not null
          and coalesce(r.finished_at, r.created_at) >= w.window_start
          and r.status = 'failed'
      ),
      'ledgers_needing_auth', (
        select count(*) from public.connected_ledgers l where l.status = 'needs_auth'
      ),
      'api_requests_last_hour', (
        select count(*) from public.api_request_log a where a.created_at >= w.window_start
      ),
      'api_keys_active', (
        select count(*) from public.api_keys k
        where k.status = 'active'
          and (k.expires_at is null or k.expires_at > w.captured_at)
      ),
      'webhook_deliveries_failed', (
        select count(*) from public.webhook_deliveries d
        where coalesce(d.delivered_at, d.created_at) >= w.window_start
          and d.status = 'failed'
      ),
      'webhook_subscriptions_failing', (
        select count(*) from public.webhook_subscriptions s where s.status = 'failing'
      )
    )
  )
  from windowed w;
$$;

comment on function public.get_operational_health_snapshot(integer) is
  'Service-only aggregate health snapshot: ingestion, duplicate review, report jobs, email, payment reconciliation, and Integrations import/export/sync/conflicts/accountant-packages/ledgers/developer-platform. No tenant/customer identifiers, payloads, credentials, key material, endpoint URLs, or financial values.';

revoke all on function public.get_operational_health_snapshot(integer) from public;
grant execute on function public.get_operational_health_snapshot(integer) to service_role;
