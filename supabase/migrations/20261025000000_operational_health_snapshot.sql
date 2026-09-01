-- Roadmap observability phase: aggregate operational-health snapshot.
--
-- This intentionally reads the existing evidence/queue tables rather than
-- creating another event or logging product. It returns counts, rates, and
-- queue ages only: no tenant IDs, user IDs, provider references, payloads,
-- credentials, destinations, or financial values. The RPC is service-role
-- only and is exposed by a separately secret-gated operator endpoint.

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
  select jsonb_build_object(
    'captured_at', w.captured_at,
    'window_minutes', w.window_minutes,
    'ingestion', jsonb_build_object(
      'received', (
        select count(*) from public.momo_messages m
        where m.server_received_at >= w.window_start
      ),
      'processed', (
        select count(*) from public.momo_messages m
        where m.server_received_at >= w.window_start
          and m.processing_status = 'processed'
      ),
      'needs_review', (
        select count(*) from public.momo_messages m
        where m.server_received_at >= w.window_start
          and m.processing_status = 'needs_review'
      ),
      'failed', (
        select count(*) from public.momo_messages m
        where m.server_received_at >= w.window_start
          and m.processing_status = 'failed'
      ),
      'stale_processing_backlog', (
        select count(*) from public.momo_messages m
        where m.processing_status in ('pending', 'processing')
          and m.server_received_at < w.captured_at - interval '5 minutes'
      ),
      'raw_event_pending_backlog', (
        select count(*) from public.raw_financial_events r
        where r.parse_status = 'pending'
          and r.received_at < w.captured_at - interval '5 minutes'
      )
    ),
    'duplicates', jsonb_build_object(
      'transactions_created', (
        select count(*) from public.transactions t
        where t.created_at >= w.window_start
      ),
      'possible_duplicates_created', (
        select count(*) from public.transactions t
        where t.created_at >= w.window_start
          and t.dedupe_state = 'possible_duplicate'
      ),
      'merged_created', (
        select count(*) from public.transactions t
        where t.created_at >= w.window_start
          and t.dedupe_state = 'merged'
      ),
      'review_backlog', (
        select count(*) from public.transactions t
        where t.dedupe_state = 'possible_duplicate'
      ),
      'oldest_review_age_seconds', (
        select coalesce(
          extract(epoch from (w.captured_at - min(t.created_at)))::bigint,
          0
        )
        from public.transactions t
        where t.dedupe_state = 'possible_duplicate'
      )
    ),
    'jobs', jsonb_build_object(
      'report_runs_due', (
        select count(*) from public.report_runs r
        where r.scheduled_for >= w.window_start
          and r.scheduled_for <= w.captured_at
      ),
      'report_runs_failed', (
        select count(*) from public.report_runs r
        where r.scheduled_for >= w.window_start
          and r.status in ('generation_failed', 'delivery_failed')
      ),
      'report_runs_overdue', (
        select count(*) from public.report_runs r
        where r.status in ('scheduled', 'generating')
          and r.scheduled_for < w.captured_at - interval '15 minutes'
      ),
      'report_deliveries_attempted', (
        select count(*) from public.report_deliveries d
        where coalesce(d.last_attempt_at, d.created_at) >= w.window_start
      ),
      'report_deliveries_failed', (
        select count(*) from public.report_deliveries d
        where coalesce(d.last_attempt_at, d.created_at) >= w.window_start
          and d.status = 'failed'
      )
    ),
    'email', jsonb_build_object(
      'attempted', (
        select count(*) from public.email_send_log e
        where e.created_at >= w.window_start
      ),
      'sent', (
        select count(*) from public.email_send_log e
        where e.created_at >= w.window_start and e.outcome = 'sent'
      ),
      'skipped', (
        select count(*) from public.email_send_log e
        where e.created_at >= w.window_start and e.outcome = 'skipped'
      ),
      'failed', (
        select count(*) from public.email_send_log e
        where e.created_at >= w.window_start and e.outcome = 'failed'
      ),
      'pending_outbox', (
        select count(*) from public.notifications n
        where n.channel = 'email' and n.delivered_at is null
      ),
      'oldest_pending_age_seconds', (
        select coalesce(
          extract(epoch from (w.captured_at - min(n.created_at)))::bigint,
          0
        )
        from public.notifications n
        where n.channel = 'email' and n.delivered_at is null
      )
    ),
    'reconciliation', jsonb_build_object(
      'created', (
        select count(*) from public.payment_reconciliations r
        where r.created_at >= w.window_start
      ),
      'linked', (
        select count(*) from public.payment_reconciliations r
        where r.created_at >= w.window_start and r.status = 'linked'
      ),
      'conflicts', (
        select count(*) from public.payment_reconciliations r
        where r.created_at >= w.window_start and r.status = 'conflict'
      ),
      'rejected', (
        select count(*) from public.payment_reconciliations r
        where r.created_at >= w.window_start and r.status = 'rejected'
      ),
      'review_backlog', (
        select count(*) from public.payment_intents i
        where i.state = 'requires_reconciliation'
      ),
      'oldest_review_age_seconds', (
        select coalesce(
          extract(epoch from (w.captured_at - min(i.updated_at)))::bigint,
          0
        )
        from public.payment_intents i
        where i.state = 'requires_reconciliation'
      )
    )
  )
  from windowed w;
$$;

comment on function public.get_operational_health_snapshot(integer) is
  'Service-only aggregate health snapshot for ingestion, duplicate review, report jobs, email, and payment reconciliation. Returns no tenant/customer identifiers, payloads, credentials, destinations, or financial values.';
revoke all on function public.get_operational_health_snapshot(integer)
  from public;
grant execute on function public.get_operational_health_snapshot(integer)
  to service_role;

