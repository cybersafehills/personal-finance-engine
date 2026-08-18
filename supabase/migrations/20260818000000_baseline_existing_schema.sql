-- ============================================================================
-- BASELINE MIGRATION - reconstructs schema state that already exists in the
-- linked production project (see supabase/.temp/project-ref), created
-- out-of-band before this repository tracked any migrations.
--
-- IMPORTANT - READ BEFORE RUNNING ANYTHING:
--
--   1. This file was NEVER executed. Docker was not available in the
--      environment that authored it, so there was no local Postgres/shadow
--      database to run `supabase db pull` or `supabase db dump` against
--      (both require Docker). Every statement below was reconstructed by
--      hand from read-only introspection of the LIVE linked project via
--      `supabase db query --linked` against information_schema, pg_catalog
--      (pg_constraint, pg_indexes, pg_trigger, pg_proc, pg_extension,
--      pg_default_acl, role_table_grants) - not guessed, but also not
--      verified by actually running it anywhere. Validate this against a
--      real scratch/local Postgres or a Supabase preview branch before
--      trusting it.
--
--   2. `supabase migration list` currently shows ZERO migrations recorded
--      against the linked project's `supabase_migrations.schema_migrations`
--      table, even though the tables below already exist there (they were
--      created directly, e.g. via the SQL editor/dashboard). This means:
--
--        DO NOT run a plain `supabase db push` that includes this file
--        against the current linked project - every `create table`
--        statement below will fail with "already exists", because the
--        objects it creates are already present.
--
--      Before this file (or anything after it) can ever be pushed to the
--      linked project, an operator must first reconcile migration history
--      out-of-band, e.g.:
--
--        supabase migration repair 20260818000000 --status applied
--
--      which marks this migration as already-applied in the tracking
--      table WITHOUT executing its SQL (a metadata-only operation) -
--      appropriate here because the objects it describes genuinely already
--      exist. This repair step is itself a production-affecting action and
--      was NOT performed as part of this review; it requires a deliberate,
--      separate decision by the project owner.
--
--      This file's practical purpose is for anyone spinning up a genuinely
--      fresh database (CI, local dev, disaster recovery) to reach the same
--      schema shape the linked project already has, and for the migration
--      chain to read as a complete, self-contained history rather than
--      silently assuming undocumented prior state.
--
--   3. Two platform-managed objects this file deliberately does NOT
--      recreate, because they are provisioned automatically by Supabase on
--      every project (not something a user migration should own):
--        - the `rls_auto_enable` event trigger (`ensure_rls`), which
--          auto-enables RLS on any newly created public-schema table. This
--          migration still explicitly enables RLS on every table below for
--          clarity/self-documentation, redundant with that trigger.
--        - the pgcrypto/uuid-ossp extensions and other platform event
--          triggers (pgrst_ddl_watch, issue_pg_cron_access, etc.).
--      gen_random_uuid() was confirmed resolvable via the `extensions`
--      schema already on this project's search_path (see
--      supabase/config.toml `extra_search_path`), consistent with
--      PostgreSQL 17 (config.toml `major_version = 17`) providing it as a
--      core function.
--
--   4. This baseline intentionally reflects the CURRENT true state of the
--      four tables below, including their gap: `anon` and `authenticated`
--      still hold table-level CRUD grants on all four (inherited from a
--      platform-wide `ALTER DEFAULT PRIVILEGES` on schema `public` that
--      grants those roles full rights on every new table by default -
--      confirmed via pg_default_acl). RLS is enabled with no permissive
--      policy, which is what currently blocks anon/authenticated from
--      actually reading or writing anything - but the GRANTs themselves
--      remain broader than necessary. This is addressed explicitly and
--      separately in 20260818130200_revoke_anon_authenticated_privileges.sql,
--      not silently folded in here, so the hardening change is its own
--      reviewable step.
-- ============================================================================

-- ===========================================================================
-- Shared trigger function used by every table below with an updated_at
-- column.
-- ===========================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ===========================================================================
-- merchant_rules
-- ===========================================================================

create table public.merchant_rules (
  id uuid primary key default gen_random_uuid(),
  match_type text not null default 'contains'
    check (match_type in ('exact', 'contains', 'starts_with', 'regex')),
  merchant_pattern text not null
    check (length(trim(both from merchant_pattern)) > 0),
  normalized_merchant_name text,
  category text not null,
  subcategory text,
  priority integer not null default 100,
  is_active boolean not null default true,
  rule_source text not null default 'manual'
    check (rule_source in ('manual', 'learned', 'system')),
  confidence numeric(5, 4) not null default 1.0000
    check (confidence >= 0 and confidence <= 1),
  usage_count bigint not null default 0
    check (usage_count >= 0),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_merchant_rules_active_priority
  on public.merchant_rules (is_active, priority);

create trigger set_merchant_rules_updated_at
  before update on public.merchant_rules
  for each row execute function public.set_updated_at();

alter table public.merchant_rules enable row level security;
grant select, insert, update, delete on public.merchant_rules to service_role;

-- ===========================================================================
-- momo_messages - immutable raw SMS evidence.
-- ===========================================================================

create table public.momo_messages (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'ios_shortcuts'
    check (source in ('ios_shortcuts', 'manual_import', 'system_import')),
  raw_message text not null
    check (length(trim(both from raw_message)) > 0),
  message_fingerprint text,
  device_received_at timestamptz,
  server_received_at timestamptz not null default now(),
  processing_status text not null default 'pending'
    check (processing_status in ('pending', 'processing', 'processed', 'needs_review', 'rejected', 'failed')),
  parser_version text,
  parse_attempts integer not null default 0
    check (parse_attempts >= 0),
  last_parse_attempt_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint momo_messages_fingerprint_unique unique (message_fingerprint)
);

create index idx_momo_messages_device_received_at
  on public.momo_messages (device_received_at desc);
create index idx_momo_messages_processing_status
  on public.momo_messages (processing_status);
create index idx_momo_messages_received_at
  on public.momo_messages (server_received_at desc);

create trigger set_momo_messages_updated_at
  before update on public.momo_messages
  for each row execute function public.set_updated_at();

alter table public.momo_messages enable row level security;
grant select, insert, update, delete on public.momo_messages to service_role;

-- ===========================================================================
-- processing_errors - append-only (no updated_at/trigger, matching the
-- live schema).
-- ===========================================================================

create table public.processing_errors (
  id uuid primary key default gen_random_uuid(),
  momo_message_id uuid references public.momo_messages(id) on delete cascade,
  stage text not null
    check (stage in ('ingestion', 'validation', 'classification', 'parsing', 'database', 'reporting', 'other')),
  error_code text not null,
  error_message text not null,
  error_details jsonb not null default '{}'::jsonb,
  parser_version text,
  is_resolved boolean not null default false,
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz not null default now(),
  constraint processing_errors_resolution_check check (
    (is_resolved = false and resolved_at is null)
    or (is_resolved = true and resolved_at is not null)
  )
);

create index idx_processing_errors_unresolved
  on public.processing_errors (created_at desc)
  where is_resolved = false;

alter table public.processing_errors enable row level security;
grant select, insert, update, delete on public.processing_errors to service_role;

-- ===========================================================================
-- transactions - structured, deterministically parsed ledger entries.
-- ===========================================================================

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  momo_message_id uuid not null references public.momo_messages(id) on delete restrict,
  external_transaction_id text,
  source text not null default 'mtn_momo'
    check (source in ('mtn_momo', 'bank_card', 'manual')),
  transaction_type text not null
    check (transaction_type in (
      'send_money', 'merchant_payment', 'money_received', 'airtime',
      'cash_withdrawal', 'cash_deposit', 'bill_payment', 'bank_transfer',
      'refund', 'reversal', 'other'
    )),
  direction text not null
    check (direction in ('in', 'out', 'neutral')),
  status text not null
    check (status in ('success', 'failed', 'reversed', 'pending', 'unknown')),
  currency character(3) not null default 'RWF'
    check (currency = upper(currency)),
  amount_rwf bigint not null
    check (amount_rwf >= 0),
  fee_rwf bigint not null default 0
    check (fee_rwf >= 0),
  net_effect_rwf bigint,
  balance_after_rwf bigint
    check (balance_after_rwf is null or balance_after_rwf >= 0),
  counterparty_name text,
  counterparty_reference text,
  occurred_at timestamptz not null,
  category text,
  subcategory text,
  category_source text
    check (category_source is null or category_source in ('rule', 'ai', 'manual', 'system')),
  category_confidence numeric(5, 4)
    check (category_confidence is null or (category_confidence >= 0 and category_confidence <= 1)),
  notes text,
  parser_version text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactions_momo_message_unique unique (momo_message_id),
  constraint transactions_external_id_unique unique (external_transaction_id)
);

create index idx_transactions_category on public.transactions (category);
create index idx_transactions_counterparty on public.transactions (counterparty_name);
create index idx_transactions_direction on public.transactions (direction);
create index idx_transactions_occurred_at on public.transactions (occurred_at desc);
create index idx_transactions_occurred_category on public.transactions (occurred_at desc, category);
create index idx_transactions_status on public.transactions (status);
create index idx_transactions_type on public.transactions (transaction_type);

create trigger set_transactions_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

alter table public.transactions enable row level security;
grant select, insert, update, delete on public.transactions to service_role;
