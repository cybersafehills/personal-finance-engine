-- Integrations Phase 1, PR 2: private storage bucket for uploaded import
-- source files.
--
-- Same model as the Phase K report-artifacts bucket
-- (20260903000000_phase_k_report_artifacts.sql): public = false is the
-- real boundary, and there are deliberately NO storage.objects RLS
-- policies for anon/authenticated - RLS-enabled-with-no-matching-policy
-- denies them entirely. Every read/write goes through the service-role
-- client in web/lib/integrations (uploadImportFile / the PR2 profiler),
-- which first verifies the caller holds `integration.import` in the
-- target workspace and always keys objects under
--   {workspace_id}/{import_batch_id}/{sanitized_filename}
-- so a batch's evidence file is namespaced to its Space.

insert into storage.buckets (id, name, public)
values ('integration-imports', 'integration-imports', false)
on conflict (id) do nothing;
