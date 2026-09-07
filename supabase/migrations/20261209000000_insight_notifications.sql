-- Insight glimpse: a disappearing top-of-screen banner when the Release-6
-- cash-flow forecast picture meaningfully changes, ALSO logged to the
-- Notifications history.
--
-- Insights are derived (never stored), so there is no DB event to hang a
-- notification off. Instead the web layout, on a page load where
-- Intelligence is enabled, computes a bucketed "signature" of the salient
-- forecast facts and calls note_insight_change(). That RPC persists the
-- last-seen signature per (user, workspace), and when it changes - at most
-- once every 12h - enqueues one 'insight.forecast_update' notification and
-- returns true so the client shows the ephemeral banner for that render.

-- ---------------------------------------------------------------------------
-- 1. Catalog: register the new event so should_notify() stops failing it
--    closed. In-app on by default, email off, not security-notable
--    (mutable in the per-Space notification settings).
-- ---------------------------------------------------------------------------
create or replace function public.notification_event_catalog()
returns table (
  event_key text,
  label text,
  default_in_app boolean,
  default_email boolean,
  security_notable boolean
)
language sql
stable
as $$
  select *
  from (
    values
      ('transaction.large',       'Large transactions',           true,  false, false),
      ('budget.threshold_75',     'A budget reaches 75%',         false, false, false),
      ('budget.threshold_90',     'A budget reaches 90%',         true,  false, false),
      ('budget.exceeded',         'A budget is exceeded',         true,  true,  false),
      ('goal.contribution',       'A goal contribution is added', true,  false, false),
      ('member.joined',           'A member joins',               true,  true,  true),
      ('member.removed',          'A member is removed',          true,  true,  true),
      ('owner.transferred',       'Ownership is transferred',     true,  true,  true),
      ('source.sharing_changed',  'An account''s sharing changes', true, true,  true),
      ('report.weekly',           'Weekly summary',               false, true,  false),
      ('report.monthly',          'Monthly report',               false, true,  false),
      ('report.daily',            'Daily summary',                false, false, false),
      ('insight.forecast_update', 'Forecast & spending insights', true,  false, false)
  ) as c(event_key, label, default_in_app, default_email, security_notable);
$$;

-- ---------------------------------------------------------------------------
-- 2. Per (user, workspace) last-seen insight state - global de-dupe (not
--    per-device) + the 12h rate-limit clock.
-- ---------------------------------------------------------------------------
create table public.user_insight_state (
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  last_signature text,
  last_notified_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, workspace_id)
);

comment on table public.user_insight_state is
  'Last insight signature the user has been shown per workspace, and when they were last notified - drives note_insight_change() de-dupe + rate limit. One row per (user, workspace); the user only ever reads/writes their own via the RPC.';

alter table public.user_insight_state enable row level security;

create policy user_insight_state_select_own on public.user_insight_state
  for select to authenticated
  using (user_id = auth.uid());

revoke all on public.user_insight_state from anon;
grant select on public.user_insight_state to authenticated;
grant select, insert, update, delete on public.user_insight_state to service_role;

-- ---------------------------------------------------------------------------
-- 3. note_insight_change: record the signature; if it changed and the 12h
--    window has elapsed, enqueue one notification for the caller and
--    return true (→ show the ephemeral banner). Otherwise return false.
-- ---------------------------------------------------------------------------
create or replace function public.note_insight_change(
  p_workspace_id uuid,
  p_signature text,
  p_headline text,
  p_body text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev record;
  v_changed boolean;
  v_notify boolean;
begin
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'not_found_or_forbidden';
  end if;

  select last_signature, last_notified_at
    into v_prev
  from public.user_insight_state
  where user_id = auth.uid() and workspace_id = p_workspace_id;

  v_changed := (v_prev.last_signature is distinct from p_signature);

  if not v_changed then
    return false;
  end if;

  v_notify := (v_prev.last_notified_at is null
               or v_prev.last_notified_at < now() - interval '12 hours');

  insert into public.user_insight_state
    (user_id, workspace_id, last_signature, last_notified_at, updated_at)
  values
    (auth.uid(), p_workspace_id, p_signature,
     case when v_notify then now() else v_prev.last_notified_at end, now())
  on conflict (user_id, workspace_id) do update
    set last_signature = excluded.last_signature,
        last_notified_at = case when v_notify then now()
                                else public.user_insight_state.last_notified_at end,
        updated_at = now();

  if v_notify then
    perform public.enqueue_notification(
      p_workspace_id,
      array[auth.uid()],
      null,
      'insight.forecast_update',
      p_headline,
      p_body,
      'forecast',
      null,
      '{}'::jsonb
    );
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.note_insight_change(uuid, text, text, text) from public;
grant execute on function public.note_insight_change(uuid, text, text, text) to authenticated;
