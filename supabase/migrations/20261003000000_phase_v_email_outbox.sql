-- Phase V (PR3): the email-outbox read/ack surface for the
-- send-notifications edge function.
--
-- Phase V PR1's enqueue_notification writes channel='email' rows with
-- delivered_at = null. This adds the two service-role-only RPCs the
-- drainer needs: one to pull a batch (joined to the recipient's email in
-- auth.users, which the edge function can't read directly through
-- PostgREST), one to ack a batch. No authenticated surface, no new table.

create or replace function public.pending_notification_emails(
  p_limit integer default 50
)
returns table (
  id uuid,
  email text,
  title text,
  body text
)
language sql
security definer
set search_path = public
stable
as $$
  select n.id, u.email::text, n.title, n.body
  from public.notifications n
  join auth.users u on u.id = n.user_id
  where n.channel = 'email'
    and n.delivered_at is null
    and u.email is not null
  order by n.created_at
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

comment on function public.pending_notification_emails is
  'Service-role only: the oldest unsent channel=''email'' notifications joined to the recipient''s auth.users email, for the send-notifications edge function.';

revoke all on function public.pending_notification_emails(integer) from public;
grant execute on function public.pending_notification_emails(integer) to service_role;

create or replace function public.mark_notification_emails_delivered(
  p_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with updated as (
    update public.notifications
    set delivered_at = now()
    where channel = 'email'
      and delivered_at is null
      and id = any (coalesce(p_ids, array[]::uuid[]))
    returning 1
  )
  select count(*) into v_count from updated;
  return v_count;
end;
$$;

comment on function public.mark_notification_emails_delivered is
  'Service-role only: stamp delivered_at on the given channel=''email'' notification rows after the edge function has sent them. Returns the number stamped.';

revoke all on function public.mark_notification_emails_delivered(uuid[]) from public;
grant execute on function public.mark_notification_emails_delivered(uuid[]) to service_role;
