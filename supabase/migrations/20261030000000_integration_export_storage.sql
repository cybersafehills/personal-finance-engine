-- Integrations Phase 1, PR 5: private storage bucket for generated export
-- files.
--
-- Same model as integration-imports / the Phase K report-artifacts
-- bucket: public = false, no storage.objects RLS policies. Every read and
-- write goes through the service-role client (the createExportJob action
-- and the run-export-jobs cron), which resolves the workspace explicitly
-- and always keys objects under
--   {workspace_id}/{export_job_id}/{filename}
-- Downloads are handed to the user only as a short-lived signed URL from
-- GET /api/integrations/exports/[id]; the file is never a public object.

insert into storage.buckets (id, name, public)
values ('integration-exports', 'integration-exports', false)
on conflict (id) do nothing;
