-- Provider-original-document management (master prompt section 16). A
-- OneLedger Statement is generated FROM the ledger; this table instead
-- stores the *original* PDF/CSV a bank or wallet issued, uploaded by a
-- member and kept verbatim alongside the generated ones on
-- /reports/statements. It is never parsed here (ingestion of uploaded
-- statements INTO the ledger is a separate feature, lib/statement-import.ts)
-- and never modified - it is an evidence record.
--
-- Storage posture mirrors statement_artifacts (20261210000000): a PRIVATE
-- bucket, no anon/authenticated storage policy, every upload/download done
-- by the service-role client in a server action AFTER an explicit
-- workspace-membership check. authenticated gets SELECT on the metadata
-- row only (the page lists them); insert + delete flow through
-- lib/provider-statements.ts so the row and the stored object never drift.

create table public.provider_statements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  uploaded_by uuid references auth.users (id) on delete set null,
  -- Which OneLedger account this provider document belongs to, if known.
  -- Not required (a user may upload before linking an account).
  financial_source_id uuid references public.financial_sources (id) on delete set null,

  -- Free-text provider label as the user entered / confirmed it
  -- ("MTN MoMo", "Bank of Kigali"). Not a controlled slug.
  provider text not null check (char_length(provider) between 1 and 80),
  -- The document's own coverage dates, as read off the PDF by the user.
  period_start date,
  period_end date,
  constraint provider_statements_period_order
    check (period_start is null or period_end is null or period_start <= period_end),

  original_filename text not null
    check (char_length(original_filename) between 1 and 255),
  -- Relative to the private "provider-statements" bucket - never public.
  storage_path text not null,
  mime_type text not null default 'application/pdf',
  byte_size bigint not null check (byte_size > 0),
  -- sha256 hex of the exact uploaded bytes: the integrity fingerprint.
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),

  -- Optional provenance note ("downloaded from the BK portal 2026-09").
  note text check (note is null or char_length(note) <= 500),

  created_at timestamptz not null default now()
);

comment on table public.provider_statements is
  'An uploaded, verbatim provider-issued statement document (PDF/CSV) kept as evidence alongside OneLedger-generated statements. Never parsed or modified here. storage_path is relative to the private "provider-statements" bucket. authenticated has SELECT only; upload + delete run in lib/provider-statements.ts with the service-role client after an explicit is_workspace_member check, so the metadata row and the stored object stay in sync.';

create index idx_provider_statements_workspace_created
  on public.provider_statements (workspace_id, created_at desc);
create index idx_provider_statements_source
  on public.provider_statements (financial_source_id)
  where financial_source_id is not null;

alter table public.provider_statements enable row level security;

revoke all on public.provider_statements from anon, authenticated;
grant select on public.provider_statements to authenticated;
grant select, insert, update, delete on public.provider_statements to service_role;

-- Any member of the workspace can see what has been uploaded.
create policy provider_statements_select_member on public.provider_statements
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- ===========================================================================
-- Private storage bucket. Same posture as "statement-artifacts": public =
-- false, and no storage.objects policy for anon/authenticated (RLS with no
-- matching policy denies them; service_role bypasses RLS). Every download
-- is a short-lived signed URL issued by the route after membership is
-- verified.
-- ===========================================================================

insert into storage.buckets (id, name, public)
values ('provider-statements', 'provider-statements', false)
on conflict (id) do nothing;
