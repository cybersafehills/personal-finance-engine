-- Platform Console workflows: Support, Incidents, Approvals (staff access
-- changes) and the read-only Integrations / Communications status.
--
-- Write rules (all enforced here, not in the app):
--   * one SECURITY DEFINER function per command, each starting with
--     console_assert(<permission>) (signed in + aal2 + active staff + permission)
--   * the audit row is written INSIDE the same transaction as the change, so a
--     change can never exist without its audit entry (and vice versa)
--   * rows are locked (FOR UPDATE) and status-checked, so a double submit is a
--     no-op or a clear error, never a double effect
--   * no table has any grant to anon/authenticated; append-only tables
--     (events, notes) also lose UPDATE/DELETE/TRUNCATE for service_role
--   * free text (notes, summaries) is NEVER copied into audit metadata; the
--     audit row carries references only
--   * support tickets and incidents are STAFF-LOGGED. There is no customer
--     intake channel, so nothing here pretends a customer filed anything.

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
insert into public.console_role_permissions (role, permission) values
  ('platform_owner', 'request_staff_change'),
  ('platform_admin', 'request_staff_change'),
  ('security_admin', 'request_staff_change'),
  ('platform_admin', 'view_integrations'),
  ('platform_owner', 'view_integrations'),
  ('security_admin', 'view_integrations'),
  ('read_only_analyst', 'view_integrations')
on conflict do nothing;

-- Shared helper: append an audit row (internal; never callable by clients).
create function public.console_audit_internal(
  p_role text,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_outcome text default 'success',
  p_metadata jsonb default '{}'::jsonb
)
  returns void
  language sql
  security definer
  set search_path = public
as $$
  insert into public.console_audit_events
    (actor_user_id, actor_role, action, target_type, target_id, outcome, metadata)
  values
    (auth.uid(), p_role, p_action, p_target_type, p_target_id, p_outcome,
     coalesce(p_metadata, '{}'::jsonb));
$$;
revoke all on function public.console_audit_internal(text,text,text,text,text,jsonb) from public;

-- Shared trigger: reject UPDATE/DELETE/TRUNCATE on append-only tables.
create function public.console_append_only()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end;
$$;
revoke all on function public.console_append_only() from public;

-- ---------------------------------------------------------------------------
-- Support
-- ---------------------------------------------------------------------------
create table public.console_support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_no bigint generated always as identity,
  subject text not null check (char_length(subject) between 3 and 160),
  category text not null check (category in (
    'account_access', 'subscription_billing', 'payment_issue',
    'transaction_import', 'wallet_configuration', 'application_malfunction',
    'security_concern', 'feature_assistance')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'waiting', 'escalated', 'resolved', 'closed')),
  source text not null default 'staff_logged' check (source = 'staff_logged'),
  customer_id uuid references public.profiles (id) on delete set null,
  created_by uuid,
  assigned_to uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index idx_console_tickets_status on public.console_support_tickets (status, updated_at desc);

create table public.console_support_ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.console_support_tickets (id) on delete cascade,
  kind text not null check (kind in ('created', 'note', 'status_change', 'assignment')),
  actor_user_id uuid,
  actor_role text,
  body text check (body is null or char_length(body) <= 2000),
  from_status text,
  to_status text,
  assignee uuid,
  created_at timestamptz not null default now()
);
create index idx_console_ticket_events_ticket on public.console_support_ticket_events (ticket_id, created_at);

-- ---------------------------------------------------------------------------
-- Incidents
-- ---------------------------------------------------------------------------
create table public.console_incidents (
  id uuid primary key default gen_random_uuid(),
  incident_no bigint generated always as identity,
  title text not null check (char_length(title) between 3 and 160),
  severity text not null check (severity in ('sev1', 'sev2', 'sev3', 'sev4')),
  category text not null check (category in (
    'availability', 'data_integrity', 'security', 'third_party', 'other')),
  detection_source text not null check (detection_source in (
    'manual', 'health_check', 'customer_report', 'monitoring')),
  status text not null default 'open'
    check (status in ('open', 'investigating', 'contained', 'resolved')),
  owner_user_id uuid,
  declared_by uuid,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index idx_console_incidents_status on public.console_incidents (status, updated_at desc);

create table public.console_incident_events (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.console_incidents (id) on delete cascade,
  kind text not null check (kind in (
    'declared', 'update', 'status_change', 'owner_change', 'containment', 'resolution')),
  actor_user_id uuid,
  actor_role text,
  body text check (body is null or char_length(body) <= 2000),
  from_status text,
  to_status text,
  created_at timestamptz not null default now()
);
create index idx_console_incident_events_inc on public.console_incident_events (incident_id, created_at);

-- ---------------------------------------------------------------------------
-- Approvals (staff access changes, four-eyes)
-- ---------------------------------------------------------------------------
create table public.console_approval_requests (
  id uuid primary key default gen_random_uuid(),
  request_no bigint generated always as identity,
  kind text not null check (kind in (
    'staff_grant', 'staff_suspend', 'staff_reactivate', 'staff_role_change')),
  target_user_id uuid not null,
  target_email text not null,
  new_role text check (new_role is null or new_role in (
    'platform_owner', 'platform_admin', 'finance_admin',
    'security_admin', 'support_agent', 'read_only_analyst')),
  reason text not null check (char_length(reason) between 10 and 500),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled', 'failed')),
  requested_by uuid not null,
  requested_role text,
  decided_by uuid,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  failure_reason text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint approval_role_needed check (
    (kind in ('staff_grant', 'staff_role_change')) = (new_role is not null))
);
-- at most one pending request per (kind, target)
create unique index uq_console_approval_pending
  on public.console_approval_requests (kind, target_user_id) where status = 'pending';
create index idx_console_approvals_status on public.console_approval_requests (status, created_at desc);

-- ---------------------------------------------------------------------------
-- Lock down: RPC-only access; append-only tables are immutable even to
-- service_role.
-- ---------------------------------------------------------------------------
alter table public.console_support_tickets enable row level security;
alter table public.console_support_ticket_events enable row level security;
alter table public.console_incidents enable row level security;
alter table public.console_incident_events enable row level security;
alter table public.console_approval_requests enable row level security;

revoke all on public.console_support_tickets from anon, authenticated;
revoke all on public.console_support_ticket_events from anon, authenticated;
revoke all on public.console_incidents from anon, authenticated;
revoke all on public.console_incident_events from anon, authenticated;
revoke all on public.console_approval_requests from anon, authenticated;

revoke all on public.console_support_tickets from service_role;
revoke all on public.console_incidents from service_role;
revoke all on public.console_approval_requests from service_role;
grant select, insert, update on public.console_support_tickets to service_role;
grant select, insert, update on public.console_incidents to service_role;
grant select, insert, update on public.console_approval_requests to service_role;

revoke all on public.console_support_ticket_events from service_role;
revoke all on public.console_incident_events from service_role;
grant select, insert on public.console_support_ticket_events to service_role;
grant select, insert on public.console_incident_events to service_role;

create trigger console_ticket_events_append_only
  before update or delete on public.console_support_ticket_events
  for each row execute function public.console_append_only();
create trigger console_ticket_events_no_truncate
  before truncate on public.console_support_ticket_events
  for each statement execute function public.console_append_only();
create trigger console_incident_events_append_only
  before update or delete on public.console_incident_events
  for each row execute function public.console_append_only();
create trigger console_incident_events_no_truncate
  before truncate on public.console_incident_events
  for each statement execute function public.console_append_only();

-- ===========================================================================
-- SUPPORT RPCs  (permission: manage_support_tickets)
-- ===========================================================================
create function public.console_support_list(
  p_status text default null,
  p_limit integer default 25,
  p_before timestamptz default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
begin
  perform public.console_assert('manage_support_tickets');
  if p_status is not null and p_status not in
     ('open','in_progress','waiting','escalated','resolved','closed','active') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'counts', (
      select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
      from (select status, count(*) as n from public.console_support_tickets group by status) c
    ),
    'rows', coalesce((
      select jsonb_agg(row_to_json(t) order by t.updated_at desc)
      from (
        select k.id, 'T-' || lpad(k.ticket_no::text, 5, '0') as ref, k.subject,
               k.category, k.priority, k.status, k.created_at, k.updated_at,
               case when k.customer_id is null then null else left(k.customer_id::text, 8) end as customer_ref,
               (select u.email from auth.users u where u.id = k.assigned_to) as assignee_email
        from public.console_support_tickets k
        where (p_status is null
               or (p_status = 'active' and k.status in ('open','in_progress','waiting','escalated'))
               or k.status = p_status)
          and (p_before is null or k.updated_at < p_before)
        order by k.updated_at desc
        limit v_limit
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

create function public.console_support_get(p_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
declare
  v jsonb;
begin
  perform public.console_assert('manage_support_tickets');
  select jsonb_build_object(
    'id', k.id, 'ref', 'T-' || lpad(k.ticket_no::text, 5, '0'),
    'subject', k.subject, 'category', k.category, 'priority', k.priority,
    'status', k.status, 'source', k.source,
    'customer_id', k.customer_id,
    'customer_ref', case when k.customer_id is null then null else left(k.customer_id::text, 8) end,
    'assigned_to', k.assigned_to,
    'assignee_email', (select u.email from auth.users u where u.id = k.assigned_to),
    'created_at', k.created_at, 'updated_at', k.updated_at, 'resolved_at', k.resolved_at,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'kind', e.kind, 'actor_role', e.actor_role,
        'actor_email', (select u.email from auth.users u where u.id = e.actor_user_id),
        'body', e.body, 'from_status', e.from_status, 'to_status', e.to_status,
        'assignee_email', (select u.email from auth.users u where u.id = e.assignee),
        'created_at', e.created_at) order by e.created_at, e.id)
      from public.console_support_ticket_events e where e.ticket_id = k.id), '[]'::jsonb)
  ) into v
  from public.console_support_tickets k where k.id = p_id;
  if v is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  return v;
end;
$$;

create function public.console_support_create(
  p_subject text,
  p_category text,
  p_priority text default 'normal',
  p_customer_id uuid default null,
  p_body text default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role text;
  v_id uuid;
  v_no bigint;
begin
  v_role := public.console_assert('manage_support_tickets');
  if p_customer_id is not null
     and not exists (select 1 from public.profiles where id = p_customer_id) then
    raise exception 'customer_not_found' using errcode = 'P0002';
  end if;
  insert into public.console_support_tickets
    (subject, category, priority, customer_id, created_by, assigned_to)
  values (btrim(p_subject), p_category, p_priority, p_customer_id, auth.uid(), auth.uid())
  returning id, ticket_no into v_id, v_no;
  insert into public.console_support_ticket_events (ticket_id, kind, actor_user_id, actor_role, body, to_status)
    values (v_id, 'created', auth.uid(), v_role, nullif(btrim(p_body), ''), 'open');
  perform public.console_audit_internal(v_role, 'support.ticket_created', 'ticket',
    'T-' || lpad(v_no::text, 5, '0'),
    'success', jsonb_build_object('category', p_category, 'priority', p_priority));
  return v_id;
end;
$$;

create function public.console_support_add_note(p_id uuid, p_body text)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role text;
  v_no bigint;
begin
  v_role := public.console_assert('manage_support_tickets');
  if p_body is null or char_length(btrim(p_body)) = 0 then
    raise exception 'empty_note' using errcode = '22023';
  end if;
  select ticket_no into v_no from public.console_support_tickets where id = p_id for update;
  if v_no is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  insert into public.console_support_ticket_events (ticket_id, kind, actor_user_id, actor_role, body)
    values (p_id, 'note', auth.uid(), v_role, btrim(p_body));
  update public.console_support_tickets set updated_at = now() where id = p_id;
  perform public.console_audit_internal(v_role, 'support.note_added', 'ticket', 'T-' || lpad(v_no::text, 5, '0'));
end;
$$;

create function public.console_support_set_status(p_id uuid, p_status text, p_note text default null)
  returns text
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role text;
  v_cur text;
  v_no bigint;
  v_ok boolean;
begin
  v_role := public.console_assert('manage_support_tickets');
  if p_status not in ('open','in_progress','waiting','escalated','resolved','closed') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  select status, ticket_no into v_cur, v_no
    from public.console_support_tickets where id = p_id for update;
  if v_cur is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_cur = p_status then return v_cur; end if;  -- idempotent
  v_ok := case v_cur
    when 'open'        then p_status in ('in_progress','waiting','escalated','resolved','closed')
    when 'in_progress' then p_status in ('waiting','escalated','resolved','closed','open')
    when 'waiting'     then p_status in ('in_progress','escalated','resolved','closed','open')
    when 'escalated'   then p_status in ('in_progress','resolved','closed')
    when 'resolved'    then p_status in ('closed','open')
    when 'closed'      then p_status in ('open')
    else false end;
  if not v_ok then raise exception 'invalid_transition' using errcode = '22023'; end if;
  if p_status in ('escalated','resolved') and char_length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'note_required' using errcode = '22023';
  end if;
  update public.console_support_tickets
     set status = p_status, updated_at = now(),
         resolved_at = case when p_status in ('resolved','closed') then coalesce(resolved_at, now()) else null end
   where id = p_id;
  insert into public.console_support_ticket_events
    (ticket_id, kind, actor_user_id, actor_role, body, from_status, to_status)
    values (p_id, 'status_change', auth.uid(), v_role, nullif(btrim(p_note), ''), v_cur, p_status);
  perform public.console_audit_internal(v_role,
    case when p_status = 'escalated' then 'support.ticket_escalated' else 'support.status_changed' end,
    'ticket', 'T-' || lpad(v_no::text, 5, '0'), 'success',
    jsonb_build_object('from', v_cur, 'to', p_status));
  return p_status;
end;
$$;

create function public.console_support_assign(p_id uuid, p_assignee uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role text;
  v_no bigint;
begin
  v_role := public.console_assert('manage_support_tickets');
  if p_assignee is not null and not exists (
    select 1 from public.console_staff s
    join public.console_role_permissions rp on rp.role = s.role
    where s.user_id = p_assignee and s.status = 'active'
      and rp.permission = 'manage_support_tickets') then
    raise exception 'invalid_assignee' using errcode = '22023';
  end if;
  select ticket_no into v_no from public.console_support_tickets where id = p_id for update;
  if v_no is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.console_support_tickets set assigned_to = p_assignee, updated_at = now() where id = p_id;
  insert into public.console_support_ticket_events (ticket_id, kind, actor_user_id, actor_role, assignee)
    values (p_id, 'assignment', auth.uid(), v_role, p_assignee);
  perform public.console_audit_internal(v_role, 'support.assigned', 'ticket', 'T-' || lpad(v_no::text, 5, '0'));
end;
$$;

-- Staff who can take support tickets (for the assignee picker).
create function public.console_support_assignees()
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
begin
  perform public.console_assert('manage_support_tickets');
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'email', u.email, 'role', s.role) order by u.email)
    from public.console_staff s
    join auth.users u on u.id = s.user_id
    where s.status = 'active' and exists (
      select 1 from public.console_role_permissions rp
       where rp.role = s.role and rp.permission = 'manage_support_tickets')
  ), '[]'::jsonb);
end;
$$;

-- ===========================================================================
-- INCIDENT RPCs  (permission: review_security_incidents)
-- ===========================================================================
create function public.console_incident_list(p_status text default null, p_limit integer default 25)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
begin
  perform public.console_assert('review_security_incidents');
  if p_status is not null and p_status not in ('open','investigating','contained','resolved','active') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'counts', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
               from (select status, count(*) as n from public.console_incidents group by status) c),
    'rows', coalesce((
      select jsonb_agg(row_to_json(i) order by i.updated_at desc)
      from (
        select x.id, 'INC-' || lpad(x.incident_no::text, 4, '0') as ref, x.title, x.severity,
               x.category, x.detection_source, x.status, x.started_at, x.updated_at, x.resolved_at,
               (select u.email from auth.users u where u.id = x.owner_user_id) as owner_email
        from public.console_incidents x
        where (p_status is null
               or (p_status = 'active' and x.status in ('open','investigating','contained'))
               or x.status = p_status)
        order by case x.severity when 'sev1' then 1 when 'sev2' then 2 when 'sev3' then 3 else 4 end,
                 x.updated_at desc
        limit v_limit
      ) i
    ), '[]'::jsonb)
  );
end;
$$;

create function public.console_incident_get(p_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
declare
  v jsonb;
begin
  perform public.console_assert('review_security_incidents');
  select jsonb_build_object(
    'id', x.id, 'ref', 'INC-' || lpad(x.incident_no::text, 4, '0'), 'title', x.title,
    'severity', x.severity, 'category', x.category, 'detection_source', x.detection_source,
    'status', x.status, 'owner_user_id', x.owner_user_id,
    'owner_email', (select u.email from auth.users u where u.id = x.owner_user_id),
    'started_at', x.started_at, 'updated_at', x.updated_at, 'resolved_at', x.resolved_at,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'kind', e.kind, 'actor_role', e.actor_role,
        'actor_email', (select u.email from auth.users u where u.id = e.actor_user_id),
        'body', e.body, 'from_status', e.from_status, 'to_status', e.to_status,
        'created_at', e.created_at) order by e.created_at, e.id)
      from public.console_incident_events e where e.incident_id = x.id), '[]'::jsonb)
  ) into v
  from public.console_incidents x where x.id = p_id;
  if v is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  return v;
end;
$$;

create function public.console_incident_declare(
  p_title text, p_severity text, p_category text, p_detection_source text, p_summary text default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role text;
  v_id uuid;
  v_no bigint;
begin
  v_role := public.console_assert('review_security_incidents');
  insert into public.console_incidents
    (title, severity, category, detection_source, owner_user_id, declared_by)
  values (btrim(p_title), p_severity, p_category, p_detection_source, auth.uid(), auth.uid())
  returning id, incident_no into v_id, v_no;
  insert into public.console_incident_events (incident_id, kind, actor_user_id, actor_role, body, to_status)
    values (v_id, 'declared', auth.uid(), v_role, nullif(btrim(p_summary), ''), 'open');
  perform public.console_audit_internal(v_role, 'incident.declared', 'incident',
    'INC-' || lpad(v_no::text, 4, '0'), 'success',
    jsonb_build_object('severity', p_severity, 'category', p_category, 'source', p_detection_source));
  return v_id;
end;
$$;

create function public.console_incident_add_update(p_id uuid, p_kind text, p_body text)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role text;
  v_no bigint;
begin
  v_role := public.console_assert('review_security_incidents');
  if p_kind not in ('update', 'containment') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if p_body is null or char_length(btrim(p_body)) = 0 then
    raise exception 'empty_note' using errcode = '22023';
  end if;
  select incident_no into v_no from public.console_incidents where id = p_id for update;
  if v_no is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  insert into public.console_incident_events (incident_id, kind, actor_user_id, actor_role, body)
    values (p_id, p_kind, auth.uid(), v_role, btrim(p_body));
  update public.console_incidents set updated_at = now() where id = p_id;
  perform public.console_audit_internal(v_role,
    case p_kind when 'containment' then 'incident.containment_recorded' else 'incident.update_added' end,
    'incident', 'INC-' || lpad(v_no::text, 4, '0'));
end;
$$;

create function public.console_incident_set_status(p_id uuid, p_status text, p_note text default null)
  returns text
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role text;
  v_cur text;
  v_no bigint;
  v_ok boolean;
begin
  v_role := public.console_assert('review_security_incidents');
  if p_status not in ('open','investigating','contained','resolved') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  select status, incident_no into v_cur, v_no
    from public.console_incidents where id = p_id for update;
  if v_cur is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_cur = p_status then return v_cur; end if;
  v_ok := case v_cur
    when 'open'          then p_status in ('investigating','contained','resolved')
    when 'investigating' then p_status in ('contained','resolved','open')
    when 'contained'     then p_status in ('investigating','resolved')
    when 'resolved'      then p_status in ('investigating')
    else false end;
  if not v_ok then raise exception 'invalid_transition' using errcode = '22023'; end if;
  if p_status = 'resolved' and char_length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'note_required' using errcode = '22023';
  end if;
  update public.console_incidents
     set status = p_status, updated_at = now(),
         resolved_at = case when p_status = 'resolved' then now() else null end
   where id = p_id;
  insert into public.console_incident_events
    (incident_id, kind, actor_user_id, actor_role, body, from_status, to_status)
    values (p_id, case when p_status = 'resolved' then 'resolution' else 'status_change' end,
            auth.uid(), v_role, nullif(btrim(p_note), ''), v_cur, p_status);
  perform public.console_audit_internal(v_role, 'incident.status_changed', 'incident',
    'INC-' || lpad(v_no::text, 4, '0'), 'success', jsonb_build_object('from', v_cur, 'to', p_status));
  return p_status;
end;
$$;

-- ===========================================================================
-- APPROVAL RPCs (staff access changes; requester <> approver, enforced here)
-- ===========================================================================
create function public.console_approval_request(
  p_kind text, p_target_email text, p_new_role text, p_reason text
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role text;
  v_target uuid;
  v_email text;
  v_staff record;
  v_id uuid;
  v_no bigint;
begin
  v_role := public.console_assert('request_staff_change');
  if p_kind not in ('staff_grant','staff_suspend','staff_reactivate','staff_role_change') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  select u.id, u.email into v_target, v_email
    from auth.users u where lower(u.email) = lower(btrim(p_target_email));
  if v_target is null then raise exception 'target_not_found' using errcode = 'P0002'; end if;
  if v_target = auth.uid() then
    raise exception 'cannot_target_self' using errcode = '42501';
  end if;

  select * into v_staff from public.console_staff where user_id = v_target;
  if p_kind = 'staff_grant' then
    if v_staff.user_id is not null then raise exception 'already_staff' using errcode = '22023'; end if;
  elsif v_staff.user_id is null then
    raise exception 'not_staff' using errcode = '22023';
  elsif p_kind = 'staff_suspend' and v_staff.status = 'suspended' then
    raise exception 'already_suspended' using errcode = '22023';
  elsif p_kind = 'staff_reactivate' and v_staff.status = 'active' then
    raise exception 'already_active' using errcode = '22023';
  end if;

  insert into public.console_approval_requests
    (kind, target_user_id, target_email, new_role, reason, requested_by, requested_role)
  values (p_kind, v_target, v_email,
          case when p_kind in ('staff_grant','staff_role_change') then p_new_role end,
          btrim(p_reason), auth.uid(), v_role)
  returning id, request_no into v_id, v_no;

  perform public.console_audit_internal(v_role, 'approval.requested', 'approval',
    'AR-' || lpad(v_no::text, 4, '0'), 'success',
    jsonb_build_object('kind', p_kind, 'target', left(v_target::text, 8)));
  return v_id;
exception when unique_violation then
  raise exception 'already_pending' using errcode = '22023';
end;
$$;

create function public.console_approval_list(p_status text default null, p_limit integer default 50)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_role text;
  v_can_decide boolean;
begin
  v_role := public.console_assert('view_staff');
  v_can_decide := exists (select 1 from public.console_role_permissions rp
                           where rp.role = v_role and rp.permission = 'manage_staff');
  if p_status is not null and p_status not in ('pending','approved','rejected','cancelled','failed') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'viewer_id', auth.uid(),
    'viewer_can_decide', v_can_decide,
    'counts', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
               from (select status, count(*) as n from public.console_approval_requests group by status) c),
    'rows', coalesce((
      select jsonb_agg(row_to_json(r) order by r.created_at desc)
      from (
        select a.id, 'AR-' || lpad(a.request_no::text, 4, '0') as ref, a.kind, a.target_email,
               a.new_role, a.reason, a.status, a.requested_by, a.requested_role,
               (select u.email from auth.users u where u.id = a.requested_by) as requested_by_email,
               a.decided_by, (select u.email from auth.users u where u.id = a.decided_by) as decided_by_email,
               a.decision_note, a.failure_reason, a.created_at, a.decided_at
        from public.console_approval_requests a
        where p_status is null or a.status = p_status
        order by a.created_at desc
        limit v_limit
      ) r
    ), '[]'::jsonb)
  );
end;
$$;

create function public.console_approval_cancel(p_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role text;
  v_req public.console_approval_requests%rowtype;
begin
  v_role := public.console_assert('request_staff_change');
  select * into v_req from public.console_approval_requests where id = p_id for update;
  if v_req.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_req.requested_by <> auth.uid() then raise exception 'not_requester' using errcode = '42501'; end if;
  if v_req.status <> 'pending' then raise exception 'not_pending' using errcode = '22023'; end if;
  update public.console_approval_requests
     set status = 'cancelled', decided_by = auth.uid(), decided_at = now() where id = p_id;
  perform public.console_audit_internal(v_role, 'approval.cancelled', 'approval',
    'AR-' || lpad(v_req.request_no::text, 4, '0'));
end;
$$;

-- Decide + execute atomically. Returns {status, reason?}. A validation failure
-- at execution time marks the request 'failed' (and commits that), it does not
-- raise, so the outcome is always recorded.
create function public.console_approval_decide(p_id uuid, p_decision text, p_note text default null)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role text;
  v_req public.console_approval_requests%rowtype;
  v_staff public.console_staff%rowtype;
  v_owners integer;
  v_fail text;
  v_ref text;
begin
  v_role := public.console_assert('manage_staff');
  if p_decision not in ('approve', 'reject') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;

  select * into v_req from public.console_approval_requests where id = p_id for update;
  if v_req.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  v_ref := 'AR-' || lpad(v_req.request_no::text, 4, '0');
  if v_req.status <> 'pending' then
    raise exception 'not_pending' using errcode = '22023';
  end if;
  -- Separation of duties.
  if v_req.requested_by = auth.uid() then
    raise exception 'self_approval_forbidden' using errcode = '42501';
  end if;
  if v_req.target_user_id = auth.uid() then
    raise exception 'cannot_decide_own_access' using errcode = '42501';
  end if;

  if p_decision = 'reject' then
    update public.console_approval_requests
       set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
           decision_note = nullif(btrim(p_note), '') where id = p_id;
    perform public.console_audit_internal(v_role, 'approval.rejected', 'approval', v_ref, 'success',
      jsonb_build_object('kind', v_req.kind));
    return jsonb_build_object('status', 'rejected');
  end if;

  -- Execute, re-validating the target as it is NOW.
  select * into v_staff from public.console_staff where user_id = v_req.target_user_id for update;
  if not exists (select 1 from auth.users where id = v_req.target_user_id) then
    v_fail := 'target_no_longer_exists';
  elsif v_req.kind = 'staff_grant' then
    if v_staff.user_id is not null then
      v_fail := 'target_already_staff';
    else
      insert into public.console_staff (user_id, role, granted_by, notes)
        values (v_req.target_user_id, v_req.new_role, auth.uid(), 'granted via ' || v_ref);
    end if;
  elsif v_staff.user_id is null then
    v_fail := 'target_not_staff';
  else
    select count(*) into v_owners from public.console_staff
     where role = 'platform_owner' and status = 'active';
    if v_req.kind = 'staff_suspend' then
      if v_staff.status = 'suspended' then v_fail := 'target_already_suspended';
      elsif v_staff.role = 'platform_owner' and v_owners <= 1 then v_fail := 'would_remove_last_owner';
      else update public.console_staff set status = 'suspended' where user_id = v_staff.user_id; end if;
    elsif v_req.kind = 'staff_reactivate' then
      if v_staff.status = 'active' then v_fail := 'target_already_active';
      else update public.console_staff set status = 'active' where user_id = v_staff.user_id; end if;
    elsif v_req.kind = 'staff_role_change' then
      if v_staff.role = v_req.new_role then v_fail := 'role_unchanged';
      elsif v_staff.role = 'platform_owner' and v_staff.status = 'active' and v_owners <= 1 then
        v_fail := 'would_remove_last_owner';
      else update public.console_staff set role = v_req.new_role where user_id = v_staff.user_id; end if;
    end if;
  end if;

  if v_fail is not null then
    update public.console_approval_requests
       set status = 'failed', decided_by = auth.uid(), decided_at = now(),
           decision_note = nullif(btrim(p_note), ''), failure_reason = v_fail where id = p_id;
    perform public.console_audit_internal(v_role, 'approval.execution_failed', 'approval', v_ref, 'failed',
      jsonb_build_object('kind', v_req.kind, 'reason', v_fail));
    return jsonb_build_object('status', 'failed', 'reason', v_fail);
  end if;

  update public.console_approval_requests
     set status = 'approved', decided_by = auth.uid(), decided_at = now(),
         decision_note = nullif(btrim(p_note), '') where id = p_id;
  perform public.console_audit_internal(v_role, 'approval.approved', 'approval', v_ref, 'success',
    jsonb_build_object('kind', v_req.kind, 'target', left(v_req.target_user_id::text, 8),
                       'role', v_req.new_role));
  return jsonb_build_object('status', 'approved');
end;
$$;

-- ===========================================================================
-- Integrations + Communications (read-only, counts only)
-- ===========================================================================
-- Never returns destination URLs, webhook endpoints, secrets, credentials,
-- recipient addresses or message bodies.
create function public.console_integrations_overview()
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
begin
  perform public.console_assert('view_integrations');
  return jsonb_build_object(
    'generated_at', now(),
    'ingestion_connections', coalesce((
      select jsonb_agg(jsonb_build_object('provider', provider, 'status', status, 'count', n) order by provider, status)
      from (select provider, status, count(*) as n from public.ingestion_connections group by 1, 2) c
    ), '[]'::jsonb),
    'connector_installations', coalesce((
      select jsonb_agg(jsonb_build_object('connector', connector_key, 'status', status, 'count', n) order by connector_key, status)
      from (select connector_key, status, count(*) as n from public.connector_installations group by 1, 2) c
    ), '[]'::jsonb),
    'sync_runs_24h', coalesce((
      select jsonb_agg(jsonb_build_object('status', status, 'count', n) order by status)
      from (select status, count(*) as n from public.integration_sync_runs
             where created_at >= now() - interval '24 hours' group by 1) c
    ), '[]'::jsonb),
    'webhook_deliveries_24h', coalesce((
      select jsonb_agg(jsonb_build_object('status', status, 'count', n) order by status)
      from (select status, count(*) as n from public.webhook_deliveries
             where created_at >= now() - interval '24 hours' group by 1) c
    ), '[]'::jsonb),
    'webhook_subscriptions', (select count(*) from public.webhook_subscriptions)
  );
end;
$$;

create function public.console_communications_overview()
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
begin
  perform public.console_assert('view_system_health');
  return jsonb_build_object(
    'generated_at', now(),
    'notifications_7d', coalesce((
      select jsonb_agg(jsonb_build_object('channel', channel, 'created', n, 'delivered', d) order by channel)
      from (select channel, count(*) as n, count(delivered_at) as d
              from public.notifications
             where created_at >= now() - interval '7 days' group by 1) c
    ), '[]'::jsonb),
    'notifications_by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', day, 'count', n) order by day)
      from (select (created_at at time zone 'Africa/Kigali')::date as day, count(*) as n
              from public.notifications
             where created_at >= now() - interval '14 days' group by 1) c
    ), '[]'::jsonb),
    'email_health', (public.get_operational_health_snapshot(1440)) -> 'email'
  );
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'console_support_list(text,integer,timestamptz)',
    'console_support_get(uuid)',
    'console_support_create(text,text,text,uuid,text)',
    'console_support_add_note(uuid,text)',
    'console_support_set_status(uuid,text,text)',
    'console_support_assign(uuid,uuid)',
    'console_support_assignees()',
    'console_incident_list(text,integer)',
    'console_incident_get(uuid)',
    'console_incident_declare(text,text,text,text,text)',
    'console_incident_add_update(uuid,text,text)',
    'console_incident_set_status(uuid,text,text)',
    'console_approval_request(text,text,text,text)',
    'console_approval_list(text,integer)',
    'console_approval_cancel(uuid)',
    'console_approval_decide(uuid,text,text)',
    'console_integrations_overview()',
    'console_communications_overview()'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
