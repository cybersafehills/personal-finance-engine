-- Mobile push notifications (ADR 0019 section 8, mobile app PR 7).
--
-- Push is a second DELIVERY of the existing in-app notification rows, not a
-- new channel: every row already passed should_notify(..., 'in_app'), so a
-- user who silenced an event in-app is not pushed for it either, and no
-- preference surface changes. This migration adds:
--   1. push_devices: the Expo push tokens a user's phones registered.
--   2. push delivery bookkeeping on notifications (claim / lease / sent),
--      mirroring the email outbox claims in 20261008000000.
--   3. the authenticated register/unregister RPCs and the service-role
--      claim/ack/release RPCs used by the send-push-notifications function.
--
-- Additive and inert until a phone registers a token AND the Edge Function
-- runs with PUSH_NOTIFICATIONS_ENABLED=true.

-- ===========================================================================
-- push_devices
-- ===========================================================================
create table public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- An Expo push token identifies one app install on one device.
  expo_push_token text not null unique
    check (expo_push_token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$'),
  platform text not null check (platform in ('android', 'ios')),
  -- Also the "not before" bound for delivery: a phone is never sent
  -- notifications created before it registered (see the claim function).
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Set when the push service reports the token is dead (app uninstalled).
  disabled_at timestamptz,
  disabled_reason text
);

comment on table public.push_devices is
  'Expo push tokens registered by the mobile app, one row per app install. Written only through register_push_device / unregister_push_device (authenticated, own rows) and disable_push_devices (service role). authenticated may only SELECT its own rows.';

create index idx_push_devices_user_active
  on public.push_devices (user_id)
  where disabled_at is null;

alter table public.push_devices enable row level security;

create policy push_devices_select_own on public.push_devices
  for select to authenticated
  using (user_id = auth.uid());

revoke all on public.push_devices from anon, authenticated;
grant select on public.push_devices to authenticated;
grant select, insert, update, delete on public.push_devices to service_role;

-- ===========================================================================
-- register_push_device / unregister_push_device (authenticated, own rows)
-- ===========================================================================
create or replace function public.register_push_device(
  p_token text,
  p_platform text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  if p_token is null
    or p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$' then
    raise exception 'Push token is invalid.' using errcode = '22023';
  end if;
  if p_platform is null or p_platform not in ('android', 'ios') then
    raise exception 'Platform is invalid.' using errcode = '22023';
  end if;

  insert into public.push_devices as d (user_id, expo_push_token, platform)
  values (v_uid, p_token, p_platform)
  on conflict (expo_push_token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        last_seen_at = now(),
        disabled_at = null,
        disabled_reason = null,
        -- A token that moves to a different account (someone else signed in
        -- on the same phone) starts fresh, so the new owner is never sent
        -- anything from before they registered.
        created_at = case
          when d.user_id <> excluded.user_id then now()
          else d.created_at
        end
  returning d.id into v_id;

  -- Bound the rows one account can hold: keep the 10 most recently seen.
  delete from public.push_devices x
  where x.user_id = v_uid
    and x.id not in (
      select k.id
      from public.push_devices k
      where k.user_id = v_uid
      order by k.last_seen_at desc, k.id
      limit 10
    );

  return v_id;
end;
$$;

comment on function public.register_push_device(text, text) is
  'Authenticated: register (or refresh) this app install''s Expo push token for the caller. Idempotent on the token; a token re-registered by a different user is reassigned to them.';
revoke all on function public.register_push_device(text, text) from public;
grant execute on function public.register_push_device(text, text) to authenticated;

create or replace function public.unregister_push_device(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.push_devices
  where expo_push_token = p_token
    and user_id = auth.uid();
$$;

comment on function public.unregister_push_device(text) is
  'Authenticated: remove the caller''s own push token (sign-out, or notifications turned off).';
revoke all on function public.unregister_push_device(text) from public;
grant execute on function public.unregister_push_device(text) to authenticated;

-- ===========================================================================
-- Push delivery bookkeeping on in_app notification rows
-- ===========================================================================
alter table public.notifications
  add column push_claim_token uuid,
  add column push_claimed_at timestamptz,
  add column push_attempts integer not null default 0
    check (push_attempts >= 0),
  -- When the push for this in_app row was handed to the push service.
  add column push_sent_at timestamptz,
  add constraint notifications_push_claim_consistent check (
    (push_claim_token is null and push_claimed_at is null)
    or (push_claim_token is not null and push_claimed_at is not null)
  );

create index idx_notifications_push_claimable
  on public.notifications (created_at)
  where channel = 'in_app' and push_sent_at is null and read_at is null;

-- ===========================================================================
-- claim / ack / release (service role only)
-- ===========================================================================
create or replace function public.claim_notification_pushes(
  p_claim_token uuid,
  p_limit integer default 50,
  p_lease_seconds integer default 300
)
returns table (
  id uuid,
  title text,
  body text,
  event_key text,
  resource_type text,
  resource_id uuid,
  tokens text[]
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_claim_token is null then
    raise exception 'A claim token is required.';
  end if;

  return query
  with candidates as (
    select n.id
    from public.notifications n
    where n.channel = 'in_app'
      and n.push_sent_at is null
      -- Already read in the app: a push would be noise.
      and n.read_at is null
      -- Stale news is not pushed (also bounds the scan).
      and n.created_at > now() - interval '24 hours'
      -- Give up on a row the push service keeps failing.
      and n.push_attempts < 5
      and exists (
        select 1
        from public.push_devices d
        where d.user_id = n.user_id
          and d.disabled_at is null
          and d.created_at <= n.created_at
      )
      and (
        n.push_claim_token is null
        or n.push_claimed_at < now() - make_interval(
          secs => greatest(30, least(coalesce(p_lease_seconds, 300), 3600))
        )
      )
    order by n.created_at
    for update of n skip locked
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  ), claimed as (
    update public.notifications n
    set push_claim_token = p_claim_token,
        push_claimed_at = now(),
        push_attempts = n.push_attempts + 1
    from candidates c
    where n.id = c.id
    returning n.id, n.user_id, n.title, n.body, n.event_key,
      n.resource_type, n.resource_id, n.created_at
  )
  select
    c.id,
    c.title,
    c.body,
    c.event_key,
    c.resource_type,
    c.resource_id,
    coalesce(
      (
        select array_agg(d.expo_push_token order by d.last_seen_at desc)
        from public.push_devices d
        where d.user_id = c.user_id
          and d.disabled_at is null
          and d.created_at <= c.created_at
      ),
      array[]::text[]
    )
  from claimed c;
end;
$$;

comment on function public.claim_notification_pushes(uuid, integer, integer) is
  'Service-role only: atomically lease unread in_app notifications (last 24h) whose user has an active push device registered before the notification, with the tokens to send to. FOR UPDATE SKIP LOCKED; expired leases are retryable; a row is abandoned after 5 attempts.';
revoke all on function public.claim_notification_pushes(uuid, integer, integer) from public;
grant execute on function public.claim_notification_pushes(uuid, integer, integer) to service_role;

create or replace function public.ack_notification_push_claim(
  p_claim_token uuid,
  p_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  with updated as (
    update public.notifications
    set push_sent_at = now(), push_claim_token = null, push_claimed_at = null
    where channel = 'in_app' and push_sent_at is null
      and push_claim_token = p_claim_token
      and id = any (coalesce(p_ids, array[]::uuid[]))
    returning 1
  )
  select count(*) into v_count from updated;
  return v_count;
end;
$$;

comment on function public.ack_notification_push_claim(uuid, uuid[]) is
  'Service-role only: mark rows pushed, only when the caller owns their claim.';
revoke all on function public.ack_notification_push_claim(uuid, uuid[]) from public;
grant execute on function public.ack_notification_push_claim(uuid, uuid[]) to service_role;

create or replace function public.release_notification_push_claim(
  p_claim_token uuid,
  p_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  with updated as (
    update public.notifications
    set push_claim_token = null, push_claimed_at = null
    where channel = 'in_app' and push_sent_at is null
      and push_claim_token = p_claim_token
      and id = any (coalesce(p_ids, array[]::uuid[]))
    returning 1
  )
  select count(*) into v_count from updated;
  return v_count;
end;
$$;

comment on function public.release_notification_push_claim(uuid, uuid[]) is
  'Service-role only: release failed rows owned by one claim so a later run retries them (bounded by push_attempts).';
revoke all on function public.release_notification_push_claim(uuid, uuid[]) from public;
grant execute on function public.release_notification_push_claim(uuid, uuid[]) to service_role;

create or replace function public.disable_push_devices(
  p_tokens text[],
  p_reason text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  with updated as (
    update public.push_devices
    set disabled_at = now(),
        disabled_reason = left(nullif(trim(coalesce(p_reason, '')), ''), 200)
    where disabled_at is null
      and expo_push_token = any (coalesce(p_tokens, array[]::text[]))
    returning 1
  )
  select count(*) into v_count from updated;
  return v_count;
end;
$$;

comment on function public.disable_push_devices(text[], text) is
  'Service-role only: stop sending to tokens the push service reports as dead (e.g. DeviceNotRegistered). The app re-enables its token the next time it registers.';
revoke all on function public.disable_push_devices(text[], text) from public;
grant execute on function public.disable_push_devices(text[], text) to service_role;
