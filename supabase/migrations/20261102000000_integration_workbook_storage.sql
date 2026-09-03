-- Integrations Phase 2, P2-PR4: private storage bucket for the
-- `manual_file` connected-workbook mode.
--
-- Same model as integration-imports / integration-exports (public =
-- false, service-role only, no storage.objects policies). A manual_file
-- workbook is a single stored .xlsx at
--   {workspace_id}/{connected_workbook_id}.xlsx
-- rewritten on every sync and handed to the user as a short-lived signed
-- URL from GET /api/integrations/workbooks/[id]. Real spreadsheet
-- providers (Google Sheets / Excel 365) never touch this bucket.

insert into storage.buckets (id, name, public)
values ('integration-workbooks', 'integration-workbooks', false)
on conflict (id) do nothing;
