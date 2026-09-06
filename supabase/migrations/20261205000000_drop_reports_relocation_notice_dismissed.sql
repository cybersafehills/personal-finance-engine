-- Drop ui_preferences.reports_relocation_notice_dismissed.
--
-- This column backed the one-time "Reports moved to the header"
-- discovery banner (ReportsRelocationNotice, added in Phase L -
-- 20260904000000_phase_l_ui_preferences.sql). The onboarding UX-polish
-- work removed that banner entirely - the first-run flow is now a single
-- linear wizard - so the component, its AppShell mount, the layout
-- pass-through, and the dismissReportsRelocationNotice() server action
-- are all gone. Nothing reads or writes this column any more.
--
-- Pure display state, never an authorization/report/export input (same
-- as every other column on this table). Dropping it needs no backfill
-- and no data migration - existing values were only ever "has this user
-- seen a banner that no longer exists".

alter table public.ui_preferences
  drop column if exists reports_relocation_notice_dismissed;

-- RLS, grants, and the set_updated_at trigger are table-level (Phase L
-- migration) - dropping a column leaves them intact, so there is nothing
-- else to do here.
