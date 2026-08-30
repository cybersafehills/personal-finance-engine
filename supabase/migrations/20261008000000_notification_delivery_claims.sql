-- Phase 0 hardening: make notification email delivery concurrency-safe.
-- Claims are short leases: one worker owns a row at a time, a crashed
-- worker's rows become eligible again, and only the owning token can ack.

alter table public.notifications
  add column delivery_claim_token uuid,
  add column delivery_claimed_at timestamptz,
  add column delivery_attempts integer not null default 0
    check (delivery_attempts >= 0),
  add column last_delivery_error text,
  add constraint notifications_delivery_claim_consistent check (
    (delivery_claim_token is null and delivery_claimed_at is null)
    or (delivery_claim_token is not null and delivery_claimed_at is not null)
  );

create index idx_notifications_email_claimable
  on public.notifications (created_at)
  where channel = 'email' and delivered_at is null;

create or replace function public.claim_notification_emails(
  p_claim_token uuid,
  p_limit integer default 50,
  p_lease_seconds integer default 300
)
returns table (id uuid, email text, title text, body text)
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
    join auth.users u on u.id = n.user_id
    where n.channel = 'email'
      and n.delivered_at is null
      and u.email is not null
      and (
        n.delivery_claim_token is null
        or n.delivery_claimed_at < now() - make_interval(
          secs => greatest(30, least(coalesce(p_lease_seconds, 300), 3600))
        )
      )
    order by n.created_at
    for update of n skip locked
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  ), claimed as (
    update public.notifications n
    set delivery_claim_token = p_claim_token,
        delivery_claimed_at = now(),
        delivery_attempts = n.delivery_attempts + 1,
        last_delivery_error = null
    from candidates c
    where n.id = c.id
    returning n.id, n.user_id, n.title, n.body
  )
  select c.id, u.email::text, c.title, c.body
  from claimed c
  join auth.users u on u.id = c.user_id;
end;
$$;

comment on function public.claim_notification_emails(uuid, integer, integer) is
  'Service-role only: atomically lease pending email notifications using FOR UPDATE SKIP LOCKED. Expired leases are retryable.';
revoke all on function public.claim_notification_emails(uuid, integer, integer) from public;
grant execute on function public.claim_notification_emails(uuid, integer, integer) to service_role;

create or replace function public.ack_notification_email_claim(
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
    set delivered_at = now(), delivery_claim_token = null,
        delivery_claimed_at = null, last_delivery_error = null
    where channel = 'email' and delivered_at is null
      and delivery_claim_token = p_claim_token
      and id = any (coalesce(p_ids, array[]::uuid[]))
    returning 1
  )
  select count(*) into v_count from updated;
  return v_count;
end;
$$;

comment on function public.ack_notification_email_claim(uuid, uuid[]) is
  'Service-role only: mark sent rows delivered only when the caller owns their claim.';
revoke all on function public.ack_notification_email_claim(uuid, uuid[]) from public;
grant execute on function public.ack_notification_email_claim(uuid, uuid[]) to service_role;

create or replace function public.release_notification_email_claim(
  p_claim_token uuid,
  p_ids uuid[],
  p_error text default null
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
    set delivery_claim_token = null, delivery_claimed_at = null,
        last_delivery_error = left(nullif(trim(coalesce(p_error, '')), ''), 500)
    where channel = 'email' and delivered_at is null
      and delivery_claim_token = p_claim_token
      and id = any (coalesce(p_ids, array[]::uuid[]))
    returning 1
  )
  select count(*) into v_count from updated;
  return v_count;
end;
$$;

comment on function public.release_notification_email_claim(uuid, uuid[], text) is
  'Service-role only: release failed rows owned by one claim and retain a bounded diagnostic.';
revoke all on function public.release_notification_email_claim(uuid, uuid[], text) from public;
grant execute on function public.release_notification_email_claim(uuid, uuid[], text) to service_role;

-- Retire the race-prone read/ack API. Deployment must update the Edge
-- Function from this commit immediately after applying this migration.
revoke execute on function public.pending_notification_emails(integer) from service_role;
revoke execute on function public.mark_notification_emails_delivered(uuid[]) from service_role;
