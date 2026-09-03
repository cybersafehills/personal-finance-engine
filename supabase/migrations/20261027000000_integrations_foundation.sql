-- Integrations Phase 1, PR 1: the import/export data model + a
-- consolidated activity feed.
--
-- Six new workspace-scoped tables plus two additive changes to
-- `transactions` so an imported ledger row carries its batch lineage.
--
-- Authorization model (matches workspace_categories / space_activity
-- post-Phase-T): RLS SELECT is open to any member who holds
-- `integration.view` (so Space viewers, who hold no integration
-- capability, see nothing); every WRITE lands through SECURITY DEFINER
-- RPCs added in PR 2-5 that call has_space_capability with the specific
-- integration.* capability, or through the service-role client. There are
-- deliberately no INSERT/UPDATE policies for `authenticated` here.
--
-- Privacy: integration_events.context and import_records.raw_cells /
-- normalized hold only what the feature needs; ingestion secrets, OAuth
-- tokens and raw financial SMS text never go here.

-- ===========================================================================
-- import_templates: a reusable column mapping + parsing profile, proposed
-- automatically on a future import whose header signature matches.
-- ===========================================================================
create table public.import_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (length(trim(both from name)) > 0),
  -- 'generic' for a hand-mapped CSV/XLSX; a provider key later.
  source_type text not null default 'generic',
  -- normalized (trimmed, lower-cased) header cells of the file this
  -- template was built from - the signature future imports match against.
  header_signature text[] not null default '{}',
  -- { <canonicalField>: <sourceColumnIndex | null>, directionStrategy, ... }
  mapping jsonb not null default '{}'::jsonb,
  transforms jsonb not null default '{}'::jsonb,
  date_format text,
  decimal_format text,
  direction_convention text,
  currency text,
  version integer not null default 1 check (version >= 1),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint import_templates_unique_name unique (workspace_id, name)
);

comment on table public.import_templates is
  'Reusable column-mapping + parsing profile for the Import Studio. Matched to a new file by header_signature; never auto-applied when the structure diverged materially. Versioned; significant edits are audited by the PR3 RPC.';

create index idx_import_templates_workspace
  on public.import_templates (workspace_id);

create trigger set_import_templates_updated_at
  before update on public.import_templates
  for each row execute function public.set_updated_at();

alter table public.import_templates enable row level security;

create policy import_templates_select_member on public.import_templates
  for select to authenticated
  using (public.has_space_capability(workspace_id, 'integration.view'));

revoke all on public.import_templates from anon;
grant select on public.import_templates to authenticated;
grant select, insert, update, delete on public.import_templates to service_role;

-- ===========================================================================
-- import_batches: one uploaded file's lifecycle. Every committed line
-- becomes a source='import' transaction carrying import_batch_id.
-- ===========================================================================
create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  financial_source_id uuid references public.financial_sources (id) on delete set null,
  template_id uuid references public.import_templates (id) on delete set null,
  created_by uuid references auth.users (id),
  source_kind text not null check (source_kind in ('csv', 'xlsx')),
  original_filename text not null,
  -- {workspace_id}/{batch_id}/{sanitized_name} in the private
  -- integration-imports bucket (bucket + policies land in PR2).
  storage_path text,
  status text not null default 'uploaded' check (status in (
    'uploaded', 'profiled', 'mapped', 'validated', 'previewed',
    'committing', 'imported', 'failed', 'rolled_back'
  )),
  -- { total, ready, needs_review, possible_duplicate, invalid, imported,
  --   failed, skipped }
  row_counts jsonb not null default '{}'::jsonb,
  -- data-profiling summary (row count, date range, currency guess, ...)
  detected jsonb not null default '{}'::jsonb,
  -- the resolved column mapping applied to this batch
  mapping jsonb not null default '{}'::jsonb,
  error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  committed_at timestamptz,
  rolled_back_at timestamptz
);

comment on table public.import_batches is
  'One uploaded CSV/XLSX file and its Import Studio lifecycle. Committed lines become source=''import'' transactions with import_batch_id set, so lineage and safe rollback are always available.';

create index idx_import_batches_workspace_status
  on public.import_batches (workspace_id, status);
create index idx_import_batches_workspace_created
  on public.import_batches (workspace_id, created_at desc);

create trigger set_import_batches_updated_at
  before update on public.import_batches
  for each row execute function public.set_updated_at();

alter table public.import_batches enable row level security;

create policy import_batches_select_member on public.import_batches
  for select to authenticated
  using (public.has_space_capability(workspace_id, 'integration.view'));

revoke all on public.import_batches from anon;
grant select on public.import_batches to authenticated;
grant select, insert, update, delete on public.import_batches to service_role;

-- ===========================================================================
-- import_records: the per-row staging area between the file and the
-- ledger (the "Integration Inbox"). Nothing here is trusted ledger data.
-- ===========================================================================
create table public.import_records (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.import_batches (id) on delete cascade,
  -- denormalized from the batch so RLS needs no join.
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  row_index integer not null check (row_index >= 0),
  raw_cells jsonb not null default '{}'::jsonb,
  normalized jsonb not null default '{}'::jsonb,
  status text not null default 'needs_mapping' check (status in (
    'ready', 'needs_review', 'needs_mapping', 'possible_duplicate',
    'conflict', 'invalid', 'approved', 'imported', 'ignored', 'failed'
  )),
  -- { errors: [...], warnings: [...], info: [...] }
  validation jsonb not null default '{}'::jsonb,
  -- { confidence: 'exact'|'likely'|'possible'|'distinct', signals: [...],
  --   candidateTransactionIds: [...] }
  match jsonb not null default '{}'::jsonb,
  canonical_transaction_id uuid references public.transactions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint import_records_unique_row unique (import_batch_id, row_index)
);

comment on table public.import_records is
  'Per-row import staging (the Integration Inbox). Untrusted until committed. status drives review; match/validation carry the explainable signals shown to the user. No auto-merge - possible_duplicate rows flow into the existing /transactions/review queue after commit.';

create index idx_import_records_batch_status
  on public.import_records (import_batch_id, status);
create index idx_import_records_workspace_status
  on public.import_records (workspace_id, status);

create trigger set_import_records_updated_at
  before update on public.import_records
  for each row execute function public.set_updated_at();

alter table public.import_records enable row level security;

create policy import_records_select_member on public.import_records
  for select to authenticated
  using (public.has_space_capability(workspace_id, 'integration.view'));

revoke all on public.import_records from anon;
grant select on public.import_records to authenticated;
grant select, insert, update, delete on public.import_records to service_role;

-- ===========================================================================
-- export_templates: a reusable export configuration (fields, filters,
-- relative period, format).
-- ===========================================================================
create table public.export_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (length(trim(both from name)) > 0),
  -- { accounts, dateRange | relativePeriod, transactionTypes, statuses,
  --   categories, sheets }
  config jsonb not null default '{}'::jsonb,
  format text not null default 'xlsx' check (format in ('csv', 'xlsx')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint export_templates_unique_name unique (workspace_id, name)
);

comment on table public.export_templates is
  'Reusable Export Center configuration. Supports relative periods (previous month, current month, previous week, fiscal year) resolved at run time.';

create index idx_export_templates_workspace
  on public.export_templates (workspace_id);

create trigger set_export_templates_updated_at
  before update on public.export_templates
  for each row execute function public.set_updated_at();

alter table public.export_templates enable row level security;

create policy export_templates_select_member on public.export_templates
  for select to authenticated
  using (public.has_space_capability(workspace_id, 'integration.view'));

revoke all on public.export_templates from anon;
grant select on public.export_templates to authenticated;
grant select, insert, update, delete on public.export_templates to service_role;

-- ===========================================================================
-- export_jobs: one export request. Small exports run inline in the create
-- action; large ones are claimed and run by the PR5 cron (claim/lease
-- columns mirror notification delivery).
-- ===========================================================================
create table public.export_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  template_id uuid references public.export_templates (id) on delete set null,
  created_by uuid references auth.users (id),
  config jsonb not null default '{}'::jsonb,
  format text not null default 'xlsx' check (format in ('csv', 'xlsx')),
  status text not null default 'queued' check (status in (
    'queued', 'processing', 'completed', 'failed'
  )),
  -- {workspace_id}/{job_id}/... in the private integration-exports bucket
  -- (bucket + policies land in PR5); served only via a short-lived signed URL.
  storage_path text,
  row_count integer,
  error jsonb,
  -- background claim/lease for the PR5 cron
  claim_token uuid,
  claimed_at timestamptz,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.export_jobs is
  'One export request and its lifecycle. Output is written to the private integration-exports bucket and handed to the user only through a time-limited signed URL. Large jobs are claimed via claim_token/claimed_at by the PR5 export cron.';

create index idx_export_jobs_workspace_status
  on public.export_jobs (workspace_id, status);
create index idx_export_jobs_workspace_requested
  on public.export_jobs (workspace_id, requested_at desc);
-- the cron scans only unfinished jobs
create index idx_export_jobs_pending
  on public.export_jobs (status, requested_at)
  where status in ('queued', 'processing');

create trigger set_export_jobs_updated_at
  before update on public.export_jobs
  for each row execute function public.set_updated_at();

alter table public.export_jobs enable row level security;

create policy export_jobs_select_member on public.export_jobs
  for select to authenticated
  using (public.has_space_capability(workspace_id, 'integration.view'));

revoke all on public.export_jobs from anon;
grant select on public.export_jobs to authenticated;
grant select, insert, update, delete on public.export_jobs to service_role;

-- ===========================================================================
-- integration_events: the consolidated activity / health feed shown at
-- /integrations/activity. Append-only. Redacted - no secrets, no raw
-- financial text, no stack traces.
-- ===========================================================================
create table public.integration_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- 'import.uploaded' | 'import.committed' | 'import.rolled_back' |
  -- 'export.completed' | 'export.failed' | 'connection.error' | ...
  kind text not null,
  severity text not null default 'info' check (severity in ('info', 'warning', 'error')),
  ref_type text,
  ref_id uuid,
  summary text not null,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.integration_events is
  'Consolidated, redacted activity/health feed for the Integrations area (imports, exports, connections). Append-only. context never carries credentials, tokens, raw financial text or stack traces.';

create index idx_integration_events_workspace_created
  on public.integration_events (workspace_id, created_at desc);
create index idx_integration_events_workspace_kind
  on public.integration_events (workspace_id, kind, created_at desc);

alter table public.integration_events enable row level security;

create policy integration_events_select_member on public.integration_events
  for select to authenticated
  using (public.has_space_capability(workspace_id, 'integration.view'));

revoke all on public.integration_events from anon;
grant select on public.integration_events to authenticated;
grant select, insert on public.integration_events to service_role;

-- ===========================================================================
-- transactions: carry import lineage. Forward-only edits to the two
-- CHECK constraints last touched by 20260925000000_phase_u_statement_import.
-- ===========================================================================
alter table public.transactions
  add column import_batch_id uuid references public.import_batches (id) on delete set null;

create index idx_transactions_import_batch
  on public.transactions (import_batch_id)
  where import_batch_id is not null;

alter table public.transactions
  drop constraint transactions_source_check;
alter table public.transactions
  add constraint transactions_source_check
  check (source in ('mtn_momo', 'bank_card', 'manual', 'statement', 'import'));

alter table public.transactions
  drop constraint transactions_momo_message_required_unless_manual;
alter table public.transactions
  add constraint transactions_momo_message_required_unless_manual check (
    momo_message_id is not null or source in ('manual', 'statement', 'import')
  );

-- import_batch_id belongs only to imported rows.
alter table public.transactions
  add constraint transactions_import_batch_only_for_import check (
    import_batch_id is null or source = 'import'
  );
