-- Per-user toggle for the header inbox icon's count badge.
--
-- The "Needs attention" summary moves off Home into the Inbox console;
-- the header inbox icon gains a small count badge (unread notifications +
-- open attention items). This lets a user turn that badge off while the
-- count stays visible inside the Inbox itself.
--
-- Additive, mirrors 20261006000000_onboarding_checklist_dismissed.sql:
-- one nullable-with-default boolean column on the existing per-user
-- ui_preferences row. No RLS / grant / policy change.

alter table public.ui_preferences
  add column if not exists show_inbox_badge boolean not null default true;

comment on column public.ui_preferences.show_inbox_badge is
  'Whether the header inbox icon shows its count badge. Default true; the count is still visible inside /inbox when off.';
