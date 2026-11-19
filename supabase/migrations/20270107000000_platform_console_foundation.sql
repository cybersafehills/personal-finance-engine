-- OneLedger Platform Console - security foundation (platform.oneledger.me).
--
-- The console is operated by staff, not customers. Access is therefore NOT
-- derived from profiles.is_platform_admin (a single boolean that predates the
-- console and is not role-aware). This migration adds:
--
--   console_staff             who may enter the console, and with which role
--   console_role_permissions  the role -> permission matrix (DB is the source
--                             of truth; the app reads it via console_my_access)
--   console_audit_events      append-only audit trail of console activity
--
-- and a small set of SECURITY DEFINER RPCs. The console never holds the
-- service-role key: every read goes through these RPCs as the signed-in staff
-- member, and every RPC re-checks (1) a signed-in user, (2) MFA (aal2),
-- (3) an ACTIVE staff row, (4) the specific permission - server-side, so the
-- app-level checks are UX only.
--
-- Deliberate choices (see docs/platform-console/architecture.md):
--   * No table here has a grant to `authenticated`/`anon`; RLS is enabled with
--     no policies. All access is through the RPCs below.
--   * RPCs return AGGREGATES and masked identifiers only. No transaction rows,
--     descriptions, amounts, balances or message bodies are reachable.
--   * No write path for staff membership exists in the app. Staff are granted
--     by a database operator (service role / SQL editor) - see the runbook. A
--     console that can grant itself privilege is a privilege-escalation path.
--   * The Platform Owner does not automatically hold every permission: e.g.
--     export_sensitive_reports and approve_refunds are not seeded for it.

-- ---------------------------------------------------------------------------
-- Staff + permission matrix
-- ---------------------------------------------------------------------------

create table public.console_staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null
    check (role in (
      'platform_owner', 'platform_admin', 'finance_admin',
      'security_admin', 'support_agent', 'read_only_analyst'
    )),
  status text not null default 'active'
    check (status in ('active', 'suspended')),
  granted_by uuid references auth.users (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.console_staff is
  'Platform Console staff membership. One row per staff user. Written only by a database operator (service role); there is deliberately no in-console write path. A suspended row is denied by every console RPC.';

create trigger set_console_staff_updated_at
  before update on public.console_staff
  for each row execute function public.set_updated_at();

create table public.console_role_permissions (
  role text not null
    check (role in (
      'platform_owner', 'platform_admin', 'finance_admin',
      'security_admin', 'support_agent', 'read_only_analyst'
    )),
  permission text not null
    check (permission ~ '^[a-z][a-z_]*$'),
  primary key (role, permission)
);

comment on table public.console_role_permissions is
  'Role -> permission matrix for the Platform Console. Source of truth for authorization; read by console_my_access(). Least privilege: a permission is held only where listed.';

insert into public.console_role_permissions (role, permission) values
  -- Platform Owner: governance + oversight. Intentionally NOT seeded with
  -- approve_refunds or export_sensitive_reports (privacy controls are not
  -- bypassed by seniority).
  ('platform_owner', 'view_aggregate_metrics'),
  ('platform_owner', 'view_customer_metadata'),
  ('platform_owner', 'view_financial_metrics'),
  ('platform_owner', 'view_audit_logs'),
  ('platform_owner', 'view_staff'),
  ('platform_owner', 'manage_staff'),
  ('platform_owner', 'view_system_health'),
  ('platform_owner', 'review_security_incidents'),
  ('platform_owner', 'manage_subscriptions'),
  ('platform_owner', 'manage_support_tickets'),
  ('platform_owner', 'configure_integrations'),
  -- Platform Administrator
  ('platform_admin', 'view_aggregate_metrics'),
  ('platform_admin', 'view_customer_metadata'),
  ('platform_admin', 'view_audit_logs'),
  ('platform_admin', 'view_staff'),
  ('platform_admin', 'view_system_health'),
  ('platform_admin', 'manage_subscriptions'),
  ('platform_admin', 'manage_support_tickets'),
  ('platform_admin', 'configure_integrations'),
  -- Finance Administrator
  ('finance_admin', 'view_aggregate_metrics'),
  ('finance_admin', 'view_financial_metrics'),
  ('finance_admin', 'manage_subscriptions'),
  ('finance_admin', 'approve_refunds'),
  -- Security Administrator
  ('security_admin', 'view_aggregate_metrics'),
  ('security_admin', 'view_audit_logs'),
  ('security_admin', 'view_staff'),
  ('security_admin', 'view_system_health'),
  ('security_admin', 'review_security_incidents'),
  -- Customer Support Agent
  ('support_agent', 'view_aggregate_metrics'),
  ('support_agent', 'view_customer_metadata'),
  ('support_agent', 'manage_support_tickets'),
  -- Read-Only Analyst
  ('read_only_analyst', 'view_aggregate_metrics'),
  ('read_only_analyst', 'view_financial_metrics'),
  ('read_only_analyst', 'view_system_health');

-- ---------------------------------------------------------------------------
-- Append-only audit trail
-- ---------------------------------------------------------------------------

create table public.console_audit_events (
  id uuid primary key default gen_random_uuid(),
  -- No FK: the trail must outlive a deleted auth user.
  actor_user_id uuid,
  actor_role text,
  action text not null check (action ~ '^[a-z][a-z0-9_.]*$'),
  target_type text,
  target_id text,
  outcome text not null check (outcome in ('success', 'denied', 'failed')),
  reason text,
  correlation_id uuid not null default gen_random_uuid(),
  -- Never put passwords, tokens or customer financial payloads in here.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.console_audit_events is
  'Append-only audit trail for Platform Console activity. UPDATE/DELETE/TRUNCATE are rejected by trigger, including for service_role. Written only via console_record_audit() or by other console RPCs.';

create index idx_console_audit_events_created
  on public.console_audit_events (created_at desc);
create index idx_console_audit_events_actor
  on public.console_audit_events (actor_user_id, created_at desc);

create function public.console_audit_events_immutable()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  raise exception 'console_audit_events is append-only'
    using errcode = '42501';
end;
$$;
revoke all on function public.console_audit_events_immutable() from public;

create trigger console_audit_events_no_update_delete
  before update or delete on public.console_audit_events
  for each row execute function public.console_audit_events_immutable();
create trigger console_audit_events_no_truncate
  before truncate on public.console_audit_events
  for each statement execute function public.console_audit_events_immutable();

-- ---------------------------------------------------------------------------
-- Lock the tables down: RPC-only access.
-- ---------------------------------------------------------------------------

alter table public.console_staff enable row level security;
alter table public.console_role_permissions enable row level security;
alter table public.console_audit_events enable row level security;

revoke all on public.console_staff from anon, authenticated;
revoke all on public.console_role_permissions from anon, authenticated;
revoke all on public.console_audit_events from anon, authenticated;

grant select, insert, update, delete on public.console_staff to service_role;
grant select, insert, update, delete on public.console_role_permissions to service_role;
-- The audit trail is insert/select only, even for service_role. Default
-- privileges may already have granted ALL to service_role on a new public
-- table, and GRANT does not narrow that, so revoke first.
revoke all on public.console_audit_events from service_role;
grant select, insert on public.console_audit_events to service_role;

-- ---------------------------------------------------------------------------
-- Internal authorization helper (not callable by clients)
-- ---------------------------------------------------------------------------

-- Raises 42501 unless the caller is a signed-in, MFA-verified, ACTIVE staff
-- member holding p_permission. Returns the caller's role so callers can stamp
-- audit rows.
create function public.console_assert(p_permission text)
  returns text
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_status text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'mfa_required' using errcode = '42501';
  end if;

  select s.role, s.status into v_role, v_status
  from public.console_staff s where s.user_id = v_uid;

  if v_role is null or v_status <> 'active' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.console_role_permissions rp
    where rp.role = v_role and rp.permission = p_permission
  ) then
    -- Not audited here: the raise below rolls this statement's transaction
    -- back, so a row written now would vanish. The app records denials via
    -- console_record_audit(outcome => 'denied') after catching not_authorized.
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return v_role;
end;
$$;
revoke all on function public.console_assert(text) from public;

-- ---------------------------------------------------------------------------
-- Client RPCs
-- ---------------------------------------------------------------------------

-- Who am I in the console? Safe to call at aal1 so the app can route a staff
-- member to the MFA step; permissions are only disclosed at aal2.
create function public.console_my_access()
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
declare
  v_uid uuid := auth.uid();
  v_aal text := coalesce(auth.jwt() ->> 'aal', 'aal1');
  v_role text;
  v_status text;
begin
  if v_uid is null then
    return jsonb_build_object('signed_in', false);
  end if;

  select s.role, s.status into v_role, v_status
  from public.console_staff s where s.user_id = v_uid;

  if v_role is null or v_status <> 'active' then
    return jsonb_build_object('signed_in', true, 'is_staff', false);
  end if;

  if v_aal <> 'aal2' then
    return jsonb_build_object(
      'signed_in', true, 'is_staff', true, 'mfa_ok', false);
  end if;

  return jsonb_build_object(
    'signed_in', true,
    'is_staff', true,
    'mfa_ok', true,
    'role', v_role,
    'permissions', coalesce((
      select jsonb_agg(rp.permission order by rp.permission)
      from public.console_role_permissions rp where rp.role = v_role
    ), '[]'::jsonb)
  );
end;
$$;

-- Append an audit row as the signed-in staff member. The actor is always
-- derived from the session, never from an argument.
create function public.console_record_audit(
  p_action text,
  p_target_type text default null,
  p_target_id text default null,
  p_outcome text default 'success',
  p_reason text default null,
  p_correlation_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_id uuid;
begin
  -- Any active, MFA-verified staff member may record their own activity;
  -- no specific permission is needed to be audited.
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'mfa_required' using errcode = '42501';
  end if;
  select s.role into v_role from public.console_staff s
   where s.user_id = v_uid and s.status = 'active';
  if v_role is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  insert into public.console_audit_events
    (actor_user_id, actor_role, action, target_type, target_id,
     outcome, reason, correlation_id, metadata)
  values
    (v_uid, v_role, p_action, p_target_type, p_target_id,
     p_outcome, p_reason, coalesce(p_correlation_id, gen_random_uuid()),
     coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

-- Executive dashboard aggregates. Counts only; no customer financial data.
-- Definitions (also shown in the UI):
--   registrations   profiles created in the window (profiles.created_at)
--   active workspaces  distinct workspaces with >=1 transaction recorded
--                      (transactions.created_at) in the window
--   plan distribution  workspace_plans.plan as currently ASSIGNED. There is no
--                      subscription-billing source today, so this is not
--                      "paying subscribers".
create function public.console_dashboard_summary(p_days integer default 30)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 30), 365));
  v_end timestamptz := now();
  v_start timestamptz;
  v_prev_start timestamptz;
  v_result jsonb;
begin
  perform public.console_assert('view_aggregate_metrics');

  v_start := v_end - make_interval(days => v_days);
  v_prev_start := v_start - make_interval(days => v_days);

  select jsonb_build_object(
    'window_days', v_days,
    'generated_at', v_end,
    'registrations', jsonb_build_object(
      'current', (select count(*) from public.profiles
                   where created_at >= v_start and created_at < v_end),
      'previous', (select count(*) from public.profiles
                    where created_at >= v_prev_start and created_at < v_start),
      'total', (select count(*) from public.profiles),
      'suspended', (select count(*) from public.profiles
                     where status = 'suspended')
    ),
    'active_workspaces', jsonb_build_object(
      'current', (select count(distinct workspace_id) from public.transactions
                   where created_at >= v_start and created_at < v_end),
      'previous', (select count(distinct workspace_id) from public.transactions
                    where created_at >= v_prev_start and created_at < v_start),
      'total', (select count(*) from public.workspaces)
    ),
    'registrations_by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'count', coalesce(c.n, 0))
                       order by d.day)
      from (
        select gs::date as day
        from generate_series(
          (v_start at time zone 'Africa/Kigali')::date,
          (v_end at time zone 'Africa/Kigali')::date,
          interval '1 day') gs
      ) d
      left join (
        select (created_at at time zone 'Africa/Kigali')::date as day,
               count(*) as n
        from public.profiles
        where created_at >= v_start and created_at < v_end
        group by 1
      ) c on c.day = d.day
    ), '[]'::jsonb),
    'plan_distribution', coalesce((
      select jsonb_agg(jsonb_build_object('plan', t.plan, 'count', t.n)
                       order by t.n desc, t.plan)
      from (select plan, count(*) as n from public.workspace_plans group by plan) t
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- Recent platform activity. Registrations are shown with a masked customer id
-- (no name, email or contact detail). Admin actions are included only for
-- callers who may read the audit log.
create function public.console_activity_feed(p_limit integer default 25)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
  v_can_audit boolean;
  v_role text;
  v_result jsonb;
begin
  v_role := public.console_assert('view_aggregate_metrics');
  v_can_audit := exists (
    select 1 from public.console_role_permissions rp
    where rp.role = v_role and rp.permission = 'view_audit_logs');

  select coalesce(jsonb_agg(row_to_json(e) order by e.occurred_at desc), '[]'::jsonb)
  into v_result
  from (
    select * from (
      select
        p.created_at as occurred_at,
        'registration'::text as event_type,
        'New registration'::text as event,
        'Customers'::text as category,
        ('Customer ' || left(p.id::text, 8))::text as subject,
        case when p.status = 'suspended' then 'restricted' else 'completed' end
          as status,
        null::text as operator_role
      from public.profiles p
      union all
      select
        a.created_at,
        'admin_action',
        replace(a.action, '.', ' '),
        'Administration',
        coalesce(a.target_type || ' ' || left(a.target_id, 8), 'Console'),
        a.outcome,
        a.actor_role
      from public.console_audit_events a
      where v_can_audit
    ) u
    order by u.occurred_at desc
    limit v_limit
  ) e;

  return v_result;
end;
$$;

-- Paged audit log (newest first). Keyset pagination on created_at.
create function public.console_audit_log(
  p_limit integer default 50,
  p_before timestamptz default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_result jsonb;
begin
  perform public.console_assert('view_audit_logs');

  select coalesce(jsonb_agg(row_to_json(a) order by a.created_at desc), '[]'::jsonb)
  into v_result
  from (
    select id, created_at, actor_role, action, target_type, target_id,
           outcome, reason, correlation_id,
           left(actor_user_id::text, 8) as actor_ref
    from public.console_audit_events
    where p_before is null or created_at < p_before
    order by created_at desc
    limit v_limit
  ) a;
  return v_result;
end;
$$;

-- Read-only staff directory.
create function public.console_staff_list()
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
declare
  v_result jsonb;
begin
  perform public.console_assert('view_staff');

  select coalesce(jsonb_agg(row_to_json(s) order by s.created_at), '[]'::jsonb)
  into v_result
  from (
    select cs.user_id, u.email, cs.role, cs.status, cs.created_at
    from public.console_staff cs
    join auth.users u on u.id = cs.user_id
  ) s;
  return v_result;
end;
$$;

-- Aggregate operational-health snapshot (counts and ages only; see
-- 20261025000000). Re-exposed here behind a console permission instead of the
-- operator-secret route.
create function public.console_health_snapshot(p_window_minutes integer default 60)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
begin
  perform public.console_assert('view_system_health');
  return public.get_operational_health_snapshot(p_window_minutes);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'console_my_access()',
    'console_record_audit(text,text,text,text,text,uuid,jsonb)',
    'console_dashboard_summary(integer)',
    'console_activity_feed(integer)',
    'console_audit_log(integer,timestamptz)',
    'console_staff_list()',
    'console_health_snapshot(integer)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
