-- OneLedger Financial Documents Engine - Statements family, PR1 (schema
-- foundation). See docs/financial-statements-design.md for the full design.
--
-- A Statement is a factual, period-scoped, per-account (or consolidated)
-- record of financial activity, generated FROM the OneLedger ledger and
-- rendered as an immutable PDF (primary) or CSV. It is distinct from a
-- Report (/reports), which is an analytical daily summary. This migration
-- adds three tables plus one private Storage bucket and changes nothing
-- else - it is purely additive and inert until FINANCIAL_STATEMENTS_ENABLED
-- is set (lib/financial-statements.ts); no existing row, policy, function
-- or trigger is touched.
--
-- Design mirrors the Reporting engine's Phase J/K storage precedent
-- (20260903000000_phase_k_report_artifacts.sql):
--   * a generated document lives in a PRIVATE bucket, reached only through
--     a short-lived signed URL issued after ownership is independently
--     verified (master prompt sections 26/27);
--   * the *_artifacts table grants NOTHING to anon/authenticated - the
--     browser never queries it, it only receives a signed download URL
--     from app/api/reports/statements/[id]/document/route.ts;
--   * the statement snapshot itself (statements + statement_transactions)
--     is written by lib/statement-generation.ts with the service-role
--     client after that module has explicitly verified workspace
--     membership - "explicit workspace scoping in trusted server code IS
--     the security boundary", the same pattern report-generation.ts uses.
--     authenticated therefore gets SELECT (+ DELETE on the parent) only:
--     never INSERT/UPDATE, so a finalized statement is immutable to the
--     client and cannot be forged row-by-row.
--
-- Snapshot strategy: statement_transactions is a junction table that
-- freezes a COPY of every field the document renders (date, descriptions,
-- reference, direction, effect amounts, running balance, category). A
-- later re-categorisation, edit or erasure of the underlying
-- transactions row can never change what a already-generated statement
-- shows (master prompt sections 17/18). transaction_id is kept for
-- traceability with ON DELETE SET NULL so the frozen copy survives a
-- Right-to-Erasure run.

-- ===========================================================================
-- statements: one generated (or generating) financial statement.
-- ===========================================================================

create table public.statements (
  id uuid primary key default gen_random_uuid(),

  -- Human-readable, non-guessable public identifier: OL-ST-YYYYMMDD-XXXXXX
  -- (6 crypto-random Crockford-base32 chars). Used in support requests,
  -- audit logs and the document footer; never a sequential key.
  statement_id text not null
    constraint statements_statement_id_format
      check (statement_id ~ '^OL-ST-[0-9]{8}-[0-9A-HJ-NP-Z]{6}$'),

  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,

  statement_type text not null default 'standard'
    check (statement_type in ('standard', 'detailed')),

  -- single_account: exactly one financial_sources id in account_ids.
  -- all_accounts: every source the generator was authorized to see.
  -- filtered: a scope-narrowing filter was applied (filters jsonb); the
  --   document must always visibly say so (master prompt section 24).
  scope text not null default 'single_account'
    check (scope in ('single_account', 'all_accounts', 'filtered')),

  -- financial_sources ids covered by this statement. Not an FK (Postgres
  -- cannot FK array elements); validated in lib/statement-generation.ts.
  -- May be empty for a legacy "sourceless rows only" consolidated run.
  account_ids uuid[] not null default '{}'::uuid[],

  filters jsonb not null default '{}'::jsonb,

  period_start timestamptz not null,
  period_end timestamptz not null,
  -- IANA zone the period boundaries were resolved in (never the Kigali
  -- fixed-offset shortcut - see lib/report-period.ts).
  timezone text not null,
  constraint statements_period_order check (period_start <= period_end),

  -- Reporting currency of the totals below. RWF today; the ledger is
  -- zero-decimal RWF in practice, so *_minor columns hold whole RWF.
  currency char(3) not null default 'RWF'
    check (currency = upper(currency)),

  -- NULL = genuinely unavailable (incomplete history), never a computed
  -- zero. lib/statement-math.ts never fabricates a balance (master prompt
  -- sections 14/15).
  opening_balance_minor bigint,
  closing_balance_minor bigint,

  total_credit_minor bigint not null default 0 check (total_credit_minor >= 0),
  total_debit_minor  bigint not null default 0 check (total_debit_minor  >= 0),
  total_fees_minor   bigint not null default 0 check (total_fees_minor   >= 0),
  transaction_count  integer not null default 0 check (transaction_count >= 0),

  -- Per-currency breakdown for a consolidated statement whose sources are
  -- not all one currency: { "RWF": { openingMinor, closingMinor,
  -- creditMinor, debitMinor, feesMinor, count }, ... }. NULL for the
  -- single-currency case. Totals above are then only meaningful per the
  -- `currency` column; a mixed-currency statement never sums across
  -- currencies (master prompt section 23).
  per_currency jsonb,

  -- { provider labels, "OneLedger records" phrasing, ... } - what the
  -- document discloses about where the data came from (master prompt
  -- section 15). Shape owned by lib/statement-coverage.ts.
  source_metadata jsonb not null default '{}'::jsonb,
  -- { complete: bool, warnings: [ { kind, from, to, detail } ], ... }.
  coverage_metadata jsonb not null default '{}'::jsonb,

  -- opening + credits - debits - fees == closing, when all three balances
  -- are known. NULL = not checkable (a balance was unavailable). false =
  -- checked and it did NOT reconcile: the document still generates but is
  -- flagged, and the mismatch is logged for monitoring (master prompt
  -- sections 14/43).
  reconciles boolean,

  status text not null default 'ready'
    check (status in ('preparing', 'generating', 'ready', 'failed')),
  -- Populated only on status='failed'; short machine/user-safe reason.
  failure_reason text,

  -- "Generate updated version" links the new statement to the one it
  -- refreshes; the older row is never mutated (master prompt section 18).
  supersedes_id uuid references public.statements (id) on delete set null,

  -- Idempotency key from the generate form: a repeated submit (double tap,
  -- retry, refresh) with the same token returns the existing row instead
  -- of creating a second one (master prompt section 28). A deliberate
  -- regeneration always sends a fresh token.
  client_token uuid,

  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.statements is
  'One OneLedger-generated financial statement (Financial Documents Engine, Statements family). Immutable once status=ready: authenticated may SELECT and DELETE but never INSERT/UPDATE - the snapshot is written by lib/statement-generation.ts via the service-role client after it verifies workspace membership. Distinct from report_runs (analytical). See docs/financial-statements-design.md.';
comment on column public.statements.statement_id is
  'Public non-guessable id OL-ST-YYYYMMDD-XXXXXX. Never expose statements.id.';
comment on column public.statements.opening_balance_minor is
  'NULL means the balance could not be established from available OneLedger history - it is never a computed zero. Rendered as a dash.';
comment on column public.statements.reconciles is
  'NULL = not checkable; false = checked and failed (document flagged + mismatch logged); true = opening+credits-debits-fees==closing.';
comment on column public.statements.per_currency is
  'Per-currency totals for a mixed-currency consolidated statement; NULL otherwise. Currencies are never summed together.';

create unique index statements_statement_id_key
  on public.statements (statement_id);
create index idx_statements_workspace_created
  on public.statements (workspace_id, created_at desc);
create index idx_statements_supersedes
  on public.statements (supersedes_id)
  where supersedes_id is not null;
-- Idempotency: one row per (workspace, client_token). Partial so many
-- legacy/tokenless rows never collide on NULL.
create unique index statements_workspace_client_token_key
  on public.statements (workspace_id, client_token)
  where client_token is not null;

create trigger set_statements_updated_at
  before update on public.statements
  for each row execute function public.set_updated_at();

alter table public.statements enable row level security;

revoke all on public.statements from anon, authenticated;
grant select, delete on public.statements to authenticated;
grant select, insert, update, delete on public.statements to service_role;

-- A member of the owning workspace may see its statements. Finer
-- household per-source visibility is applied by lib/statement-generation.ts
-- when the snapshot is built (a member's statement only ever contains rows
-- they were allowed to see), consistent with report-generation.ts.
create policy statements_select_member on public.statements
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- Deleting a statement is a member action; retention/erasure flows use the
-- service role. Cascades to statement_transactions and statement_artifacts.
create policy statements_delete_member on public.statements
  for delete to authenticated
  using (public.is_workspace_member(workspace_id, 'member'));

-- No authenticated INSERT/UPDATE policy: deny-by-default makes the
-- snapshot un-forgeable and un-editable from the client.

-- ===========================================================================
-- statement_transactions: the frozen per-row snapshot.
-- ===========================================================================

create table public.statement_transactions (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null
    references public.statements (id) on delete cascade,
  -- Traceability back to the exact ledger row represented at generation
  -- time. SET NULL (not CASCADE) so an erased/deleted transaction does not
  -- destroy the historical statement line.
  transaction_id uuid references public.transactions (id) on delete set null,

  occurred_at timestamptz not null,
  -- The user-facing ("Transfer to Butera Egide") and the verbatim
  -- provider ("RNDPS eKash/XF2E442.../..") descriptions, both kept: a
  -- statement never silently rewrites financial history (master prompt
  -- section 10). Either may be null.
  display_description text,
  original_description text,
  reference text,
  direction text not null check (direction in ('in', 'out', 'neutral')),

  -- Signed minor units, copied from transactions.principal_effect_rwf /
  -- fee_effect_rwf at generation time. NULL only for a row the accounting
  -- engine had not yet processed (should be excluded upstream, but the
  -- column stays nullable to represent it honestly).
  principal_effect_minor bigint,
  fee_effect_minor bigint,
  -- Running balance AFTER this row, or NULL when it could not be
  -- established for the whole period (then every row is NULL and the
  -- Balance column renders as dashes).
  running_balance_minor bigint,

  -- Only meaningful for statement_type='detailed'.
  category text,

  -- Document order (chronological, stable). 0-based.
  sort_index integer not null check (sort_index >= 0),

  created_at timestamptz not null default now(),

  constraint statement_transactions_unique_sort
    unique (statement_id, sort_index)
);

comment on table public.statement_transactions is
  'Immutable per-transaction snapshot for one statement: a frozen copy of every field the PDF/CSV renders, so an already-generated statement never changes when the underlying transaction is later edited, recategorised or erased. Written only by lib/statement-generation.ts (service role); authenticated may SELECT via the parent statement, nothing else.';

create index idx_statement_transactions_statement
  on public.statement_transactions (statement_id, sort_index);

alter table public.statement_transactions enable row level security;

revoke all on public.statement_transactions from anon, authenticated;
grant select on public.statement_transactions to authenticated;
grant select, insert, update, delete on public.statement_transactions to service_role;

create policy statement_transactions_select_member on public.statement_transactions
  for select to authenticated
  using (
    exists (
      select 1
      from public.statements s
      where s.id = statement_transactions.statement_id
        and public.is_workspace_member(s.workspace_id)
    )
  );

-- ===========================================================================
-- statement_artifacts: metadata for a rendered document (PDF or CSV),
-- lazily generated on first download and cached from then on. Grants
-- NOTHING to anon/authenticated - identical posture to report_artifacts.
-- ===========================================================================

create table public.statement_artifacts (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null
    references public.statements (id) on delete cascade,
  format text not null default 'pdf' check (format in ('pdf', 'csv')),
  -- Relative to the private "statement-artifacts" bucket - never a public URL.
  storage_path text not null,
  mime_type text not null default 'application/pdf',
  byte_size bigint not null check (byte_size > 0),
  -- sha256 hex of the exact stored file: the integrity fingerprint
  -- (master prompt section 20). Recomputed and compared on regeneration.
  checksum text not null,
  template_version integer not null default 1,
  created_at timestamptz not null default now(),
  -- One artifact per (statement, format): a re-request reuses the stored
  -- object rather than rendering a duplicate.
  constraint statement_artifacts_unique_format unique (statement_id, format)
);

comment on table public.statement_artifacts is
  'Metadata for a generated statement document (PDF or CSV), lazily rendered on first download request and cached. storage_path is relative to the private "statement-artifacts" bucket - never public. No anon/authenticated grants at all: the download route (app/api/reports/statements/[id]/document) verifies ownership through the statements RLS, then does every artifact/storage operation with the service-role client and returns only a short-lived signed URL. Mirrors report_artifacts.';

create index idx_statement_artifacts_statement
  on public.statement_artifacts (statement_id);

alter table public.statement_artifacts enable row level security;

revoke all on public.statement_artifacts from anon;
revoke all on public.statement_artifacts from authenticated;
grant select, insert, update, delete on public.statement_artifacts to service_role;

-- ===========================================================================
-- Private storage bucket. public = false is what prevents unauthenticated
-- access to any object; every download goes through a short-lived signed
-- URL the route issues after independently verifying statement ownership.
-- No storage.objects policy for anon/authenticated: RLS-enabled with no
-- matching policy already denies them, and service_role bypasses RLS.
-- Same posture as the "report-artifacts" bucket.
-- ===========================================================================

insert into storage.buckets (id, name, public)
values ('statement-artifacts', 'statement-artifacts', false)
on conflict (id) do nothing;
