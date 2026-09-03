-- Integrations Phase 2, P2-PR5: apply one reviewed sync conflict to the
-- ledger, and widen the operator health snapshot with sync-run / conflict
-- aggregates.
--
-- Conflicts are detected by the connected-workbook sync (inbound diff) and
-- never auto-resolved. Keep-OneLedger / Ignore are plain status updates
-- handled in the web layer; only "accept external" mutates the ledger, and
-- it does so here through a bounded, capability-gated, audited RPC that can
-- only touch two whitelisted transaction fields.

-- ===========================================================================
-- apply_integration_conflict(p_conflict_id) -> { applied, field }
-- ===========================================================================
create or replace function public.apply_integration_conflict(p_conflict_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_conflict public.integration_conflicts;
  v_txn public.transactions;
  v_external text;
  v_old jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_conflict from public.integration_conflicts where id = p_conflict_id;
  if not found then
    raise exception 'Conflict not found.';
  end if;

  if not public.has_space_capability(v_conflict.workspace_id, 'integration.conflict_resolve') then
    raise exception 'You do not have permission to resolve conflicts in this Space.';
  end if;
  if v_conflict.status <> 'open' then
    raise exception 'This conflict has already been resolved.';
  end if;
  if v_conflict.ref_type <> 'transaction' or v_conflict.ref_id is null then
    raise exception 'This conflict cannot be applied automatically.';
  end if;
  if v_conflict.field is null or v_conflict.field not in ('category', 'description') then
    raise exception 'Only category and description conflicts can be applied.';
  end if;

  select * into v_txn from public.transactions
  where id = v_conflict.ref_id::uuid and workspace_id = v_conflict.workspace_id;
  if not found then
    raise exception 'The referenced transaction no longer exists in this Space.';
  end if;

  v_external := nullif(btrim(coalesce(v_conflict.external_value #>> '{}', '')), '');

  if v_conflict.field = 'category' then
    v_old := jsonb_build_object('category', v_txn.category);
    update public.transactions
      set category = v_external, category_source = 'manual'
      where id = v_txn.id;
  else
    v_old := jsonb_build_object('counterparty_name', v_txn.counterparty_name);
    update public.transactions
      set counterparty_name = v_external
      where id = v_txn.id;
  end if;

  update public.integration_conflicts
    set status = 'accepted_external', resolved_by = v_uid, resolved_at = now()
    where id = p_conflict_id;

  perform public.record_space_audit_event(
    v_conflict.workspace_id, 'integration.conflict_resolved',
    'integration_conflict', p_conflict_id, v_old,
    jsonb_build_object('field', v_conflict.field, 'value', v_external));

  return jsonb_build_object('applied', true, 'field', v_conflict.field);
end;
$$;

comment on function public.apply_integration_conflict is
  'Applies one reviewed sync conflict to the ledger: sets a whitelisted transaction field (category / description) to the external value, marks the conflict accepted_external, and audits integration.conflict_resolved. integration.conflict_resolve-gated.';

revoke all on function public.apply_integration_conflict(uuid) from public;
grant execute on function public.apply_integration_conflict(uuid) to authenticated, service_role;

-- ===========================================================================
-- Widen the operator health snapshot's `integrations` block with sync-run
-- and conflict aggregates. Forward-only replace of the wrapper only
-- (get_operational_health_snapshot_core is unchanged). Still identifier-
-- free / service-role only.
-- ===========================================================================
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
      )
    )
  )
  from windowed w;
$$;

comment on function public.get_operational_health_snapshot(integer) is
  'Service-only aggregate health snapshot: ingestion, duplicate review, report jobs, email, payment reconciliation, and Integrations import/export/sync/conflicts. No tenant/customer identifiers, payloads, credentials, destinations, or financial values.';

revoke all on function public.get_operational_health_snapshot(integer) from public;
grant execute on function public.get_operational_health_snapshot(integer) to service_role;
