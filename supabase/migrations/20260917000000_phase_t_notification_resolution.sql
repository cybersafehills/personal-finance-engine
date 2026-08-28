-- Phase T (PR1): notification-preference resolution.
--
-- space_member_notification_prefs (Phase Q) already stores a member's
-- per-event/per-channel overrides with full authenticated CRUD. This
-- migration adds the read side the Phase V report/notification jobs will
-- call, plus the catalog the settings UI renders from:
--
--   should_notify(workspace, user, event_key, channel) -> boolean
--     - false for a non-member / former member (master prompt §41: a
--       notification is never delivered to someone without current access)
--     - true, unconditionally, for a security-notable event (§38: owner
--       transfer, member add/remove, sharing change - not silently
--       suppressible), on either channel
--     - otherwise the member's stored preference, or the event/channel
--       default when they have not set one
--
-- Additive: four functions, no table, no grant on any table. No behaviour
-- change until Phase V wires a delivery path to should_notify().

-- ===========================================================================
-- notification_event_is_security_notable: the §38 list. Pure/IMMUTABLE;
-- called only from should_notify() (SECURITY DEFINER), so no EXECUTE grant
-- of its own - same pattern as space_role_has_capability.
-- ===========================================================================

create or replace function public.notification_event_is_security_notable(
  p_event_key text
)
returns boolean
language sql
immutable
as $$
  select p_event_key in (
    'member.joined',
    'member.removed',
    'owner.transferred',
    'admin.added',
    'source.sharing_changed',
    'permission.changed',
    'integration.changed',
    'trusted_device.connected'
  );
$$;

comment on function public.notification_event_is_security_notable is
  'True for the master-prompt §38 security-notable events, which should_notify() always returns true for regardless of a member''s stored preference.';

revoke all on function public.notification_event_is_security_notable(text) from public;

-- ===========================================================================
-- notification_default_enabled: the fallback when a member has no stored
-- row for an event/channel. Pure/IMMUTABLE; internal to should_notify().
-- Unknown event -> in_app on, email off.
-- ===========================================================================

create or replace function public.notification_default_enabled(
  p_event_key text,
  p_channel text
)
returns boolean
language sql
immutable
as $$
  select case
    when public.notification_event_is_security_notable(p_event_key) then true
    when p_channel = 'in_app' then p_event_key in (
      'transaction.large', 'budget.threshold_90', 'budget.exceeded',
      'goal.contribution'
    )
    when p_channel = 'email' then p_event_key in (
      'budget.exceeded', 'report.weekly', 'report.monthly'
    )
    else false
  end;
$$;

comment on function public.notification_default_enabled is
  'Default enabled state for an event/channel when a member has set no preference. Internal to should_notify().';

revoke all on function public.notification_default_enabled(text, text) from public;

-- ===========================================================================
-- should_notify: the primitive the delivery layer composes with.
-- SECURITY DEFINER / STABLE, mirroring is_workspace_member().
-- ===========================================================================

create or replace function public.should_notify(
  p_workspace_id uuid,
  p_user_id uuid,
  p_event_key text,
  p_channel text
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    exists (
      select 1 from public.workspace_memberships m
      where m.workspace_id = p_workspace_id
        and m.user_id = p_user_id
        and m.status = 'active'
    )
    and (
      public.notification_event_is_security_notable(p_event_key)
      or coalesce(
        (
          select np.enabled
          from public.space_member_notification_prefs np
          where np.workspace_id = p_workspace_id
            and np.user_id = p_user_id
            and np.event_key = p_event_key
            and np.channel = p_channel
        ),
        public.notification_default_enabled(p_event_key, p_channel)
      )
    );
$$;

comment on function public.should_notify is
  'Should p_user_id be notified about p_event_key on p_channel for workspace p_workspace_id. False for a non-member/former member; true unconditionally for a security-notable event; otherwise the member''s stored preference or the event/channel default. SECURITY DEFINER + STABLE.';

revoke all on function public.should_notify(uuid, uuid, text, text) from public;
grant execute on function public.should_notify(uuid, uuid, text, text)
  to authenticated, service_role;

-- ===========================================================================
-- notification_event_catalog: what the settings UI renders its toggle
-- list from. Defaults inlined here (not via the IMMUTABLE helpers) so this
-- function needs no nested EXECUTE grants when run as the calling role.
-- ===========================================================================

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
      ('report.daily',            'Daily summary',                false, false, false)
  ) as c(event_key, label, default_in_app, default_email, security_notable);
$$;

comment on function public.notification_event_catalog is
  'The notification events a member can configure per Space, with defaults and which are security-notable (always on). Source of truth for the settings UI.';

revoke all on function public.notification_event_catalog() from public;
grant execute on function public.notification_event_catalog() to authenticated, service_role;
