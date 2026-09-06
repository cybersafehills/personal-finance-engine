-- Account deletion request + 30-day grace window (ADR 0016 / master
-- prompt sections 94-95, audit F12). Ships dark behind
-- ACCOUNT_DELETION_ENABLED.
--
-- Scope of THIS migration: the *request* side only. A user schedules
-- deletion of their own account, gets a 30-day grace window, and can
-- cancel any time before it. The irreversible erasure
-- (execute_account_deletion + a cron that calls it) is a deliberately
-- separate follow-up - ADR 0016 carries the full inventory of
-- auth.users-referencing foreign keys that erasure must null or delete
-- before it can drop the auth.users row (most are plain NO ACTION FKs,
-- so a naive `delete from auth.users` fails).
--
-- Guardrail (assessment section 7): account deletion and data export are
-- NEVER behind a plan.

create table public.account_deletion_requests (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'cancelled', 'completed')),
  reason text,
  requested_at timestamptz not null default now(),
  scheduled_for timestamptz not null,
  cancelled_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint account_deletion_requests_status_timestamps check (
    (status = 'scheduled' and cancelled_at is null and completed_at is null)
    or (status = 'cancelled' and cancelled_at is not null)
    or (status = 'completed' and completed_at is not null)
  )
);

comment on table public.account_deletion_requests is
  'One row per user who has scheduled deletion of their own account. status=scheduled with scheduled_for = requested_at + 30 days; the owner can cancel_account_deletion() until then. The actual erasure (execute_account_deletion) is a separate follow-up and is what flips this to completed. Never plan-gated (assessment section 7).';

create trigger set_account_deletion_requests_updated_at
  before update on public.account_deletion_requests
  for each row execute function public.set_updated_at();

alter table public.account_deletion_requests enable row level security;

-- The owner reads their own request; every write goes through the RPCs
-- below (SECURITY DEFINER, auth.uid()-scoped) or service_role.
create policy account_deletion_requests_select_own
  on public.account_deletion_requests
  for select to authenticated
  using (user_id = auth.uid());

grant select on public.account_deletion_requests to authenticated;
grant select, insert, update, delete
  on public.account_deletion_requests to service_role;

-- request_account_deletion: schedule deletion of the caller's own
-- account, 30 days out. Idempotent - re-requesting resets the window.
-- Blocked while the caller is the SOLE owner of a shared Space that still
-- has other active members: erasing their account would orphan a ledger
-- other people depend on, so they must transfer ownership or remove those
-- members first. A solo household/organization, and their personal Space,
-- are fine.
create or replace function public.request_account_deletion(
  p_reason text default null
)
  returns public.account_deletion_requests
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_blocking int;
  v_row public.account_deletion_requests;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select count(*)
    into v_blocking
  from public.workspaces w
  where w.kind <> 'personal'
    and exists (
      select 1 from public.workspace_memberships m
      where m.workspace_id = w.id
        and m.user_id = v_uid
        and m.role = 'owner'
        and m.status = 'active'
    )
    and (
      select count(*) from public.workspace_memberships m2
      where m2.workspace_id = w.id and m2.status = 'active'
    ) > 1
    and (
      select count(*) from public.workspace_memberships m3
      where m3.workspace_id = w.id
        and m3.role = 'owner'
        and m3.status = 'active'
    ) = 1;

  if v_blocking > 0 then
    raise exception
      'Transfer ownership or remove the other members of your shared Spaces before deleting your account'
      using errcode = 'P0001';
  end if;

  insert into public.account_deletion_requests (user_id, reason, scheduled_for)
  values (v_uid, nullif(btrim(p_reason), ''), now() + interval '30 days')
  on conflict (user_id) do update
    set status = 'scheduled',
        reason = excluded.reason,
        requested_at = now(),
        scheduled_for = now() + interval '30 days',
        cancelled_at = null,
        completed_at = null
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.request_account_deletion is
  'Schedule deletion of the caller''s own account 30 days out. Idempotent. Raises P0001 if the caller solely owns a shared Space with other active members.';

revoke all on function public.request_account_deletion(text) from public;
grant execute on function public.request_account_deletion(text) to authenticated;

-- cancel_account_deletion: withdraw a still-scheduled request.
create or replace function public.cancel_account_deletion()
  returns public.account_deletion_requests
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.account_deletion_requests;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  update public.account_deletion_requests
    set status = 'cancelled', cancelled_at = now()
  where user_id = v_uid and status = 'scheduled'
  returning * into v_row;

  if v_row.user_id is null then
    raise exception 'No scheduled deletion to cancel' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

comment on function public.cancel_account_deletion is
  'Withdraw the caller''s still-scheduled account deletion. Raises P0002 if there is nothing scheduled.';

revoke all on function public.cancel_account_deletion() from public;
grant execute on function public.cancel_account_deletion() to authenticated;
