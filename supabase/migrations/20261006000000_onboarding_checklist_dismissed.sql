-- Onboarding work PR4: persistence for the "finish setting up" checklist.
--
-- The checklist derives its step *completion* live (email confirmed, an
-- account exists, a connection exists, a connection has received a
-- message - see web/lib/onboarding.ts). The only thing that needs
-- storing is whether the user has dismissed the reminder, so a new
-- one-time-notice boolean on ui_preferences is the whole change - the
-- same shape and purpose as reports_relocation_notice_dismissed already
-- on this table (Phase L).
--
-- Per (workspace_id, user_id), like the rest of ui_preferences: in a
-- shared Space each member runs through their own device setup, so each
-- dismisses their own reminder. Purely a UI notice - never read by any
-- authorization, report, or export path.

alter table public.ui_preferences
  add column onboarding_dismissed boolean not null default false;

comment on column public.ui_preferences.onboarding_dismissed is
  'Whether the user has dismissed the "finish setting up" onboarding checklist reminder in this workspace. One-time UI notice only (see reports_relocation_notice_dismissed); step completion itself is derived live, not stored.';

-- RLS, grants, and the set_updated_at trigger already cover every column
-- on this table (Phase L migration) - an added column inherits them, so
-- there is nothing else to do here.
