-- Phase K: report_artifacts table + a private Supabase Storage bucket for
-- generated PDF reports (master-prompt Phase H, deliberately deferred out
-- of the original Phase J reporting-foundation migration - see that
-- migration's own header comment - until PDF generation was actually
-- being built).
--
-- Lazily generated, not persisted at report-generation time: a PDF is
-- rendered on first request (app/api/reports/[id]/pdf/route.ts) and
-- cached here/in storage from then on, rather than every daily report
-- unconditionally producing a PDF nobody may ever download.
--
-- Unlike report_runs/report_deliveries/report_preferences,
-- report_artifacts grants NOTHING to authenticated/anon - not even
-- select. The PDF route confirms report ownership through the EXISTING
-- report_runs RLS (getReportRunById, session-scoped) first, then does
-- every report_artifacts/storage operation with the service-role client.
-- The browser never queries this table directly; it only ever receives a
-- short-lived signed download URL (master prompt §27) from that route.
-- This mirrors the same "explicit service-role scoping IS the security
-- boundary" pattern report-generation.ts/report-delivery.ts already use.

create table public.report_artifacts (
  id uuid primary key default gen_random_uuid(),
  report_run_id uuid not null references public.report_runs (id) on delete cascade,
  format text not null default 'pdf' check (format in ('pdf')),
  storage_path text not null,
  mime_type text not null default 'application/pdf',
  byte_size bigint not null check (byte_size > 0),
  checksum text,
  template_version integer not null default 1,
  created_at timestamptz not null default now(),
  -- One artifact per (report, format) - a re-request reuses the existing
  -- object rather than rendering and storing a duplicate.
  constraint report_artifacts_unique_format unique (report_run_id, format)
);

comment on table public.report_artifacts is
  'Metadata for a generated report document (currently PDF only), lazily rendered on first download request and cached from then on. storage_path is relative to the private "report-artifacts" bucket - never a public URL. No authenticated/anon grants at all; see this migration''s header comment.';

create index idx_report_artifacts_report_run on public.report_artifacts (report_run_id);

alter table public.report_artifacts enable row level security;

revoke all on public.report_artifacts from anon;
revoke all on public.report_artifacts from authenticated;
grant select, insert, update, delete on public.report_artifacts to service_role;

-- ===========================================================================
-- Private storage bucket. public = false is what actually prevents
-- unauthenticated access to any object in it - every download in this
-- application goes through a short-lived signed URL the PDF route issues
-- after independently verifying report ownership. No storage.objects RLS
-- policies are added for anon/authenticated: the default (RLS enabled,
-- no matching policy) already denies them entirely, and service_role
-- bypasses RLS the same way it does for every other table here.
-- ===========================================================================

insert into storage.buckets (id, name, public)
values ('report-artifacts', 'report-artifacts', false)
on conflict (id) do nothing;
