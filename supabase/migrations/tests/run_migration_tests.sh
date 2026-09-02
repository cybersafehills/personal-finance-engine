#!/usr/bin/env bash
# Disposable-PostgreSQL migration tests for the Phase 3 accounting schema.
#
# WHAT THIS PROVES: the full migration chain (supabase/migrations/*.sql)
# applies cleanly to a genuinely empty database, twice, byte-for-byte
# reproducibly; the accounting-effect invariants added in
# 20260818130000_accounting_foundation.sql accept and reject exactly the
# states they should; and transactions.net_effect_rwf remains a
# GENERATED ALWAYS AS (...) STORED column - never an ordinary nullable one -
# throughout. This is the test suite that would have caught the production
# push failure described in that migration's comments, had it existed
# first. See supabase/migrations/README.md for how this fits into the
# pre-migration checklist.
#
# WHAT THIS NEVER DOES: touch the linked Supabase project. Every database
# created here is disposable. In the default (local) mode this script
# spawns and tears down its own throwaway PostgreSQL cluster. In external
# mode (see below) it targets a Postgres instance the CALLER already
# started and owns the lifecycle of (e.g. a GitHub Actions service
# container) - this script never starts, stops, or otherwise manages that
# instance, it only creates/drops disposable databases within it.
# assert_not_production_target() below is a hard, always-on safety gate in
# BOTH modes refusing to run against anything that looks like the linked
# Supabase project, regardless of which mode is active or who configured
# the environment.
#
# MODES (PFE_PG_MODE, default "spawn"):
#   spawn     (default, unchanged local behavior) - this script runs
#             initdb/pg_ctl itself to create a throwaway cluster, and
#             tears it down on exit via the trap below. Requires
#             PostgreSQL 17.x server+client binaries on PATH (or set
#             PG_BIN_DIR to their directory - e.g. Homebrew's
#             /opt/homebrew/opt/postgresql@17/bin).
#   external  - connects to a Postgres instance the caller already started
#               and left running (PGHOST/PGPORT/PGUSER/PGPASSWORD already
#               exported, standard psql/libpq environment variables - no
#               custom variable names). This script never spawns or stops
#               that server; it only needs `psql`/`pg_dump` client
#               binaries on PATH and requires the live server to report
#               major version 17 (verified via `SHOW server_version_num`
#               after connecting, not by inspecting a local binary, since
#               there may be no local `postgres` server binary in this
#               mode at all). Intended for CI (see
#               .github/workflows/ci.yml), where a `postgres:17` service
#               container is already running before this script starts.
#
# Version 17 is required in both modes to match the linked project's
# Postgres engine (see supabase/config.toml major_version and
# `supabase projects list` database.postgres_engine). If unavailable,
# this script exits with a clear message rather than silently testing
# against a mismatched version - it does not fall back to Docker in
# "spawn" mode (not required/used there).
#
# USAGE:
#   supabase/migrations/tests/run_migration_tests.sh                # local, spawns its own cluster
#   PFE_PG_MODE=external supabase/migrations/tests/run_migration_tests.sh   # CI, targets an already-running instance
#
# Exit code 0 = every lettered test (A-I) passed. Nonzero = see output for
# which test failed; no cleanup is skipped either way (spawn mode) / no
# production access is ever possible (either mode - see
# assert_not_production_target).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$(cd "$SCRIPT_DIR/../" && pwd)"
REPO_ROOT="$(cd "$MIGRATIONS_DIR/../.." && pwd)"

PFE_PG_MODE="${PFE_PG_MODE:-spawn}"

# ===========================================================================
# Hard safety gate: refuse to run against anything that looks like the
# linked Supabase production project, in EITHER mode, regardless of how
# the calling environment was configured. This does not rely on a
# developer/CI author remembering not to set a secret - it actively
# inspects the environment this script is about to use and aborts before
# issuing a single SQL statement if anything looks unsafe.
# ===========================================================================
assert_not_production_target() {
  # 1. Known Supabase-CLI/production environment variable names must not
  # be present at all in this process - their mere presence indicates
  # something intends this shell to have production reach, which this
  # script must never use even if PGHOST/PGPORT happen to look benign.
  local unsafe_vars=(
    SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD SUPABASE_SERVICE_ROLE_KEY
    SUPABASE_URL SUPABASE_ANON_KEY DATABASE_URL MOMO_INGEST_SECRET
  )
  local var
  for var in "${unsafe_vars[@]}"; do
    if [ -n "${!var:-}" ]; then
      echo "FAIL: refusing to run - environment variable $var is set. This" >&2
      echo "      suggests a production/remote Supabase credential is available" >&2
      echo "      to this shell. This test suite must only ever target a" >&2
      echo "      disposable local or CI-ephemeral Postgres instance." >&2
      exit 1
    fi
  done

  # 2. PGHOST must not resemble a Supabase-managed hostname or reference
  # this specific project's ref, however it was set.
  local host="${PGHOST:-}"
  case "$host" in
    *supabase.co* | *supabase.com* | *pooler.supabase.com* | *zttxsaiywkfrbdxgzbjd*)
      echo "FAIL: refusing to run - PGHOST ('$host') looks like a Supabase-managed" >&2
      echo "      or project-specific hostname. This test suite must only ever" >&2
      echo "      target a disposable local or CI-ephemeral Postgres instance." >&2
      exit 1
      ;;
  esac
}

assert_not_production_target

if [ "$PFE_PG_MODE" = "spawn" ]; then
  PG_BIN_DIR="${PG_BIN_DIR:-/opt/homebrew/opt/postgresql@17/bin}"

  if [ ! -x "$PG_BIN_DIR/pg_ctl" ]; then
    # Fall back to whatever is on PATH, but require it to report major
    # version 17 - a mismatched pg_dump/pg_ctl against this schema is not
    # a meaningful test of production compatibility.
    if command -v pg_ctl >/dev/null 2>&1; then
      PG_BIN_DIR="$(dirname "$(command -v pg_ctl)")"
    else
      echo "FAIL: no PostgreSQL 17 pg_ctl found. Set PG_BIN_DIR or install postgresql@17." >&2
      exit 1
    fi
  fi

  PG_VERSION_MAJOR="$("$PG_BIN_DIR/postgres" --version | grep -oE '[0-9]+' | head -1)"
  if [ "$PG_VERSION_MAJOR" != "17" ]; then
    echo "FAIL: found PostgreSQL major version $PG_VERSION_MAJOR at $PG_BIN_DIR, need 17 (matches the linked project)." >&2
    exit 1
  fi

  export PATH="$PG_BIN_DIR:$PATH"

  WORKDIR="$(mktemp -d /tmp/pfe_migration_tests.XXXXXX)"
  SOCK_DIR="$(mktemp -d /tmp/pfe_migration_tests_sock.XXXXXX)"
  PGPORT_TEST=55555
  export PGHOST="$SOCK_DIR"
  export PGPORT="$PGPORT_TEST"
  export PGUSER=postgres
elif [ "$PFE_PG_MODE" = "external" ]; then
  if ! command -v psql >/dev/null 2>&1; then
    echo "FAIL: PFE_PG_MODE=external requires psql on PATH (client only - no server binary needed)." >&2
    exit 1
  fi
  if ! command -v pg_dump >/dev/null 2>&1; then
    echo "FAIL: PFE_PG_MODE=external requires pg_dump on PATH." >&2
    exit 1
  fi
  : "${PGHOST:?PFE_PG_MODE=external requires PGHOST to already be exported by the caller}"
  : "${PGPORT:?PFE_PG_MODE=external requires PGPORT to already be exported by the caller}"
  : "${PGUSER:?PFE_PG_MODE=external requires PGUSER to already be exported by the caller}"
else
  echo "FAIL: unknown PFE_PG_MODE '$PFE_PG_MODE' - expected 'spawn' or 'external'." >&2
  exit 1
fi

PASS_COUNT=0
FAIL_COUNT=0

pass() { echo "PASS: $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo "FAIL: $1" >&2; FAIL_COUNT=$((FAIL_COUNT + 1)); }

# Scratch space for test artifacts (schema dumps used by test I) that is
# needed in both modes - independent of $WORKDIR, which in "spawn" mode is
# specifically the throwaway cluster's own data directory.
ARTIFACT_DIR="$(mktemp -d /tmp/pfe_migration_test_artifacts.XXXXXX)"

if [ "$PFE_PG_MODE" = "spawn" ]; then
  cleanup() {
    pg_ctl -D "$WORKDIR/pgdata" stop -m fast >/dev/null 2>&1 || true
    rm -rf "$WORKDIR" "$SOCK_DIR" "$ARTIFACT_DIR"
  }
  trap cleanup EXIT

  echo "=== bootstrapping disposable PostgreSQL 17 cluster ==="
  # PostgreSQL 17 on macOS aborts at startup with "postmaster became
  # multithreaded during startup" unless a locale is pinned in the
  # environment as well - initdb's --locale=C alone is not enough for the
  # postmaster process itself.
  export LC_ALL=C LANG=C
  initdb -D "$WORKDIR/pgdata" -U postgres --auth=trust --locale=C -E UTF8 >/dev/null
  pg_ctl -D "$WORKDIR/pgdata" -o "-p $PGPORT_TEST -c listen_addresses='' -k $SOCK_DIR" -l "$WORKDIR/pg.log" start >/dev/null
else
  echo "=== connecting to external PostgreSQL instance (PGHOST=$PGHOST PGPORT=$PGPORT) ==="
  SERVER_VERSION_NUM="$(psql -d postgres -t -A -c "show server_version_num;")"
  SERVER_MAJOR="${SERVER_VERSION_NUM:0:2}"
  if [ "$SERVER_MAJOR" != "17" ]; then
    echo "FAIL: external Postgres reports server_version_num=$SERVER_VERSION_NUM (major $SERVER_MAJOR), need 17 (matches the linked project)." >&2
    exit 1
  fi

  # Best-effort tidy-up of the disposable test databases this script
  # creates within the external instance. Not required for correctness in
  # CI (the whole service container is torn down by the runner regardless)
  # but keeps behavior sane if this script is ever pointed at a
  # longer-lived external instance.
  cleanup() {
    for db in pfe_h pfe_g pfe_ade pfe_i1 pfe_i2 pfe_j pfe_k pfe_rls; do
      psql -d postgres -c "drop database if exists \"$db\";" >/dev/null 2>&1 || true
    done
    rm -rf "$ARTIFACT_DIR"
  }
  trap cleanup EXIT
fi

apply_chain() {
  local dbname="$1"
  local migrations=("$MIGRATIONS_DIR"/*.sql)
  # The ownership-backfill migration is only ever safe to apply once a
  # real owner exists - see that migration's own comments. A genuinely
  # fresh database (this function's contract) has no owner yet, so
  # simulate the real intended production sequencing here: apply every
  # migration up through the one that creates handle_new_user(), have one
  # synthetic "owner" sign up (exactly what a real fresh deployment
  # requires before the backfill migration can run), then continue
  # applying the rest of the chain. This is not a workaround for the test
  # harness - it is the actual required operational order, modeled
  # accurately. Triggered off the specific migration filename that
  # creates the trigger, not "the last file" - later migrations (e.g.
  # Phase C) legitimately come after the backfill migration in the
  # directory listing.
  local owner_trigger_migration="20260821000000_phase_b_identity_and_tenancy.sql"
  for f in "${migrations[@]}"; do
    psql -d "$dbname" -v ON_ERROR_STOP=1 -f "$f" >/dev/null
    if [[ "$f" == *"$owner_trigger_migration" ]]; then
      psql -d "$dbname" -t -A -c "insert into auth.users (email) values ('test-owner@example.com');" >/dev/null
    fi
  done
}

# Roles are cluster-global in Postgres, so a DO block guards against
# "already exists" on the second and subsequent disposable databases
# created within the same cluster by this script.
bootstrap_db() {
  local dbname="$1"
  psql -d postgres -v ON_ERROR_STOP=1 -c "drop database if exists \"$dbname\";" >/dev/null
  psql -d postgres -v ON_ERROR_STOP=1 -c "create database \"$dbname\";" >/dev/null
  psql -d postgres -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;
SQL
  psql -d "$dbname" -v ON_ERROR_STOP=1 >/dev/null <<SQL
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
alter database "$dbname" set search_path to public, extensions;
-- Mirrors ALL THREE postgres-owned default-privilege entries confirmed
-- live on the linked production project (pg_default_acl), not just
-- tables - production's function/sequence defaults independently grant
-- anon/authenticated too (this is what
-- 20260819000000_harden_function_and_sequence_default_privileges.sql
-- exists to fix). Without also seeding the function/sequence defaults
-- here, this disposable database would start from a *better* baseline
-- than production actually has, and the tests below would not be
-- exercising the real problem.
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;

-- Minimal mock of the Supabase-platform-managed auth schema (Phase B).
-- Real Supabase provisions the full GoTrue schema on every project; this
-- disposable cluster only needs the two primitives the Phase B migrations
-- and RLS policies actually depend on: an auth.users table shaped closely
-- enough to support a foreign key and the new-user trigger, and
-- auth.uid() itself, defined identically to Supabase's own (reads the
-- current request's JWT "sub" claim from a session-local GUC) so tests can
-- simulate "signed in as user X" with
-- set_config('request.jwt.claim.sub', '<uuid>', true).
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default extensions.gen_random_uuid(),
  email text,
  email_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists auth.mfa_factors (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null check (status in ('unverified', 'verified'))
);
create or replace function auth.uid()
returns uuid
language sql
stable
as \$\$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
\$\$;
create or replace function auth.jwt()
returns jsonb
language sql
stable
as \$\$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  )
\$\$;

-- Real Supabase provisions the supabase_realtime publication on every
-- project; this disposable cluster doesn't, so
-- 20260828000000_realtime_publication.sql's ALTER PUBLICATION statements
-- would otherwise fail here (and nowhere else) with "publication
-- supabase_realtime does not exist". Pre-creating an empty one mirrors
-- what the real platform already does, rather than papering over a
-- genuine migration problem.
do \$\$
begin
  if not exists (select from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
\$\$;

-- Minimal mock of the Supabase-platform-managed storage schema (Phase K:
-- 20260903000000_phase_k_report_artifacts.sql's "insert into
-- storage.buckets (...)") - just enough columns to satisfy that one
-- insert. Real Supabase provisions the full Storage API schema;
-- this disposable cluster only needs the table to exist.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);
SQL
}

# ===========================================================================
# H. Fresh database can execute the complete migration chain successfully.
# ===========================================================================
echo "=== H: fresh chain application ==="
bootstrap_db "pfe_h"
if apply_chain "pfe_h"; then
  pass "H: full migration chain applied cleanly to an empty database"
else
  fail "H: migration chain failed against an empty database"
fi

# ===========================================================================
# F. net_effect_rwf remains a GENERATED column after the full chain.
# ===========================================================================
echo "=== F: generated-column status preserved ==="
GEN_STATUS="$(psql -d pfe_h -t -A -c "select is_generated from information_schema.columns where table_schema='public' and table_name='transactions' and column_name='net_effect_rwf';")"
if [ "$GEN_STATUS" = "ALWAYS" ]; then
  pass "F: net_effect_rwf is still GENERATED ALWAYS after the full migration chain"
else
  fail "F: net_effect_rwf is_generated='$GEN_STATUS', expected 'ALWAYS' - a migration silently converted it to an ordinary column"
fi

# ===========================================================================
# G. A production-like row inserted BEFORE the accounting-foundation
# migration survives it unmodified, and the 5 new columns start NULL.
# ===========================================================================
echo "=== G: pre-existing row survives migration unmodified ==="
bootstrap_db "pfe_g"
psql -d pfe_g -v ON_ERROR_STOP=1 -f "$MIGRATIONS_DIR/20260818000000_baseline_existing_schema.sql" >/dev/null

psql -d pfe_g -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into public.momo_messages (raw_message, message_fingerprint, parser_version)
values ('production-like test message', 'fp-g-1', 'test-v1');

insert into public.transactions (momo_message_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version)
select id, 'merchant_payment', 'out', 'success', 100, 0, now(), 'test-v1'
from public.momo_messages where message_fingerprint = 'fp-g-1';
SQL

BEFORE="$(psql -d pfe_g -t -A -c "select amount_rwf, fee_rwf, direction, status, net_effect_rwf from public.transactions;")"

psql -d pfe_g -v ON_ERROR_STOP=1 -f "$MIGRATIONS_DIR/20260818130000_accounting_foundation.sql" >/dev/null

AFTER="$(psql -d pfe_g -t -A -c "select amount_rwf, fee_rwf, direction, status, net_effect_rwf from public.transactions;")"
NEW_COLS_NULL="$(psql -d pfe_g -t -A -c "select count(*) from public.transactions where principal_effect_rwf is not null or fee_effect_rwf is not null or settlement_state is not null or affects_balance is not null or effect_reason is not null;")"

if [ "$BEFORE" = "$AFTER" ] && [ "$NEW_COLS_NULL" = "0" ]; then
  pass "G: pre-existing row's original fields and net_effect_rwf are unchanged; all 5 new accounting columns are NULL"
else
  fail "G: pre-existing row was modified by the migration (before='$BEFORE' after='$AFTER' new_cols_nonnull_count=$NEW_COLS_NULL)"
fi

# ===========================================================================
# A-E. Accept/reject behavior of the accounting-effect invariants.
# ===========================================================================
echo "=== A-E: accounting-effect invariant accept/reject behavior ==="
apply_chain_up_to_130000() {
  psql -d "$1" -v ON_ERROR_STOP=1 -f "$MIGRATIONS_DIR/20260818000000_baseline_existing_schema.sql" >/dev/null
  psql -d "$1" -v ON_ERROR_STOP=1 -f "$MIGRATIONS_DIR/20260818130000_accounting_foundation.sql" >/dev/null
}

bootstrap_db "pfe_ade"
apply_chain_up_to_130000 "pfe_ade"

psql -d pfe_ade -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into public.momo_messages (raw_message, message_fingerprint, parser_version)
values ('msg-a', 'fp-a', 'test-v1'),
       ('msg-b', 'fp-b', 'test-v1'),
       ('msg-c', 'fp-c', 'test-v1'),
       ('msg-d', 'fp-d', 'test-v1'),
       ('msg-e', 'fp-e', 'test-v1'),
       ('msg-f', 'fp-f', 'test-v1'),
       ('msg-g', 'fp-g', 'test-v1'),
       ('msg-h', 'fp-h', 'test-v1');

insert into public.transactions (momo_message_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version)
select id, 'merchant_payment', 'out', 'success', 4000, 0, now(), 'test-v1' from public.momo_messages where message_fingerprint = 'fp-a';
insert into public.transactions (momo_message_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version)
select id, 'merchant_payment', 'out', 'success', 4000, 0, now(), 'test-v1' from public.momo_messages where message_fingerprint = 'fp-b';
insert into public.transactions (momo_message_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version)
select id, 'merchant_payment', 'out', 'success', 4000, 0, now(), 'test-v1' from public.momo_messages where message_fingerprint = 'fp-c';
insert into public.transactions (momo_message_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version)
select id, 'send_money', 'out', 'success', 1000, 20, now(), 'test-v1' from public.momo_messages where message_fingerprint = 'fp-d';
insert into public.transactions (momo_message_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version)
select id, 'send_money', 'out', 'success', 1000, 20, now(), 'test-v1' from public.momo_messages where message_fingerprint = 'fp-e';
insert into public.transactions (momo_message_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version)
select id, 'send_money', 'out', 'success', 1000, 20, now(), 'test-v1' from public.momo_messages where message_fingerprint = 'fp-f';
insert into public.transactions (momo_message_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version)
select id, 'merchant_payment', 'out', 'success', 4000, 0, now(), 'test-v1' from public.momo_messages where message_fingerprint = 'fp-g';
insert into public.transactions (momo_message_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version)
select id, 'money_received', 'in', 'success', 5000, 0, now(), 'test-v1' from public.momo_messages where message_fingerprint = 'fp-h';
SQL

# A. Insert with the 5 new columns left NULL -> already accepted above
# (the inserts above never set them). Confirm explicitly.
NULL_ROW_COUNT="$(psql -d pfe_ade -t -A -c "select count(*) from public.transactions where principal_effect_rwf is null and fee_effect_rwf is null and settlement_state is null and affects_balance is null and effect_reason is null;")"
if [ "$NULL_ROW_COUNT" = "8" ]; then
  pass "A: rows with all 5 new accounting columns NULL are accepted"
else
  fail "A: expected 8 rows with all-NULL accounting columns, found $NULL_ROW_COUNT"
fi

# B/E. Fully, correctly populated accounting state -> accepted.
if psql -d pfe_ade -v ON_ERROR_STOP=1 -c "
  update public.transactions
  set principal_effect_rwf = -4000, fee_effect_rwf = 0, settlement_state = 'settled', affects_balance = true, effect_reason = 'settled_outgoing_no_fee'
  where momo_message_id = (select id from public.momo_messages where message_fingerprint = 'fp-a');
" >/dev/null 2>&1; then
  pass "B: fully and correctly populated accounting state is accepted"
else
  fail "B: a correctly populated accounting state was rejected"
fi

# E. Correct relationship with a nonzero fee (principal+fee == generated net_effect_rwf).
if psql -d pfe_ade -v ON_ERROR_STOP=1 -c "
  update public.transactions
  set principal_effect_rwf = -1000, fee_effect_rwf = -20, settlement_state = 'settled', affects_balance = true, effect_reason = 'settled_outgoing_with_fee'
  where momo_message_id = (select id from public.momo_messages where message_fingerprint = 'fp-d');
" >/dev/null 2>&1; then
  pass "E: correct principal+fee relationship (with a nonzero fee) against the generated net_effect_rwf is accepted"
else
  fail "E: a correct principal+fee relationship was rejected"
fi

# C. Partially populated accounting state -> rejected.
if psql -d pfe_ade -v ON_ERROR_STOP=1 -c "
  update public.transactions
  set principal_effect_rwf = -4000
  where momo_message_id = (select id from public.momo_messages where message_fingerprint = 'fp-b');
" >/dev/null 2>&1; then
  fail "C: a partially populated accounting state was incorrectly accepted"
else
  pass "C: a partially populated accounting state is rejected"
fi

# D. principal_effect_rwf + fee_effect_rwf disagrees with net_effect_rwf -> rejected.
if psql -d pfe_ade -v ON_ERROR_STOP=1 -c "
  update public.transactions
  set principal_effect_rwf = -3000, fee_effect_rwf = 0, settlement_state = 'settled', affects_balance = true, effect_reason = 'settled_outgoing_no_fee'
  where momo_message_id = (select id from public.momo_messages where message_fingerprint = 'fp-c');
" >/dev/null 2>&1; then
  fail "D: a principal+fee sum disagreeing with net_effect_rwf was incorrectly accepted"
else
  pass "D: a principal+fee sum disagreeing with net_effect_rwf is rejected"
fi

# Also: attempting to write net_effect_rwf directly must fail (it's GENERATED ALWAYS).
if psql -d pfe_ade -v ON_ERROR_STOP=1 -c "
  update public.transactions set net_effect_rwf = -1 where momo_message_id = (select id from public.momo_messages where message_fingerprint = 'fp-e');
" >/dev/null 2>&1; then
  fail "net_effect_rwf accepted a direct write - it is no longer a GENERATED ALWAYS column"
else
  pass "net_effect_rwf still rejects direct writes (GENERATED ALWAYS enforced)"
fi

# Adversarial: a positive fee_effect_rwf (wrong sign - fee must be a cost, <= 0) is rejected,
# even though principal+fee still happens to sum to the correct generated net_effect_rwf.
if psql -d pfe_ade -v ON_ERROR_STOP=1 -c "
  update public.transactions
  set principal_effect_rwf = -1040, fee_effect_rwf = 20, settlement_state = 'settled', affects_balance = true, effect_reason = 'settled_outgoing_with_fee'
  where momo_message_id = (select id from public.momo_messages where message_fingerprint = 'fp-f');
" >/dev/null 2>&1; then
  fail "a positive (wrong-sign) fee_effect_rwf was incorrectly accepted"
else
  pass "a positive (wrong-sign) fee_effect_rwf is rejected even when principal+fee still sums correctly"
fi

# Adversarial: a settled "out" transaction with a positive principal_effect_rwf is rejected.
if psql -d pfe_ade -v ON_ERROR_STOP=1 -c "
  update public.transactions
  set principal_effect_rwf = 4000, fee_effect_rwf = -4000, settlement_state = 'settled', affects_balance = true, effect_reason = 'settled_outgoing_no_fee'
  where momo_message_id = (select id from public.momo_messages where message_fingerprint = 'fp-g');
" >/dev/null 2>&1; then
  fail "a settled outgoing transaction with a positive principal_effect_rwf was incorrectly accepted"
else
  pass "a settled outgoing transaction with a positive principal_effect_rwf is rejected"
fi

# Adversarial: a settled "in" transaction with a negative principal_effect_rwf is rejected.
if psql -d pfe_ade -v ON_ERROR_STOP=1 -c "
  update public.transactions
  set principal_effect_rwf = -5000, fee_effect_rwf = 5000, settlement_state = 'settled', affects_balance = true, effect_reason = 'settled_incoming_no_fee'
  where momo_message_id = (select id from public.momo_messages where message_fingerprint = 'fp-h');
" >/dev/null 2>&1; then
  fail "a settled incoming transaction with a negative principal_effect_rwf was incorrectly accepted"
else
  pass "a settled incoming transaction with a negative principal_effect_rwf is rejected"
fi

# ===========================================================================
# I. Complete chain is deterministic across repeated fresh applications.
# ===========================================================================
echo "=== I: repeated fresh applications are deterministic ==="
bootstrap_db "pfe_i1"
apply_chain "pfe_i1"
DUMP1="$ARTIFACT_DIR/i1.sql"
pg_dump -d pfe_i1 --schema-only --no-owner -n public > "$DUMP1"

bootstrap_db "pfe_i2"
apply_chain "pfe_i2"
DUMP2="$ARTIFACT_DIR/i2.sql"
pg_dump -d pfe_i2 --schema-only --no-owner -n public > "$DUMP2"

if diff -q <(grep -v restrict "$DUMP1") <(grep -v restrict "$DUMP2") >/dev/null; then
  pass "I: two independent fresh applications of the full chain produce byte-identical schemas"
else
  fail "I: two independent fresh applications of the full chain produced DIFFERENT schemas"
fi

# ===========================================================================
# Privilege/RLS regression check after the full chain (all 4 migrations).
# ===========================================================================
echo "=== privilege/RLS regression check ==="
# 19 from the original comment (6 Phase 3 + 3 Phase B + 1 Phase C + 7
# Phase D + 2 Phase E: transaction_splits, transfer_links), plus 3 more
# added since: auth_login_attempts (20260826000000, deliberately
# service_role-only, no RLS - it's login-lockout bookkeeping, never
# queried by an authenticated user), a table from
# 20260827000000_organization_workspaces.sql,
# transaction_category_history (20260829000000, RLS enabled), and
# learned_policy_suggestion_decisions (20260831000000, RLS enabled) = 23
# tables, plus Phase J's report_preferences/report_runs/report_deliveries
# (20260902000000, all 3 RLS enabled) = 26, plus Phase K's
# report_artifacts (20260903000000, RLS enabled, zero authenticated/anon
# grants) = 27 tables, 26 with RLS, plus Phase L's ui_preferences
# (20260904000000, RLS enabled) = 28 tables, 27 with RLS - the one gap
# (auth_login_attempts) is intentional and named explicitly here so a
# genuinely *new* gap still fails loudly.
RLS_COUNT="$(psql -d pfe_h -t -A -c "select count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r' and relrowsecurity;")"
TABLE_COUNT="$(psql -d pfe_h -t -A -c "select count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r';")"
TABLES_WITHOUT_RLS="$(psql -d pfe_h -t -A -c "select string_agg(relname, ',' order by relname) from pg_class where relnamespace='public'::regnamespace and relkind='r' and not relrowsecurity;")"
# Phase M (20260906000000) adds 9 more directory tables, all RLS-enabled
# (service_providers, service_codes, service_code_parameters,
# service_code_steps, service_code_versions,
# service_directory_audit_events, service_code_reports,
# service_favourites, service_recent_usage) - 37 tables, 36 with RLS, the
# same one intentional gap.
# Phase N (20260907000000) adds 7 more, all RLS-enabled (trusted_recipients,
# payment_templates, payment_intents, payment_attempts, payment_events,
# payment_reconciliations, payment_audit_events) - 44 tables, 43 with RLS,
# the same one intentional gap.
# Phase P (20260909000000) adds 15 more, all RLS-enabled
# (directory_role_grants, regulatory_authorities, service_operators,
# payment_networks, payment_network_operators,
# institution_network_participation, access_routes, route_supported_flows,
# route_menu_steps, route_fees, route_limits, directory_sources,
# directory_evidence, directory_aliases, directory_versions) - 59 tables,
# 58 with RLS, the same one intentional gap.
# Phase P (20260909000300) adds directory_suggestions (RLS enabled) - 60
# tables, 59 with RLS.
# Phase Q (20260910000000) adds 7 more, all RLS-enabled (financial_sources,
# source_space_links, raw_financial_events, space_activity,
# space_audit_events, space_member_notification_prefs,
# workspace_categories) - 67 tables, 66 with RLS, the same one intentional
# gap. raw_financial_events has RLS enabled with no authenticated policy
# (deny-by-default, like momo_messages) - it is NOT a second exception.
# Phase R (20260912000000) adds space_member_capability_grants (RLS
# enabled, SELECT-only for authenticated) - 68 tables, 67 with RLS.
# Phase S (20260914000000) adds transaction_member_attributions (RLS
# enabled, SELECT-only for authenticated) - 69 tables, 68 with RLS.
# Phase T PR2 (20260918000000) adds budget_threshold_state (RLS enabled,
# service-role-only, no authenticated policy - like raw_financial_events)
# - 70 tables, 69 with RLS.
# Phase T PR3 (20260919000000) adds goal_participants (RLS enabled,
# SELECT-only for authenticated) - 71 tables, 70 with RLS.
# Phase V PR1 (20261001000000) adds notifications (RLS enabled,
# SELECT-own for authenticated) - 72 tables, 71 with RLS.
# Onboarding PR7 (20261007000000) adds email_send_log (RLS enabled,
# service-role-only, no authenticated policy - like raw_financial_events
# / budget_threshold_state) - 73 tables, 72 with RLS.
# Connector model Stage A (20261011000000) adds connector_installations
# and device_credentials, both RLS enabled - 75 tables, 74 with RLS.
# Connector Stage C shadow health (20261014000000) adds one service-only,
# RLS-enabled aggregate table - 76 tables, 75 with RLS.
# Connector adapter route health (20261019000000) adds one service-only,
# RLS-enabled aggregate table - 77 tables, 76 with RLS.
# Connector adapter canaries (20261020000000) adds one service-only,
# RLS-enabled installation allowlist - 79 tables, 78 with RLS.
# Integrations Phase 1 PR1 (20261027000000) adds import_templates,
# import_batches, import_records, export_templates, export_jobs and
# integration_events - all RLS enabled, SELECT gated on the
# integration.view capability, writes via service-role / PR2-5 RPCs -
# 85 tables, 84 with RLS.
# Integrations Phase 1 PR6 (20261031000000) adds export_schedules
# (RLS enabled, SELECT gated on integration.view) - 86 tables, 85 with RLS.
if [ "$TABLE_COUNT" = "86" ] && [ "$TABLES_WITHOUT_RLS" = "auth_login_attempts" ]; then
  pass "RLS enabled on all tables except the one documented, intentional exception (auth_login_attempts)"
else
  fail "RLS gap regression: $RLS_COUNT of $TABLE_COUNT public tables have RLS enabled; tables without RLS: '$TABLES_WITHOUT_RLS' (expected only 'auth_login_attempts')"
fi

# anon must remain fully revoked everywhere - Phase B never touches this.
ANON_GRANT_COUNT="$(psql -d pfe_h -t -A -c "select count(*) from information_schema.role_table_grants where table_schema='public' and grantee = 'anon';")"
if [ "$ANON_GRANT_COUNT" = "0" ]; then
  pass "no anon grants remain on any public table after the full chain"
else
  fail "anon still holds $ANON_GRANT_COUNT grant(s) after the full chain - hardening regression"
fi

# authenticated legitimately gains table-level grants in Phase B for the
# first time - this project's first real browser-authenticated access
# path - but only exactly the ones the RLS-scoped policies above expect:
# profiles (select, update), workspaces (select, update),
# workspace_memberships (select), accounts (select, insert, update),
# transactions (select, update), merchant_rules (select, insert, update)
# = 13 Phase B grants, plus Phase C's ingestion_connections (select,
# insert, update) = 3 more = 16, plus Phase D's budget_templates (select),
# budget_template_allocations (select), budgets (select, insert, update),
# budget_allocations (select, insert, update, delete),
# budget_category_mappings (select, insert, update), financial_goals
# (select, insert, update), goal_contributions (select, insert, delete)
# = 18 more = 34, plus Phase E's transaction_splits (select, insert,
# update, delete) and transfer_links (select, insert, delete) = 7 more,
# for 41 total as of Phase E. Since then: organization_workspaces
# (20260827000000) added a handful more (workspace invite handling),
# Phase F/G's transaction_category_history (select only) added 1, and
# Phase H's learned_policy_suggestion_decisions (select, insert) added 2
# more, for 47 total before Phase J. Phase J's report_preferences (select,
# insert, update) adds 3 more, and report_runs/report_deliveries (select
# only, no authenticated write path - only service_role writes them) add
# 1 each, for 52 total before Phase K. Phase K's report_artifacts adds
# zero (no authenticated/anon grants at all - see that migration's own
# header comment), so 52 remained the total through Phase K. Phase L's
# ui_preferences (select, insert, update) adds 3 more, for 55 total
# today. Asserting the exact count (not just "some") forces this test to
# be updated - a deliberate review point - if any future migration ever
# widens authenticated's table-level access.
# Phase M (20260906000000) adds 14 more: service_providers/service_codes/
# service_code_parameters/service_code_steps/service_code_versions/
# service_directory_audit_events (select only = 6), service_code_reports
# (select, insert = 2 - the UPDATE is column-scoped and does not appear
# here as a table grant), service_favourites and service_recent_usage
# (select, insert, delete = 6). 55 + 14 = 69. Phase N (20260907000000)
# adds 13 more: trusted_recipients + payment_templates (select, insert,
# update, delete = 8), payment_intents / payment_attempts /
# payment_events / payment_reconciliations / payment_audit_events (select
# only = 5). 69 + 13 = 82.
# Phase P (20260909000000) adds 15 more: 14 select-only grants
# (directory_role_grants, regulatory_authorities, service_operators,
# payment_networks, payment_network_operators,
# institution_network_participation, access_routes, route_supported_flows,
# route_menu_steps, route_fees, route_limits, directory_sources,
# directory_aliases, directory_versions) plus directory_evidence
# (select only - metadata is RLS-gated to directory.view_evidence
# holders; the file bytes are served separately via a signed URL). = 15.
# 82 + 15 = 97. Every directory-content table stays SELECT-only for
# authenticated - all writes go through the SECURITY DEFINER admin RPCs.
# Phase P (20260909000300) adds directory_suggestions (select, insert = 2)
# - the moderation status is only ever advanced by
# admin_resolve_directory_suggestion, so no update grant here. 97 + 2 = 99.
# Phase Q (20260910000000) adds 15 more: financial_sources (select, insert,
# update = 3), source_space_links (select, insert, update = 3),
# workspace_categories (select, insert, update = 3),
# space_member_notification_prefs (select, insert, update, delete = 4),
# space_activity (select = 1), space_audit_events (select = 1).
# raw_financial_events gets zero authenticated grants (service-role-only
# ingestion plumbing). space_activity / space_audit_events are SELECT-only
# because every write goes through a SECURITY DEFINER RPC (Phase R/S).
# 99 + 15 = 114.
# Phase R (20260912000000) adds space_member_capability_grants (select
# only - mutated exclusively by grant_space_capability /
# revoke_space_capability). 114 + 1 = 115.
# Phase S (20260914000000) adds transaction_member_attributions (select
# only - written exclusively by set_transaction_attribution). 115 + 1 = 116.
# Phase T PR3 (20260919000000) adds goal_participants (select only -
# written exclusively by set_goal_participants). 116 + 1 = 117.
# Phase T PR4 (20260920000000) routes workspace_categories writes through
# RPCs and revokes authenticated's insert + update grants (keeps select).
# 117 - 2 = 115.
# Phase V PR1 (20261001000000) adds notifications with a SELECT-only grant
# for authenticated. 115 + 1 = 116. Connector Stage C routes connection
# creation through an atomic RPC and revokes direct ingestion_connections
# INSERT. 116 - 1 = 115.
# Integrations Phase 1 PR1 (20261027000000) adds import_templates,
# import_batches, import_records, export_templates, export_jobs and
# integration_events - each with a SELECT-only grant for authenticated
# (all writes go through service-role / PR2-5 SECURITY DEFINER RPCs).
# 115 + 6 = 121.
# Integrations Phase 1 PR6 (20261031000000) adds export_schedules with a
# SELECT-only grant for authenticated. 121 + 1 = 122.
AUTHENTICATED_GRANT_COUNT="$(psql -d pfe_h -t -A -c "select count(*) from information_schema.role_table_grants where table_schema='public' and grantee = 'authenticated';")"
if [ "$AUTHENTICATED_GRANT_COUNT" = "122" ]; then
  pass "authenticated holds exactly the 122 table grants expected, no more"
else
  fail "authenticated holds $AUTHENTICATED_GRANT_COUNT table grant(s), expected exactly 122 - review for unintended privilege expansion"
fi

# Future-table default-privilege check, mirroring Phase 3.5's proof.
psql -d pfe_h -v ON_ERROR_STOP=1 -c "create table public.future_probe_table (id uuid primary key default gen_random_uuid());" >/dev/null
FUTURE_GRANT_COUNT="$(psql -d pfe_h -t -A -c "select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='future_probe_table' and grantee in ('anon','authenticated');")"
psql -d pfe_h -v ON_ERROR_STOP=1 -c "drop table public.future_probe_table;" >/dev/null
if [ "$FUTURE_GRANT_COUNT" = "0" ]; then
  pass "a table created after the full chain does not automatically regain anon/authenticated grants"
else
  fail "a table created after the full chain regained $FUTURE_GRANT_COUNT anon/authenticated grant(s) - ALTER DEFAULT PRIVILEGES regression"
fi

# ===========================================================================
# Function/sequence default-privilege regression checks
# (20260819000000_harden_function_and_sequence_default_privileges.sql).
# ===========================================================================
echo "=== function/sequence privilege regression check ==="

# anon legitimately gains EXECUTE on exactly one function since
# organization_workspaces (20260827000000): invite_preview(), which by
# design must be callable by someone who has an invite link but hasn't
# signed in yet.
ANON_FN_EXEC_COUNT="$(psql -d pfe_h -t -A -c "select count(*) from pg_proc p join pg_roles r on r.rolname = 'anon' where p.pronamespace='public'::regnamespace and has_function_privilege(r.oid, p.oid, 'EXECUTE');")"
if [ "$ANON_FN_EXEC_COUNT" = "1" ]; then
  pass "anon holds EXECUTE on exactly one function (invite_preview) after the full chain"
else
  fail "anon holds EXECUTE on $ANON_FN_EXEC_COUNT function grant(s) after the full chain, expected exactly 1 (invite_preview)"
fi

# authenticated gains EXECUTE on is_workspace_member() in Phase B (the RLS
# policies' own authorization primitive), 5 more from
# organization_workspaces (accept_workspace_invite, create_organization_workspace,
# invite_preview, remove_member, set_member_role), and 7 more from the
# categorization policy engine's SECURITY DEFINER functions
# (apply_manual_category_correction, confirm_transaction_category,
# dismiss_suggested_category, preview_policy_historical_match_count,
# preview_policy_historical_matches, apply_policy_to_historical,
# revert_bulk_categorization) = 13, plus Phase H's
# detect_learned_policy_suggestions = 14, plus Phase L's follow-up grant
# on is_valid_nav_order() (the ui_preferences_nav_order_shape CHECK
# constraint's helper function - not SECURITY DEFINER, so it runs with
# the calling role's own privileges and needs its own explicit grant like
# every other authenticated-callable function here) = 15 total before
# Phase M. Phase M (20260906000000) adds 4 more: is_platform_admin (the
# Pay & Services admin RLS primitive) plus the three admin RPCs
# (admin_upsert_service_code, admin_set_service_code_state,
# admin_resolve_service_code_report). Its two trigger functions
# (enforce_service_code_report_rate_limit, trim_service_recent_usage) are
# `revoke all from public` with no authenticated grant - they run as the
# table owner from the trigger, never called directly. = 19 total before
# Phase N. Phase N (20260907000000) adds 6: payment_intent_transition_allowed,
# create_payment_intent, update_draft_payment_intent,
# transition_payment_intent, record_payment_attempt,
# manually_confirm_payment. expire_stale_payment_intents is service_role-
# only; enforce_no_payment_secret is a `revoke all from public` trigger
# function. = 25 total. Every other existing function (set_updated_at,
# handle_new_user, policy_matches_transaction - SQL-only, no grant needed
# since it's only ever called from within another SECURITY DEFINER
# function) remains authenticated-inaccessible. Phase O (20260908000000)
# adds 4 authenticated-callable: normalize_rw_msisdn (the app's
# manual-link preview uses it), apply_payment_reconciliation,
# reject_payment_reconciliation, link_payment_manually. Its
# service_role-only functions (system_transition_payment_intent,
# apply_reconciliation_effects, reconciliation_candidate_intents,
# reconcile_transaction_with_payment_intents, reconcile_payment_intent)
# are `revoke ... from authenticated`. = 29 total.
# Phase P (20260909000000) adds 18 authenticated-callable functions: the
# authorization primitive has_directory_permission; the alias helper
# normalize_directory_alias; the two bootstrap RPCs
# admin_grant_directory_permission / admin_revoke_directory_permission;
# the upserts admin_upsert_regulatory_authority /
# admin_upsert_service_operator / admin_upsert_payment_network /
# admin_upsert_network_operator / admin_upsert_institution_participation /
# admin_upsert_access_route / admin_upsert_network_fee /
# admin_upsert_network_limit / admin_upsert_directory_source /
# admin_attach_directory_evidence / admin_detach_directory_evidence; and
# the three state RPCs admin_set_payment_network_state /
# admin_set_participation_state / admin_set_access_route_state. The
# internal helpers (directory_transition_allowed,
# directory_transition_permission, record_directory_version,
# record_directory_audit) and the directory_aliases_set_normalized
# trigger function are `revoke all from public` with no authenticated
# grant - they run as owner from within a SECURITY DEFINER caller or a
# trigger. The re-issued Phase M RPCs (admin_upsert_service_code etc.)
# keep their existing grants (CREATE OR REPLACE preserves privileges).
# = 47 total. Phase P (20260909000300) adds
# admin_resolve_directory_suggestion; its
# enforce_directory_suggestion_rate_limit trigger function is
# `revoke all from public`. = 48 total.
# Phase Q (20260910000000) adds 4 authenticated-callable functions: the
# user-initiated create_household_workspace RPC, plus the three
# source-visibility authorization primitives owns_financial_source,
# is_financial_source_visible, and can_view_source_in_space - each granted
# to authenticated because, like is_workspace_member, they are invoked
# from RLS policies that run as the calling role (the Phase L
# is_valid_nav_order lesson). = 52 total.
# Phase R (20260912000000) adds 3 authenticated-callable functions:
# has_space_capability (the capability authorization primitive) and the
# grant_space_capability / revoke_space_capability RPCs. Its internal
# helpers space_role_has_capability (pure matrix, called only from
# has_space_capability), record_space_activity, and record_space_audit_event
# are `revoke all from public` with no authenticated grant. The four
# re-issued RPCs (accept_workspace_invite, set_member_role, remove_member,
# create_household_workspace) keep their existing grants (CREATE OR REPLACE
# preserves privileges). = 55 total.
# Phase S (20260914000000) adds 5 authenticated-callable RPCs:
# set_source_visibility, allocate_source_to_space,
# set_source_space_link_status, set_transaction_attribution,
# reallocate_transaction. Its validate_transaction_member_attributions
# constraint-trigger function is `revoke all from public` (runs as owner
# from the trigger). = 60 total.
# Phase S PR2b (20260915000000) adds space_member_directory (the
# co-member display-name lookup the attribution UI needs, past
# profiles_select_own). = 61 total.
# Phase T PR1 (20260917000000) adds should_notify (the notification
# delivery-decision primitive) and notification_event_catalog (the
# settings-UI toggle list). Its two IMMUTABLE helpers
# (notification_event_is_security_notable, notification_default_enabled)
# are `revoke all from public` - called only from should_notify. = 63.
# Phase T PR3 (20260919000000) adds set_goal_participants and
# goal_progress. Its budget_bucket_for_percent counterpart is Phase T PR2;
# nothing else here is authenticated-callable
# (record_budget_threshold_crossing is service-role-only). = 65.
# Phase T PR4 (20260920000000) adds upsert_workspace_category and
# set_workspace_category_archived (both category.manage-gated). = 67.
# Phase U PR1 (20260921000000) adds transaction_duplicate_candidates and
# merge_duplicate_transaction (the review-UI reconcile surface). Its
# compute_transaction_fingerprint and resolve_ingestion_target are
# ingestion-only (service_role grant, no authenticated). = 69.
# Phase U PR3 (20260922000000) adds space_duplicate_review (the review
# feed) and dismiss_possible_duplicate ("not a duplicate"). = 71.
# Phase U PR7 (20260925000000) adds import_statement_transactions (the
# generic-CSV statement import write path). = 72.
# Phase V PR1 (20261001000000) adds mark_notification_read,
# mark_all_notifications_read, unread_notification_count. enqueue_notification
# is internal (no authenticated grant). = 75.
# Phase V PR2 (20261002000000) adds sweep_budget_thresholds. = 76.
# Connector Stage C (20261013000000) adds the authenticated atomic
# create_ingestion_connection_dual_write RPC. Its sync trigger and canonical
# shadow resolver are internal/service-role-only. Stage D adds four
# authenticated canonical lifecycle/credential RPCs. = 81. The installation
# canary adds pairing, kill-switch, and redacted status RPCs. = 84. The
# canonical settings cutover adds a readiness RPC and an installation-ID
# pairing entry point. Profile onboarding adds three narrow authenticated
# RPCs for its transactional stage writes. = 89.
# Integrations Phase 1 PR4 (20261029000000) adds commit_import_batch and
# rollback_import_batch (both integration.import_approve-gated SECURITY
# DEFINER RPCs). = 91.
AUTHENTICATED_FN_EXEC_COUNT="$(psql -d pfe_h -t -A -c "select count(*) from pg_proc p join pg_roles r on r.rolname = 'authenticated' where p.pronamespace='public'::regnamespace and has_function_privilege(r.oid, p.oid, 'EXECUTE');")"
if [ "$AUTHENTICATED_FN_EXEC_COUNT" = "91" ]; then
  pass "authenticated holds EXECUTE on exactly the 91 functions expected, no more"
else
  fail "authenticated holds EXECUTE on $AUTHENTICATED_FN_EXEC_COUNT function(s), expected exactly 91 - review for unintended privilege expansion"
fi

SERVICE_ROLE_FN_EXEC_COUNT="$(psql -d pfe_h -t -A -c "select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='set_updated_at' and has_function_privilege('service_role', p.oid, 'EXECUTE');")"
if [ "$SERVICE_ROLE_FN_EXEC_COUNT" = "1" ]; then
  pass "service_role retains EXECUTE on set_updated_at (unaffected by the anon/authenticated-only revoke)"
else
  fail "service_role lost EXECUTE on set_updated_at - unintended regression"
fi

# A future ordinary function created after the full chain must not
# auto-grant EXECUTE to anon/authenticated.
psql -d pfe_h -v ON_ERROR_STOP=1 -c "create function public.future_probe_function() returns int language sql as \$\$ select 1 \$\$;" >/dev/null
FUTURE_FN_GRANT_COUNT="$(psql -d pfe_h -t -A -c "select count(*) from pg_proc p join pg_roles r on r.rolname in ('anon','authenticated') where p.pronamespace='public'::regnamespace and p.proname='future_probe_function' and has_function_privilege(r.oid, p.oid, 'EXECUTE');")"
psql -d pfe_h -v ON_ERROR_STOP=1 -c "drop function public.future_probe_function();" >/dev/null
if [ "$FUTURE_FN_GRANT_COUNT" = "0" ]; then
  pass "a function created after the full chain does not automatically grant anon/authenticated EXECUTE"
else
  fail "a function created after the full chain granted anon/authenticated EXECUTE - ALTER DEFAULT PRIVILEGES ON FUNCTIONS regression"
fi

# Explicit PUBLIC check, direct on pg_proc.proacl - this is the specific
# gap this migration exists to close (PostgreSQL grants EXECUTE to PUBLIC
# on every new function unconditionally; a schema-scoped-only
# ALTER DEFAULT PRIVILEGES revoke does not suppress it, only the GLOBAL
# one does - see the migration's comments).
psql -d pfe_h -v ON_ERROR_STOP=1 -c "create function public.future_probe_function2() returns int language sql as \$\$ select 1 \$\$;" >/dev/null
FUTURE_FN_PUBLIC_ACL="$(psql -d pfe_h -t -A -c "select coalesce(proacl::text, '') from pg_proc where pronamespace='public'::regnamespace and proname='future_probe_function2';")"
psql -d pfe_h -v ON_ERROR_STOP=1 -c "drop function public.future_probe_function2();" >/dev/null
# PUBLIC's aclitem is written with nothing before the "=" (e.g. "{=X/postgres,...}"),
# unlike a named role's ("service_role=X/postgres") - match only a bare
# leading grantee, not any "=X/" substring (which every entry contains).
if [[ "$FUTURE_FN_PUBLIC_ACL" != "{=X/"* && "$FUTURE_FN_PUBLIC_ACL" != *",=X/"* ]]; then
  pass "a function created after the full chain has no implicit PUBLIC EXECUTE entry in its ACL"
else
  fail "a function created after the full chain still carries an implicit PUBLIC EXECUTE entry: $FUTURE_FN_PUBLIC_ACL"
fi

# A future sequence created after the full chain must not auto-grant
# USAGE to anon/authenticated (dormant today - no sequences exist - but
# future-proofed by the same migration).
psql -d pfe_h -v ON_ERROR_STOP=1 -c "create sequence public.future_probe_sequence;" >/dev/null
FUTURE_SEQ_GRANT_COUNT="$(psql -d pfe_h -t -A -c "select count(*) from information_schema.role_usage_grants where object_schema='public' and object_name='future_probe_sequence' and object_type='SEQUENCE' and grantee in ('anon','authenticated');")"
psql -d pfe_h -v ON_ERROR_STOP=1 -c "drop sequence public.future_probe_sequence;" >/dev/null
if [ "$FUTURE_SEQ_GRANT_COUNT" = "0" ]; then
  pass "a sequence created after the full chain does not automatically grant anon/authenticated USAGE"
else
  fail "a sequence created after the full chain granted anon/authenticated USAGE - ALTER DEFAULT PRIVILEGES ON SEQUENCES regression"
fi

# ===========================================================================
# J. New-user provisioning trigger (handle_new_user / on_auth_user_created).
# ===========================================================================
echo "=== J: new-user provisioning trigger ==="
bootstrap_db "pfe_j"
apply_chain "pfe_j"

USER_J="$(psql -d pfe_j -t -A -c "insert into auth.users (email) values ('owner@example.com') returning id;" | head -1)"

PROFILE_COUNT="$(psql -d pfe_j -t -A -c "select count(*) from public.profiles where id = '$USER_J';")"
WORKSPACE_COUNT="$(psql -d pfe_j -t -A -c "select count(*) from public.workspaces w join public.workspace_memberships m on m.workspace_id = w.id where m.user_id = '$USER_J' and w.kind = 'personal' and m.role = 'owner' and m.status = 'active';")"

if [ "$PROFILE_COUNT" = "1" ] && [ "$WORKSPACE_COUNT" = "1" ]; then
  pass "J: inserting an auth.users row provisions exactly one profile and one owned, active personal workspace"
else
  fail "J: new-user provisioning did not produce the expected profile/workspace/membership rows (profile=$PROFILE_COUNT, workspace=$WORKSPACE_COUNT)"
fi

# A second insert for a different user must not reuse or collide with the
# first. apply_chain() above already created one synthetic owner (to
# satisfy the backfill migration's precondition - see apply_chain's own
# comment), so the expected total here is 3: that synthetic owner, USER_J,
# and USER_J2.
USER_J2="$(psql -d pfe_j -t -A -c "insert into auth.users (email) values ('second@example.com') returning id;" | head -1)"
WORKSPACE_COUNT_TOTAL="$(psql -d pfe_j -t -A -c "select count(*) from public.workspaces where kind = 'personal';")"
if [ "$WORKSPACE_COUNT_TOTAL" = "3" ]; then
  pass "J: a second new user gets their own separate personal workspace, not a shared one"
else
  fail "J: expected 3 personal workspaces after apply_chain's synthetic owner plus 2 explicit signups, found $WORKSPACE_COUNT_TOTAL"
fi

# ===========================================================================
# K. Existing-data ownership backfill (20260821000100), including its
# refuse-to-guess guard.
# ===========================================================================
echo "=== K: ownership backfill migration ==="
bootstrap_db "pfe_k"
# Apply every migration up to (but not including) the backfill/tighten
# one, so this database is in exactly the pre-backfill state a real
# production application of Phase B would be in immediately after
# migration 1. Identified by filename, not "all but the last file in the
# directory" - migrations after the backfill one (e.g. Phase C) exist now
# and must NOT be applied yet at this point in the test; this test is
# specifically isolating the backfill migration's own behavior.
ALL_MIGRATIONS=("$MIGRATIONS_DIR"/*.sql)
BACKFILL_MIGRATION_NAME="20260821000100_phase_b_ownership_backfill_and_constraints.sql"
LAST_MIGRATION=""
for f in "${ALL_MIGRATIONS[@]}"; do
  if [[ "$f" == *"$BACKFILL_MIGRATION_NAME" ]]; then
    LAST_MIGRATION="$f"
    break
  fi
  psql -d pfe_k -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done

# accounting_foundation.sql (part of "all but last" above) already seeds
# the one real pre-Phase-B account ("MTN MoMo (Primary)") - reuse it
# rather than inserting a second one, so this test reflects the real
# shape production is actually in (exactly one unlinked account, seeded
# by an earlier migration, not by this test).
SEED_ACCOUNT_K="$(psql -d pfe_k -t -A -c "select id from public.accounts limit 1;" | head -1)"

psql -d pfe_k -v ON_ERROR_STOP=1 -c "
  insert into public.momo_messages (id, raw_message, processing_status)
  values ('00000000-0000-0000-0000-0000000000a2', 'seed message', 'processed');

  insert into public.transactions (id, momo_message_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version)
  values ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a2', 'send_money', 'out', 'success', 1000, 0, now(), 'test');

  insert into public.merchant_rules (id, merchant_pattern, category)
  values ('00000000-0000-0000-0000-0000000000a4', 'Test Merchant', 'Shopping');
" >/dev/null

# The owner's auth.users row is created next - handle_new_user() provisions
# their personal workspace at this point, exactly as it would at real
# signup time.
OWNER_K="$(psql -d pfe_k -t -A -c "insert into auth.users (email) values ('owner@example.com') returning id;" | head -1)"

# Now apply the backfill/tighten migration.
psql -d pfe_k -v ON_ERROR_STOP=1 -f "$LAST_MIGRATION" >/dev/null

LINKED_ACCOUNT="$(psql -d pfe_k -t -A -c "select count(*) from public.accounts a join public.workspaces w on w.id = a.workspace_id join public.workspace_memberships m on m.workspace_id = w.id where a.id = '$SEED_ACCOUNT_K' and m.user_id = '$OWNER_K';")"
LINKED_TRANSACTION="$(psql -d pfe_k -t -A -c "select count(*) from public.transactions t where t.id = '00000000-0000-0000-0000-0000000000a3' and t.account_id = '$SEED_ACCOUNT_K' and t.workspace_id is not null;")"
LINKED_RULE="$(psql -d pfe_k -t -A -c "select count(*) from public.merchant_rules r where r.id = '00000000-0000-0000-0000-0000000000a4' and r.workspace_id is not null;")"

if [ "$LINKED_ACCOUNT" = "1" ] && [ "$LINKED_TRANSACTION" = "1" ] && [ "$LINKED_RULE" = "1" ]; then
  pass "K: the backfill migration deterministically links the pre-existing account, transaction, and merchant rule to the newly-provisioned owner's workspace"
else
  fail "K: backfill did not correctly link pre-existing data (account=$LINKED_ACCOUNT, transaction=$LINKED_TRANSACTION, rule=$LINKED_RULE)"
fi

NOT_NULL_CHECK="$(psql -d pfe_k -t -A -c "select count(*) from information_schema.columns where table_schema='public' and ((table_name='accounts' and column_name='workspace_id') or (table_name='transactions' and column_name in ('account_id','workspace_id')) or (table_name='merchant_rules' and column_name='workspace_id')) and is_nullable='NO';")"
if [ "$NOT_NULL_CHECK" = "4" ]; then
  pass "K: workspace_id/account_id columns are NOT NULL after the backfill migration"
else
  fail "K: expected 4 NOT NULL columns after backfill, found $NOT_NULL_CHECK"
fi

# Guard: an ambiguous pre-backfill state (two unlinked accounts) must make
# the backfill migration refuse to guess, not silently pick one. Reapplies
# the same "up to but not including the backfill migration" boundary as
# above, by filename rather than position, so later migrations (e.g. Phase
# C) are correctly excluded here too.
bootstrap_db "pfe_k"
for f in "${ALL_MIGRATIONS[@]}"; do
  if [[ "$f" == *"$BACKFILL_MIGRATION_NAME" ]]; then
    break
  fi
  psql -d pfe_k -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done
psql -d pfe_k -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into public.accounts (id, name, provider, currency) values
  ('00000000-0000-0000-0000-0000000000b1', 'Account One', 'mtn_momo', 'RWF'),
  ('00000000-0000-0000-0000-0000000000b2', 'Account Two', 'mtn_momo', 'RWF');
SQL
psql -d pfe_k -t -A -c "insert into auth.users (email) values ('owner2@example.com');" >/dev/null

if psql -d pfe_k -v ON_ERROR_STOP=1 -f "$LAST_MIGRATION" >/dev/null 2>$ARTIFACT_DIR/pfe_backfill_guard_stderr.log; then
  fail "K: backfill migration should have refused to run against an ambiguous state (2 unlinked accounts) but succeeded"
else
  if grep -q "expects exactly one unlinked account" $ARTIFACT_DIR/pfe_backfill_guard_stderr.log; then
    pass "K: backfill migration refuses to guess when more than one unlinked account exists, exactly as designed"
  else
    fail "K: backfill migration failed against an ambiguous state, but not for the expected reason - see $ARTIFACT_DIR/pfe_backfill_guard_stderr.log"
  fi
fi
rm -f $ARTIFACT_DIR/pfe_backfill_guard_stderr.log

# ===========================================================================
# RLS. Tenant isolation between two independent users/workspaces, and
# proof that service_role remains unaffected by every policy above.
# ===========================================================================
echo "=== RLS: tenant isolation ==="
bootstrap_db "pfe_rls"
apply_chain "pfe_rls"

USER_A="$(psql -d pfe_rls -t -A -c "insert into auth.users (email) values ('a@example.com') returning id;" | head -1)"
USER_B="$(psql -d pfe_rls -t -A -c "insert into auth.users (email) values ('b@example.com') returning id;" | head -1)"
WORKSPACE_A="$(psql -d pfe_rls -t -A -c "select w.id from public.workspaces w join public.workspace_memberships m on m.workspace_id = w.id where m.user_id = '$USER_A';" | head -1)"
WORKSPACE_B="$(psql -d pfe_rls -t -A -c "select w.id from public.workspaces w join public.workspace_memberships m on m.workspace_id = w.id where m.user_id = '$USER_B';" | head -1)"

psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  insert into public.accounts (id, workspace_id, name, provider, currency)
  values ('00000000-0000-0000-0000-0000000000c1', '$WORKSPACE_B', 'B Account', 'mtn_momo', 'RWF');
  insert into public.momo_messages (id, raw_message, processing_status)
  values ('00000000-0000-0000-0000-0000000000c2', 'seed', 'processed');
  insert into public.transactions (id, momo_message_id, account_id, workspace_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version)
  values ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c1', '$WORKSPACE_B', 'send_money', 'out', 'success', 500, 0, now(), 'test');
" >/dev/null

as_user() {
  local user_id="$1"
  local sql="$2"
  # SET ROLE and the set_config() call each print their own output line
  # even under -t/-A (a "SET" command tag and the config's return value),
  # and a final DML statement without RETURNING prints its own completion
  # tag (e.g. "INSERT 0 1") the same way - only the final statement's
  # actual result (a SELECT's row, or a RETURNING clause's row) is wanted,
  # so drop every line that is just a bare command tag and take whatever
  # remains last.
  psql -d pfe_rls -t -A -c "set role authenticated; select set_config('request.jwt.claim.sub', '$user_id', false); select set_config('request.jwt.claims', '{\"sub\":\"$user_id\",\"aal\":\"aal1\"}', false); $sql" \
    | grep -Ev '^(SET|INSERT [0-9]+ [0-9]+|UPDATE [0-9]+|DELETE [0-9]+)$' \
    | tail -1
}

as_user_aal() {
  local user_id="$1"
  local aal="$2"
  local sql="$3"
  psql -d pfe_rls -t -A -c "set role authenticated; select set_config('request.jwt.claim.sub', '$user_id', false); select set_config('request.jwt.claims', '{\"sub\":\"$user_id\",\"aal\":\"$aal\"}', false); $sql" \
    | grep -Ev '^(SET|INSERT [0-9]+ [0-9]+|UPDATE [0-9]+|DELETE [0-9]+)$' \
    | tail -1
}

# A cannot read B's workspace, account, or transaction.
READ_OTHER_WORKSPACE="$(as_user "$USER_A" "select count(*) from public.workspaces where id = '$WORKSPACE_B';")"
READ_OTHER_ACCOUNT="$(as_user "$USER_A" "select count(*) from public.accounts where id = '00000000-0000-0000-0000-0000000000c1';")"
READ_OTHER_TRANSACTION="$(as_user "$USER_A" "select count(*) from public.transactions where id = '00000000-0000-0000-0000-0000000000c3';")"
if [ "$READ_OTHER_WORKSPACE" = "0" ] && [ "$READ_OTHER_ACCOUNT" = "0" ] && [ "$READ_OTHER_TRANSACTION" = "0" ]; then
  pass "RLS: User A cannot read User B's workspace, account, or transaction"
else
  fail "RLS: User A read User B's data (workspace=$READ_OTHER_WORKSPACE account=$READ_OTHER_ACCOUNT transaction=$READ_OTHER_TRANSACTION) - isolation breach"
fi

# A cannot update B's transaction (category correction path).
as_user "$USER_A" "update public.transactions set category = 'Hacked' where id = '00000000-0000-0000-0000-0000000000c3';" >/dev/null
CATEGORY_UNCHANGED="$(psql -d pfe_rls -t -A -c "select count(*) from public.transactions where id = '00000000-0000-0000-0000-0000000000c3' and category is null;")"
if [ "$CATEGORY_UNCHANGED" = "1" ]; then
  pass "RLS: User A cannot update User B's transaction"
else
  fail "RLS: User A's update against User B's transaction was not blocked - isolation breach"
fi

# A cannot insert an account into B's workspace.
if as_user "$USER_A" "insert into public.accounts (workspace_id, name, provider, currency) values ('$WORKSPACE_B', 'Forged', 'mtn_momo', 'RWF');" >/dev/null 2>$ARTIFACT_DIR/pfe_rls_insert_stderr.log; then
  fail "RLS: User A was able to insert an account into User B's workspace - isolation breach"
else
  pass "RLS: User A cannot insert an account into User B's workspace"
fi
rm -f $ARTIFACT_DIR/pfe_rls_insert_stderr.log

# A cannot delete B's account (no delete policy exists for authenticated at all).
as_user "$USER_A" "delete from public.accounts where id = '00000000-0000-0000-0000-0000000000c1';" >/dev/null 2>&1 || true
ACCOUNT_STILL_EXISTS="$(psql -d pfe_rls -t -A -c "select count(*) from public.accounts where id = '00000000-0000-0000-0000-0000000000c1';")"
if [ "$ACCOUNT_STILL_EXISTS" = "1" ]; then
  pass "RLS: User A cannot delete User B's account (no delete grant/policy for authenticated)"
else
  fail "RLS: User A deleted User B's account - isolation breach"
fi

# A CAN read and correct a category on their own workspace's data (positive
# control - proves the policies are not simply denying everyone, only
# non-members).
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  insert into public.accounts (id, workspace_id, name, provider, currency)
  values ('00000000-0000-0000-0000-0000000000d1', '$WORKSPACE_A', 'A Account', 'mtn_momo', 'RWF');
  insert into public.momo_messages (id, raw_message, processing_status)
  values ('00000000-0000-0000-0000-0000000000d2', 'seed', 'processed');
  insert into public.transactions (id, momo_message_id, account_id, workspace_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version)
  values ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1', '$WORKSPACE_A', 'send_money', 'out', 'success', 750, 0, now(), 'test');
" >/dev/null
as_user "$USER_A" "update public.transactions set category = 'Groceries' where id = '00000000-0000-0000-0000-0000000000d3';" >/dev/null
OWN_CATEGORY_SET="$(psql -d pfe_rls -t -A -c "select count(*) from public.transactions where id = '00000000-0000-0000-0000-0000000000d3' and category = 'Groceries';")"
if [ "$OWN_CATEGORY_SET" = "1" ]; then
  pass "RLS: User A can read and categorize their own workspace's transaction (positive control)"
else
  fail "RLS: User A could not correct a category on their own workspace's transaction - policies are over-blocking"
fi

# service_role must remain completely unaffected by every policy above.
SERVICE_ROLE_SEES_BOTH="$(psql -d pfe_rls -t -A -c "set role service_role; select count(*) from public.transactions where id in ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000d3');" | tail -1)"
if [ "$SERVICE_ROLE_SEES_BOTH" = "2" ]; then
  pass "RLS: service_role still sees every workspace's data, unaffected by RLS (as required for ingest-momo to keep working)"
else
  fail "RLS: service_role's visibility changed ($SERVICE_ROLE_SEES_BOTH of 2 expected) - would break ingest-momo"
fi

# ===========================================================================
# Phase C: account lifecycle (is_primary uniqueness, archived/active
# consistency) and ingestion_connections (RLS CRUD, credential-hash
# uniqueness, bound-account routing, and adversarial cross-workspace
# isolation - the two-user isolation suite the master prompt requires,
# extended to the new Phase C tables). Reuses pfe_rls (already bootstrapped
# above with USER_A/WORKSPACE_A/account d1 and USER_B/WORKSPACE_B/account
# c1) rather than standing up a fresh database.
# ===========================================================================
echo "=== Phase C: accounts and ingestion_connections ==="

# --- account lifecycle -----------------------------------------------------

# At most one primary account per workspace.
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  insert into public.accounts (id, workspace_id, name, provider, currency)
  values ('00000000-0000-0000-0000-0000000000e1', '$WORKSPACE_A', 'A Second Account', 'mtn_momo', 'RWF');
  update public.accounts set is_primary = true where id = '00000000-0000-0000-0000-0000000000d1';
" >/dev/null
if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "update public.accounts set is_primary = true where id = '00000000-0000-0000-0000-0000000000e1';" >/dev/null 2>$ARTIFACT_DIR/pfe_primary_stderr.log; then
  fail "Phase C: a workspace was allowed two primary accounts - idx_accounts_one_primary_per_workspace not enforced"
else
  pass "Phase C: at most one primary account per workspace is enforced"
fi
rm -f $ARTIFACT_DIR/pfe_primary_stderr.log

# archived_at must be null iff is_active = true.
if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "update public.accounts set is_active = false where id = '00000000-0000-0000-0000-0000000000e1';" >/dev/null 2>$ARTIFACT_DIR/pfe_archive_stderr.log; then
  fail "Phase C: an account was set inactive without archived_at - accounts_archived_consistent_with_active not enforced"
else
  pass "Phase C: archiving an account requires archived_at to be set consistently with is_active"
fi
rm -f $ARTIFACT_DIR/pfe_archive_stderr.log
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "update public.accounts set is_active = false, archived_at = now() where id = '00000000-0000-0000-0000-0000000000e1';" >/dev/null
ARCHIVED_OK="$(psql -d pfe_rls -t -A -c "select count(*) from public.accounts where id = '00000000-0000-0000-0000-0000000000e1' and is_active = false and archived_at is not null;")"
if [ "$ARCHIVED_OK" = "1" ]; then
  pass "Phase C: archiving an account with both fields set consistently succeeds"
else
  fail "Phase C: archiving an account with both fields set consistently was unexpectedly rejected"
fi

# --- ingestion_connections: ownership, RLS CRUD -----------------------------

# A third user, added as a non-owner member of workspace A, to exercise the
# select-yes/write-no boundary the owner-only write policies are meant to
# enforce (Phase B only ever creates role=owner rows via signup, so this
# membership is seeded directly, exactly as is_workspace_member's own
# comments anticipate for Phase C).
USER_C="$(psql -d pfe_rls -t -A -c "insert into auth.users (email) values ('c@example.com') returning id;" | head -1)"
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  insert into public.workspace_memberships (workspace_id, user_id, role, status, joined_at)
  values ('$WORKSPACE_A', '$USER_C', 'member', 'active', now());
  insert into public.financial_sources
    (id, owner_user_id, provider, source_type, display_name, currency)
  values
    ('00000000-0000-4000-8000-0000000000d1', '$USER_A', 'mtn_momo', 'mobile_money', 'A source', 'RWF'),
    ('00000000-0000-4000-8000-0000000000c1', '$USER_B', 'mtn_momo', 'mobile_money', 'B source', 'RWF');
  update public.accounts set financial_source_id = '00000000-0000-4000-8000-0000000000d1'
    where id = '00000000-0000-0000-0000-0000000000d1';
  update public.accounts set financial_source_id = '00000000-0000-4000-8000-0000000000c1'
    where id = '00000000-0000-0000-0000-0000000000c1';
" >/dev/null

CONN_A="$(as_user "$USER_A" "select public.create_ingestion_connection_dual_write('$WORKSPACE_A', '00000000-0000-0000-0000-0000000000d1', 'A''s Phone', 'mtn_momo', 'hash-a-conn-1', 'pfe_aaaa');" | tail -1)"
if [ -n "$CONN_A" ]; then
  pass "Phase C: workspace owner can create an ingestion connection bound to their own account"
else
  fail "Phase C: workspace owner was unable to create an ingestion connection"
fi

# Non-owner member: can read, cannot write.
MEMBER_SEES_CONN="$(as_user "$USER_C" "select count(*) from public.ingestion_connections where id = '$CONN_A';")"
if [ "$MEMBER_SEES_CONN" = "1" ]; then
  pass "Phase C: a non-owner workspace member can see the workspace's ingestion connections"
else
  fail "Phase C: a non-owner workspace member could not see their own workspace's ingestion connection"
fi
if as_user "$USER_C" "insert into public.ingestion_connections (workspace_id, account_id, label, credential_hash, credential_prefix, created_by) values ('$WORKSPACE_A', '00000000-0000-0000-0000-0000000000d1', 'C''s Phone', 'hash-c-conn-1', 'pfe_cccc', '$USER_C');" >/dev/null 2>$ARTIFACT_DIR/pfe_member_insert_stderr.log; then
  fail "Phase C: a non-owner workspace member was able to create an ingestion connection - owner-only write policy not enforced"
else
  pass "Phase C: a non-owner workspace member cannot create an ingestion connection (owner-only)"
fi
rm -f $ARTIFACT_DIR/pfe_member_insert_stderr.log
if as_user "$USER_C" "update public.ingestion_connections set status = 'revoked', revoked_at = now() where id = '$CONN_A';" >/dev/null 2>$ARTIFACT_DIR/pfe_member_update_stderr.log; then
  :
fi
CONN_STILL_ACTIVE="$(psql -d pfe_rls -t -A -c "select count(*) from public.ingestion_connections where id = '$CONN_A' and status = 'active';")"
if [ "$CONN_STILL_ACTIVE" = "1" ]; then
  pass "Phase C: a non-owner workspace member cannot revoke another member's ingestion connection"
else
  fail "Phase C: a non-owner workspace member was able to revoke an ingestion connection - isolation breach"
fi
rm -f $ARTIFACT_DIR/pfe_member_update_stderr.log

# --- ingestion_connections: adversarial cross-workspace isolation ----------

# User B (unrelated workspace) cannot see User A's connection at all.
B_SEES_A_CONN="$(as_user "$USER_B" "select count(*) from public.ingestion_connections where id = '$CONN_A';")"
if [ "$B_SEES_A_CONN" = "0" ]; then
  pass "Phase C: User B cannot see User A's ingestion connection"
else
  fail "Phase C: User B was able to read User A's ingestion connection - isolation breach"
fi

# User B cannot revoke User A's connection by spoofing its id.
as_user "$USER_B" "update public.ingestion_connections set status = 'revoked', revoked_at = now() where id = '$CONN_A';" >/dev/null 2>&1 || true
CONN_STILL_ACTIVE_2="$(psql -d pfe_rls -t -A -c "select count(*) from public.ingestion_connections where id = '$CONN_A' and status = 'active';")"
if [ "$CONN_STILL_ACTIVE_2" = "1" ]; then
  pass "Phase C: User B cannot revoke User A's ingestion connection by spoofing its id"
else
  fail "Phase C: User B was able to revoke User A's ingestion connection - isolation breach"
fi

# User A cannot create a connection in User B's workspace (owner-only write
# policy also blocks cross-workspace forgery, independent of the FK check
# below).
if as_user "$USER_A" "insert into public.ingestion_connections (workspace_id, account_id, label, credential_hash, credential_prefix, created_by) values ('$WORKSPACE_B', '00000000-0000-0000-0000-0000000000c1', 'Forged', 'hash-forged-1', 'pfe_ffff', '$USER_A');" >/dev/null 2>$ARTIFACT_DIR/pfe_forge_stderr.log; then
  fail "Phase C: User A was able to create an ingestion connection in User B's workspace - isolation breach"
else
  pass "Phase C: User A cannot create an ingestion connection in User B's workspace"
fi
rm -f $ARTIFACT_DIR/pfe_forge_stderr.log

# Even service_role (bypassing RLS entirely) cannot bind a connection to an
# account that belongs to a different workspace than the connection itself
# - ingestion_connections_account_same_workspace is a database-level
# guarantee, not just an RLS/application check, so a bug in future
# application code can never route a connection cross-workspace.
if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "insert into public.ingestion_connections (workspace_id, account_id, label, credential_hash, credential_prefix) values ('$WORKSPACE_A', '00000000-0000-0000-0000-0000000000c1', 'Mismatched', 'hash-mismatch-1', 'pfe_mmmm');" >/dev/null 2>$ARTIFACT_DIR/pfe_mismatch_stderr.log; then
  fail "Phase C: a connection was created with account_id/workspace_id from different workspaces - ingestion_connections_account_same_workspace not enforced"
else
  pass "Phase C: a connection's account_id must belong to the same workspace_id, enforced at the database level even for service_role"
fi
rm -f $ARTIFACT_DIR/pfe_mismatch_stderr.log

# credential_hash must be globally unique (the sole lookup path ingest-momo
# will use to authenticate a request).
if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "insert into public.ingestion_connections (workspace_id, account_id, label, credential_hash, credential_prefix) values ('$WORKSPACE_B', '00000000-0000-0000-0000-0000000000c1', 'Dup Hash', 'hash-a-conn-1', 'pfe_dddd');" >/dev/null 2>$ARTIFACT_DIR/pfe_duphash_stderr.log; then
  fail "Phase C: two ingestion connections were created with the same credential_hash - unique constraint not enforced"
else
  pass "Phase C: credential_hash is globally unique across all workspaces"
fi
rm -f $ARTIFACT_DIR/pfe_duphash_stderr.log

# Owner can revoke their own connection (positive control).
as_user "$USER_A" "update public.ingestion_connections set status = 'revoked', revoked_at = now() where id = '$CONN_A';" >/dev/null
CONN_REVOKED="$(psql -d pfe_rls -t -A -c "select count(*) from public.ingestion_connections where id = '$CONN_A' and status = 'revoked';")"
if [ "$CONN_REVOKED" = "1" ]; then
  pass "Phase C: workspace owner can revoke their own ingestion connection"
else
  fail "Phase C: workspace owner was unable to revoke their own ingestion connection"
fi

# ===========================================================================
# Phase D: budgets, allocations, category mappings, and goals. Reuses
# pfe_rls (USER_A/WORKSPACE_A, USER_B/WORKSPACE_B already established
# above) rather than standing up a fresh database.
# ===========================================================================
echo "=== Phase D: budgets, allocations, category mappings, and goals ==="

# --- allocation-sum-100 invariant, at activation time -----------------------

DRAFT_BUDGET="$(psql -d pfe_rls -t -A -c "
  insert into public.budgets (workspace_id, name, currency, period_start, period_end, income_amount_minor, normalized_monthly_income_minor, normalized_annual_income_minor, income_frequency)
  values ('$WORKSPACE_A', 'August', 'RWF', '2026-08-01', '2026-08-31', 500000, 500000, 6000000, 'monthly')
  returning id;" | head -1)"
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  insert into public.budget_allocations (budget_id, workspace_id, allocation_type, percentage, target_amount_minor)
  values
    ('$DRAFT_BUDGET', '$WORKSPACE_A', 'ESSENTIALS', 50.00, 250000),
    ('$DRAFT_BUDGET', '$WORKSPACE_A', 'INVESTING', 15.00, 75000),
    ('$DRAFT_BUDGET', '$WORKSPACE_A', 'EMERGENCY', 5.00, 25000),
    ('$DRAFT_BUDGET', '$WORKSPACE_A', 'WANTS', 20.00, 100000);
" >/dev/null

# Under-allocated (90%) budget refuses to activate.
if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "update public.budgets set status = 'active' where id = '$DRAFT_BUDGET';" >/dev/null 2>$ARTIFACT_DIR/pfe_activate_stderr.log; then
  fail "Phase D: a budget with allocations totaling 90% was allowed to activate"
else
  pass "Phase D: activation is refused when allocation percentages do not total 100%"
fi
rm -f $ARTIFACT_DIR/pfe_activate_stderr.log

# Correct the allocations to sum to 100% and activation succeeds.
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  update public.budget_allocations set percentage = 30.00, target_amount_minor = 150000
  where budget_id = '$DRAFT_BUDGET' and allocation_type = 'WANTS';
  update public.budgets set status = 'active' where id = '$DRAFT_BUDGET';
" >/dev/null
BUDGET_ACTIVE="$(psql -d pfe_rls -t -A -c "select count(*) from public.budgets where id = '$DRAFT_BUDGET' and status = 'active' and activated_at is not null;")"
if [ "$BUDGET_ACTIVE" = "1" ]; then
  pass "Phase D: a budget with allocations totaling exactly 100% activates and stamps activated_at"
else
  fail "Phase D: a correctly-allocated budget failed to activate"
fi

# --- allocation-sum-100 invariant, on later edits to an active budget ------

if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "update public.budget_allocations set percentage = 10.00, target_amount_minor = 50000 where budget_id = '$DRAFT_BUDGET' and allocation_type = 'EMERGENCY';" >/dev/null 2>$ARTIFACT_DIR/pfe_edit_stderr.log; then
  fail "Phase D: editing an active budget's allocation to break the 100% total was allowed"
else
  pass "Phase D: editing an active budget's allocations to no longer total 100% is rejected"
fi
rm -f $ARTIFACT_DIR/pfe_edit_stderr.log

# --- one active budget per workspace+currency -------------------------------

if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  insert into public.budgets (workspace_id, name, currency, period_start, period_end, income_amount_minor, normalized_monthly_income_minor, normalized_annual_income_minor, income_frequency, status, activated_at)
  values ('$WORKSPACE_A', 'August Duplicate', 'RWF', '2026-08-01', '2026-08-31', 500000, 500000, 6000000, 'monthly', 'active', now());
" >/dev/null 2>$ARTIFACT_DIR/pfe_dupactive_stderr.log; then
  fail "Phase D: a second active RWF budget was allowed in the same workspace"
else
  pass "Phase D: at most one active budget per workspace+currency is enforced"
fi
rm -f $ARTIFACT_DIR/pfe_dupactive_stderr.log

# --- category mappings: cross-workspace isolation ---------------------------

psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  insert into public.budget_category_mappings (workspace_id, category, allocation_type)
  values ('$WORKSPACE_A', 'Groceries', 'ESSENTIALS');
" >/dev/null
B_SEES_A_MAPPING="$(as_user "$USER_B" "select count(*) from public.budget_category_mappings where workspace_id = '$WORKSPACE_A';")"
if [ "$B_SEES_A_MAPPING" = "0" ]; then
  pass "Phase D: User B cannot see User A's category mappings"
else
  fail "Phase D: User B could read User A's category mappings - isolation breach"
fi

# --- financial goals and contributions --------------------------------------

GOAL_A="$(psql -d pfe_rls -t -A -c "
  insert into public.financial_goals (workspace_id, goal_type, name, currency, target_amount_minor)
  values ('$WORKSPACE_A', 'emergency_fund', 'Emergency fund', 'RWF', 1000000)
  returning id;" | head -1)"

as_user "$USER_A" "insert into public.goal_contributions (goal_id, workspace_id, amount_minor, source) values ('$GOAL_A', '$WORKSPACE_A', 50000, 'manual');" >/dev/null
GOAL_TOTAL_AFTER_ONE="$(psql -d pfe_rls -t -A -c "select current_amount_minor from public.financial_goals where id = '$GOAL_A';")"
if [ "$GOAL_TOTAL_AFTER_ONE" = "50000" ]; then
  pass "Phase D: a goal contribution is reflected in current_amount_minor via the maintenance trigger"
else
  fail "Phase D: current_amount_minor was $GOAL_TOTAL_AFTER_ONE after a 50000 contribution, expected 50000"
fi

# A transaction can fund at most one goal (double-counting protection).
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  insert into public.momo_messages (id, raw_message, processing_status)
  values ('00000000-0000-0000-0000-0000000000f2', 'seed', 'processed');
  insert into public.transactions (id, momo_message_id, account_id, workspace_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version)
  values ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000d1', '$WORKSPACE_A', 'money_received', 'in', 'success', 20000, 0, now(), 'test');
  insert into public.goal_contributions (goal_id, workspace_id, transaction_id, amount_minor, source)
  values ('$GOAL_A', '$WORKSPACE_A', '00000000-0000-0000-0000-0000000000f3', 20000, 'transaction_link');
" >/dev/null
GOAL_B="$(psql -d pfe_rls -t -A -c "
  insert into public.financial_goals (workspace_id, goal_type, name, currency, target_amount_minor)
  values ('$WORKSPACE_A', 'general_savings', 'Second goal', 'RWF', 500000)
  returning id;" | head -1)"
if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  insert into public.goal_contributions (goal_id, workspace_id, transaction_id, amount_minor, source)
  values ('$GOAL_B', '$WORKSPACE_A', '00000000-0000-0000-0000-0000000000f3', 20000, 'transaction_link');
" >/dev/null 2>$ARTIFACT_DIR/pfe_dupcontrib_stderr.log; then
  fail "Phase D: the same transaction was linked as a contribution to two different goals"
else
  pass "Phase D: a transaction cannot be linked as a contribution to more than one goal"
fi
rm -f $ARTIFACT_DIR/pfe_dupcontrib_stderr.log

# User B cannot see or delete User A's goal or contributions.
B_SEES_GOAL="$(as_user "$USER_B" "select count(*) from public.financial_goals where id = '$GOAL_A';")"
as_user "$USER_B" "delete from public.goal_contributions where goal_id = '$GOAL_A';" >/dev/null 2>&1 || true
GOAL_CONTRIBUTIONS_INTACT="$(psql -d pfe_rls -t -A -c "select count(*) from public.goal_contributions where goal_id = '$GOAL_A';")"
if [ "$B_SEES_GOAL" = "0" ] && [ "$GOAL_CONTRIBUTIONS_INTACT" = "2" ]; then
  pass "Phase D: User B cannot see or delete User A's goal or its contributions"
else
  fail "Phase D: User B saw the goal ($B_SEES_GOAL) or deleted contributions (now $GOAL_CONTRIBUTIONS_INTACT of 2 expected) - isolation breach"
fi

# ===========================================================================
# Phase E: manual transactions (momo_message_id relaxation), split
# transactions, and transfer links. Reuses pfe_rls (USER_A/WORKSPACE_A,
# USER_B/WORKSPACE_B, and the accounts/transactions seeded above).
# ===========================================================================
echo "=== Phase E: manual transactions, splits, and transfer links ==="

# --- momo_message_id relaxation ---------------------------------------------

if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  insert into public.transactions (id, momo_message_id, account_id, workspace_id, source, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version)
  values ('00000000-0000-0000-0000-0000000000f5', null, '00000000-0000-0000-0000-0000000000d1', '$WORKSPACE_A', 'manual', 'other', 'out', 'success', 1000, 0, now(), 'manual-entry-v1');
" >/dev/null 2>$ARTIFACT_DIR/pfe_manual_stderr.log; then
  pass "Phase E: a source='manual' transaction may have a null momo_message_id"
else
  fail "Phase E: a manual transaction with no momo_message_id was rejected: $(cat $ARTIFACT_DIR/pfe_manual_stderr.log)"
fi
rm -f $ARTIFACT_DIR/pfe_manual_stderr.log

if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  insert into public.transactions (id, momo_message_id, account_id, workspace_id, source, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version)
  values ('00000000-0000-0000-0000-0000000000f6', null, '00000000-0000-0000-0000-0000000000d1', '$WORKSPACE_A', 'mtn_momo', 'other', 'out', 'success', 1000, 0, now(), 'test');
" >/dev/null 2>$ARTIFACT_DIR/pfe_nonmanual_stderr.log; then
  fail "Phase E: a non-manual transaction with a null momo_message_id was allowed"
else
  pass "Phase E: every non-manual transaction still requires a momo_message_id"
fi
rm -f $ARTIFACT_DIR/pfe_nonmanual_stderr.log

# --- transaction_splits: sum-to-effect invariant ----------------------------

psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  insert into public.momo_messages (id, raw_message, processing_status)
  values ('00000000-0000-0000-0000-0000000000f7', 'seed', 'processed');
  insert into public.transactions (id, momo_message_id, account_id, workspace_id, transaction_type, direction, status, amount_rwf, fee_rwf, principal_effect_rwf, fee_effect_rwf, settlement_state, affects_balance, effect_reason, occurred_at, parser_version)
  values ('00000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-0000000000d1', '$WORKSPACE_A', 'merchant_payment', 'out', 'success', 1000, 0, -1000, 0, 'settled', true, 'test', now(), 'test');
" >/dev/null

# A single multi-row insert summing exactly to the transaction's effect succeeds.
if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  insert into public.transaction_splits (transaction_id, workspace_id, allocation_type, amount_minor) values
    ('00000000-0000-0000-0000-0000000000f8', '$WORKSPACE_A', 'ESSENTIALS', 600),
    ('00000000-0000-0000-0000-0000000000f8', '$WORKSPACE_A', 'WANTS', 400);
" >/dev/null 2>$ARTIFACT_DIR/pfe_split_ok_stderr.log; then
  pass "Phase E: a multi-row split insert summing exactly to the transaction's effect succeeds"
else
  fail "Phase E: a correctly-summed split insert was rejected: $(cat $ARTIFACT_DIR/pfe_split_ok_stderr.log)"
fi
rm -f $ARTIFACT_DIR/pfe_split_ok_stderr.log
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "delete from public.transaction_splits where transaction_id = '00000000-0000-0000-0000-0000000000f8';" >/dev/null

# A multi-row insert that does NOT sum to the transaction's effect is
# rejected - the deferred constraint trigger catches it after all rows of
# the single statement have landed, not on the first row.
if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  insert into public.transaction_splits (transaction_id, workspace_id, allocation_type, amount_minor) values
    ('00000000-0000-0000-0000-0000000000f8', '$WORKSPACE_A', 'ESSENTIALS', 600),
    ('00000000-0000-0000-0000-0000000000f8', '$WORKSPACE_A', 'WANTS', 500);
" >/dev/null 2>$ARTIFACT_DIR/pfe_split_bad_stderr.log; then
  fail "Phase E: a split insert totaling 1100 against a 1000 transaction was allowed"
else
  pass "Phase E: a split insert not summing to the transaction's effect is rejected"
fi
rm -f $ARTIFACT_DIR/pfe_split_bad_stderr.log
SPLITS_AFTER_FAILED_INSERT="$(psql -d pfe_rls -t -A -c "select count(*) from public.transaction_splits where transaction_id = '00000000-0000-0000-0000-0000000000f8';")"
if [ "$SPLITS_AFTER_FAILED_INSERT" = "0" ]; then
  pass "Phase E: the rejected split insert left no partial rows behind (whole statement rolled back)"
else
  fail "Phase E: $SPLITS_AFTER_FAILED_INSERT split row(s) survived a rejected insert - partial write"
fi

# Cannot split a transaction the accounting engine hasn't processed yet
# (principal_effect_rwf/fee_effect_rwf still null).
if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  insert into public.transaction_splits (transaction_id, workspace_id, allocation_type, amount_minor)
  values ('00000000-0000-0000-0000-0000000000d3', '$WORKSPACE_A', 'ESSENTIALS', 750);
" >/dev/null 2>$ARTIFACT_DIR/pfe_split_unprocessed_stderr.log; then
  fail "Phase E: a transaction with no accounting effect yet was allowed to be split"
else
  pass "Phase E: an unprocessed transaction (no accounting effect) cannot be split"
fi
rm -f $ARTIFACT_DIR/pfe_split_unprocessed_stderr.log

# User B cannot see or write User A's splits.
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  insert into public.transaction_splits (transaction_id, workspace_id, allocation_type, amount_minor)
  values ('00000000-0000-0000-0000-0000000000f8', '$WORKSPACE_A', 'ESSENTIALS', 1000);
" >/dev/null
B_SEES_SPLIT="$(as_user "$USER_B" "select count(*) from public.transaction_splits where transaction_id = '00000000-0000-0000-0000-0000000000f8';")"
if [ "$B_SEES_SPLIT" = "0" ]; then
  pass "Phase E: User B cannot see User A's transaction splits"
else
  fail "Phase E: User B could read User A's transaction splits - isolation breach"
fi

# --- transfer_links ----------------------------------------------------------

TRANSFER_LINK_A="$(psql -d pfe_rls -t -A -c "
  insert into public.transfer_links (workspace_id, out_transaction_id, in_transaction_id, status)
  values ('$WORKSPACE_A', '00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000f3', 'linked')
  returning id;" | head -1)"

# The same out_transaction_id cannot be the OUT side of a second active link.
if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  insert into public.transfer_links (workspace_id, out_transaction_id, in_transaction_id, status)
  values ('$WORKSPACE_A', '00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000f8', 'linked');
" >/dev/null 2>$ARTIFACT_DIR/pfe_dup_transfer_stderr.log; then
  fail "Phase E: the same transaction was linked as the OUT side of two active transfers"
else
  pass "Phase E: a transaction can be the OUT side of at most one active transfer link"
fi
rm -f $ARTIFACT_DIR/pfe_dup_transfer_stderr.log

# A transaction cannot be linked to itself.
if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  insert into public.transfer_links (workspace_id, out_transaction_id, in_transaction_id, status)
  values ('$WORKSPACE_A', '00000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-0000000000f8', 'linked');
" >/dev/null 2>$ARTIFACT_DIR/pfe_self_transfer_stderr.log; then
  fail "Phase E: a transaction was linked to itself as a transfer"
else
  pass "Phase E: a transaction cannot be linked to itself as a transfer"
fi
rm -f $ARTIFACT_DIR/pfe_self_transfer_stderr.log

# A dismissed row reusing an already-linked out_transaction_id is allowed
# (the partial unique index only governs status='linked').
if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  insert into public.transfer_links (workspace_id, out_transaction_id, in_transaction_id, status)
  values ('$WORKSPACE_A', '00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000f8', 'dismissed');
" >/dev/null 2>$ARTIFACT_DIR/pfe_dismissed_transfer_stderr.log; then
  pass "Phase E: a dismissed transfer suggestion does not conflict with an existing linked one"
else
  fail "Phase E: a dismissed-status row was incorrectly blocked by the linked-only unique index: $(cat $ARTIFACT_DIR/pfe_dismissed_transfer_stderr.log)"
fi
rm -f $ARTIFACT_DIR/pfe_dismissed_transfer_stderr.log

# User B cannot see or delete User A's transfer link.
B_SEES_TRANSFER="$(as_user "$USER_B" "select count(*) from public.transfer_links where id = '$TRANSFER_LINK_A';")"
as_user "$USER_B" "delete from public.transfer_links where id = '$TRANSFER_LINK_A';" >/dev/null 2>&1 || true
TRANSFER_LINK_INTACT="$(psql -d pfe_rls -t -A -c "select count(*) from public.transfer_links where id = '$TRANSFER_LINK_A';")"
if [ "$B_SEES_TRANSFER" = "0" ] && [ "$TRANSFER_LINK_INTACT" = "1" ]; then
  pass "Phase E: User B cannot see or delete User A's transfer link"
else
  fail "Phase E: User B saw ($B_SEES_TRANSFER) or deleted (now $TRANSFER_LINK_INTACT of 1 expected) User A's transfer link - isolation breach"
fi

# ===========================================================================
# Phase F: categorization policy engine, increment 1. Reuses pfe_rls
# (USER_A/WORKSPACE_A/transaction d3 and USER_B/WORKSPACE_B/transaction c3,
# both seeded above with category left null).
# ===========================================================================
echo "=== Phase F: categorization policies and category history ==="

# The rename left no trace of the old table name.
OLD_TABLE_GONE="$(psql -d pfe_rls -t -A -c "select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'merchant_rules';")"
NEW_TABLE_PRESENT="$(psql -d pfe_rls -t -A -c "select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'categorization_policies';")"
if [ "$OLD_TABLE_GONE" = "0" ] && [ "$NEW_TABLE_PRESENT" = "1" ]; then
  pass "Phase F: merchant_rules was renamed to categorization_policies"
else
  fail "Phase F: rename did not take effect (old present=$OLD_TABLE_GONE new present=$NEW_TABLE_PRESENT)"
fi

# A policy with no counterparty pattern - only direction/amount/time
# conditions - is now allowed (merchant_pattern is nullable).
if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  insert into public.categorization_policies (workspace_id, category, direction, amount_min_rwf, amount_max_rwf, time_start, time_end)
  values ('$WORKSPACE_A', 'Transport', 'out', 1000, 1500, '06:00', '11:00');
" >/dev/null 2>$ARTIFACT_DIR/pfe_policy_nocounterparty_stderr.log; then
  pass "Phase F: a policy with only direction/amount/time conditions (no counterparty pattern) is accepted"
else
  fail "Phase F: a condition-based policy without a counterparty pattern was rejected: $(cat $ARTIFACT_DIR/pfe_policy_nocounterparty_stderr.log)"
fi
rm -f $ARTIFACT_DIR/pfe_policy_nocounterparty_stderr.log

# A condition-less policy (every condition null) is rejected.
if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  insert into public.categorization_policies (workspace_id, category) values ('$WORKSPACE_A', 'Everything');
" >/dev/null 2>$ARTIFACT_DIR/pfe_policy_nocondition_stderr.log; then
  fail "Phase F: a policy with zero conditions (would match every transaction) was allowed"
else
  pass "Phase F: a policy with no conditions at all is rejected"
fi
rm -f $ARTIFACT_DIR/pfe_policy_nocondition_stderr.log

# amount_max_rwf below amount_min_rwf is rejected.
if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  insert into public.categorization_policies (workspace_id, category, amount_min_rwf, amount_max_rwf) values ('$WORKSPACE_A', 'Bad Range', 2000, 1000);
" >/dev/null 2>$ARTIFACT_DIR/pfe_policy_badrange_stderr.log; then
  fail "Phase F: a policy with amount_max_rwf < amount_min_rwf was allowed"
else
  pass "Phase F: amount_max_rwf < amount_min_rwf is rejected"
fi
rm -f $ARTIFACT_DIR/pfe_policy_badrange_stderr.log

# time_start without a matching time_end is rejected.
if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  insert into public.categorization_policies (workspace_id, category, time_start) values ('$WORKSPACE_A', 'Half Window', '06:00');
" >/dev/null 2>$ARTIFACT_DIR/pfe_policy_halfwindow_stderr.log; then
  fail "Phase F: a policy with time_start but no time_end was allowed"
else
  pass "Phase F: time_start without time_end is rejected"
fi
rm -f $ARTIFACT_DIR/pfe_policy_halfwindow_stderr.log

# authenticated has no direct insert grant on transaction_category_history -
# every history row must go through apply_manual_category_correction().
if as_user "$USER_A" "insert into public.transaction_category_history (transaction_id, workspace_id, new_category, new_category_source, actor_type, actor_user_id) values ('00000000-0000-0000-0000-0000000000d3', '$WORKSPACE_A', 'Forged', 'manual', 'user', '$USER_A');" >/dev/null 2>$ARTIFACT_DIR/pfe_history_direct_insert_stderr.log; then
  fail "Phase F: an authenticated user inserted directly into transaction_category_history - the RPC is not the sole write path"
else
  pass "Phase F: authenticated cannot insert directly into transaction_category_history"
fi
rm -f $ARTIFACT_DIR/pfe_history_direct_insert_stderr.log

# apply_manual_category_correction: User A correcting their own transaction
# (d3) succeeds, updates the transaction, and writes exactly one history row.
as_user "$USER_A" "select public.apply_manual_category_correction('00000000-0000-0000-0000-0000000000d3', 'Food', 'Restaurant');" >/dev/null
CORRECTED_CATEGORY="$(psql -d pfe_rls -t -A -c "select category from public.transactions where id = '00000000-0000-0000-0000-0000000000d3';")"
CORRECTED_SOURCE="$(psql -d pfe_rls -t -A -c "select category_source from public.transactions where id = '00000000-0000-0000-0000-0000000000d3';")"
HISTORY_ROW_COUNT="$(psql -d pfe_rls -t -A -c "select count(*) from public.transaction_category_history where transaction_id = '00000000-0000-0000-0000-0000000000d3';")"
if [ "$CORRECTED_CATEGORY" = "Food" ] && [ "$CORRECTED_SOURCE" = "manual" ] && [ "$HISTORY_ROW_COUNT" = "1" ]; then
  pass "Phase F: apply_manual_category_correction updates the transaction and writes one history row"
else
  fail "Phase F: correction result was category=$CORRECTED_CATEGORY source=$CORRECTED_SOURCE history_rows=$HISTORY_ROW_COUNT (expected Food/manual/1)"
fi

# apply_manual_category_correction: User A cannot correct User B's
# transaction (c3) - the function's own membership check must reject it
# even though it runs SECURITY DEFINER.
if as_user "$USER_A" "select public.apply_manual_category_correction('00000000-0000-0000-0000-0000000000c3', 'Hacked', null);" >/dev/null 2>$ARTIFACT_DIR/pfe_correction_forbidden_stderr.log; then
  fail "Phase F: User A was able to correct User B's transaction via apply_manual_category_correction - isolation breach"
else
  pass "Phase F: apply_manual_category_correction refuses to correct a transaction outside the caller's workspace"
fi
rm -f $ARTIFACT_DIR/pfe_correction_forbidden_stderr.log

# User B cannot see User A's category history.
B_SEES_HISTORY="$(as_user "$USER_B" "select count(*) from public.transaction_category_history where transaction_id = '00000000-0000-0000-0000-0000000000d3';")"
if [ "$B_SEES_HISTORY" = "0" ]; then
  pass "Phase F: User B cannot see User A's transaction_category_history rows"
else
  fail "Phase F: User B could read $B_SEES_HISTORY of User A's transaction_category_history rows - isolation breach"
fi

# ===========================================================================
# Phase G: confidence tiers, review queue, and historical backfill. Reuses
# pfe_rls (USER_A/WORKSPACE_A/account d1). Seeds its own transactions with
# a counterparty_name so policy_matches_transaction() has something to
# match against.
# ===========================================================================
echo "=== Phase G: confidence tiers, review queue, and historical backfill ==="

psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  insert into public.momo_messages (id, raw_message, processing_status)
  select ('00000000-0000-0000-0000-0000000003' || lpad(i::text,2,'0'))::uuid, 'seed-g'||i, 'processed'
  from generate_series(1,3) i;
  insert into public.transactions (id, momo_message_id, account_id, workspace_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version, counterparty_name)
  select
    ('00000000-0000-0000-0000-0000000004' || lpad(i::text,2,'0'))::uuid,
    ('00000000-0000-0000-0000-0000000003' || lpad(i::text,2,'0'))::uuid,
    '00000000-0000-0000-0000-0000000000d1', '$WORKSPACE_A',
    'send_money', 'out', 'success', 1200, 0, ('2026-08-2'||i||' 08:00:00+02')::timestamptz, 'test', 'James KAYIJE'
  from generate_series(1,3) i;
" >/dev/null

GTXN1="00000000-0000-0000-0000-000000000401"
GTXN2="00000000-0000-0000-0000-000000000402"
GTXN3="00000000-0000-0000-0000-000000000403"

SUGGESTED_POLICY="$(psql -d pfe_rls -t -A -c "
  insert into public.categorization_policies (workspace_id, category, subcategory, name, merchant_pattern, match_type, direction, amount_min_rwf, amount_max_rwf, time_start, time_end, confidence, priority)
  values ('$WORKSPACE_A', 'Transport', 'Moto', 'Morning commute', 'james kayije', 'exact', 'out', 1000, 1500, '06:00', '11:00', 0.60, 100)
  returning id;" | head -1)"

MATCH_COUNT="$(as_user "$USER_A" "select public.preview_policy_historical_match_count('$SUGGESTED_POLICY');")"
if [ "$MATCH_COUNT" = "3" ]; then
  pass "Phase G: preview_policy_historical_match_count finds the 3 seeded matching transactions"
else
  fail "Phase G: preview count was $MATCH_COUNT, expected 3"
fi

BULK_G1="33333333-3333-3333-3333-333333333331"
APPLIED_COUNT="$(as_user "$USER_A" "select public.apply_policy_to_historical('$SUGGESTED_POLICY', '$BULK_G1', 200);")"
SUGGESTED_STATE="$(psql -d pfe_rls -t -A -c "select count(*) from public.transactions where id in ('$GTXN1','$GTXN2','$GTXN3') and category is null and suggested_category = 'Transport' and category_decision_status = 'suggested';")"
if [ "$APPLIED_COUNT" = "3" ] && [ "$SUGGESTED_STATE" = "3" ]; then
  pass "Phase G: a 60%-confidence policy applied historically only sets suggested_category, never commits category"
else
  fail "Phase G: applied_count=$APPLIED_COUNT suggested_state=$SUGGESTED_STATE (expected 3/3) - suggested tier committed a category or didn't apply"
fi

REAPPLY_COUNT="$(as_user "$USER_A" "select public.apply_policy_to_historical('$SUGGESTED_POLICY', '$BULK_G1', 200);")"
if [ "$REAPPLY_COUNT" = "0" ]; then
  pass "Phase G: re-running apply_policy_to_historical on an already-applied batch is a no-op"
else
  fail "Phase G: re-applying matched $REAPPLY_COUNT transactions again - not idempotent"
fi

as_user "$USER_A" "select public.confirm_transaction_category('$GTXN1');" >/dev/null
CONFIRMED_STATE="$(psql -d pfe_rls -t -A -c "select category||'|'||category_source||'|'||category_decision_status from public.transactions where id='$GTXN1';")"
if [ "$CONFIRMED_STATE" = "Transport|manual|confirmed" ]; then
  pass "Phase G: confirm_transaction_category promotes the suggestion and marks it confirmed"
else
  fail "Phase G: confirm_transaction_category left state '$CONFIRMED_STATE', expected 'Transport|manual|confirmed'"
fi

as_user "$USER_A" "select public.dismiss_suggested_category('$GTXN2');" >/dev/null
DISMISSED_STATE="$(psql -d pfe_rls -t -A -c "select coalesce(category,'NULL')||'|'||category_decision_status from public.transactions where id='$GTXN2';")"
if [ "$DISMISSED_STATE" = "NULL|uncategorized" ]; then
  pass "Phase G: dismiss_suggested_category clears the suggestion back to uncategorized"
else
  fail "Phase G: dismiss_suggested_category left state '$DISMISSED_STATE', expected 'NULL|uncategorized'"
fi

if as_user "$USER_A" "select public.dismiss_suggested_category('$GTXN1');" >/dev/null 2>$ARTIFACT_DIR/pfe_redismiss_stderr.log; then
  fail "Phase G: dismiss_suggested_category succeeded on an already-confirmed transaction"
else
  pass "Phase G: dismiss_suggested_category refuses to act on an already-confirmed transaction"
fi
rm -f $ARTIFACT_DIR/pfe_redismiss_stderr.log

# The revert must protect GTXN1 (confirmed by the user above) while still
# reverting GTXN3 (still exactly as the bulk apply left it) - this is the
# tier-aware protection guard, not a blanket category_source check (a
# suggested-tier row never gets category_source set at all).
REVERT_COUNT="$(as_user "$USER_A" "select public.revert_bulk_categorization('$BULK_G1');")"
GTXN1_AFTER="$(psql -d pfe_rls -t -A -c "select category from public.transactions where id='$GTXN1';")"
GTXN3_AFTER="$(psql -d pfe_rls -t -A -c "select coalesce(category,'NULL')||'|'||category_decision_status from public.transactions where id='$GTXN3';")"
if [ "$REVERT_COUNT" = "1" ] && [ "$GTXN1_AFTER" = "Transport" ] && [ "$GTXN3_AFTER" = "NULL|uncategorized" ]; then
  pass "Phase G: revert_bulk_categorization reverts only the untouched suggested-tier row, protecting the confirmed one"
else
  fail "Phase G: revert_count=$REVERT_COUNT gtxn1=$GTXN1_AFTER gtxn3=$GTXN3_AFTER - protection or revert logic is wrong"
fi

# Cross-workspace: User B cannot preview, apply, or revert against
# WORKSPACE_A's policy or bulk operation.
if as_user "$USER_B" "select public.preview_policy_historical_match_count('$SUGGESTED_POLICY');" >/dev/null 2>$ARTIFACT_DIR/pfe_g_cross_stderr.log; then
  fail "Phase G: User B could preview User A's policy - isolation breach"
else
  pass "Phase G: User B cannot preview User A's policy"
fi
rm -f $ARTIFACT_DIR/pfe_g_cross_stderr.log

if as_user "$USER_B" "select public.revert_bulk_categorization('$BULK_G1');" >/dev/null 2>$ARTIFACT_DIR/pfe_g_cross_revert_stderr.log; then
  fail "Phase G: User B could revert User A's bulk operation - isolation breach"
else
  pass "Phase G: User B cannot revert User A's bulk operation"
fi
rm -f $ARTIFACT_DIR/pfe_g_cross_revert_stderr.log

# preview_policy_historical_matches (the sample-rows RPC, distinct from
# preview_policy_historical_match_count) has no direct coverage above -
# GTXN2/GTXN3 are back to uncategorized after the revert tested above and
# still match SUGGESTED_POLICY, so this is a genuine positive check before
# re-applying (below) to also prove it excludes rows once they're no
# longer uncategorized.
PREVIEW_SAMPLE_IDS="$(as_user "$USER_A" "select string_agg(id::text, ',' order by id) from public.preview_policy_historical_matches('$SUGGESTED_POLICY', 10) where id in ('$GTXN2', '$GTXN3');")"
EXPECTED_SAMPLE_IDS="$(echo -e "$GTXN2\n$GTXN3" | sort | paste -sd, -)"
if [ "$PREVIEW_SAMPLE_IDS" = "$EXPECTED_SAMPLE_IDS" ]; then
  pass "Phase G: preview_policy_historical_matches returns the actual matching uncategorized transactions"
else
  fail "Phase G: preview_policy_historical_matches returned '$PREVIEW_SAMPLE_IDS', expected '$EXPECTED_SAMPLE_IDS'"
fi

BULK_G2="33333333-3333-3333-3333-333333333332"
as_user "$USER_A" "select public.apply_policy_to_historical('$SUGGESTED_POLICY', '$BULK_G2', 200);" >/dev/null
SAMPLE_ROW_COUNT="$(as_user "$USER_A" "select count(*) from public.preview_policy_historical_matches('$SUGGESTED_POLICY', 10);")"
if [ "$SAMPLE_ROW_COUNT" = "0" ]; then
  pass "Phase G: preview_policy_historical_matches excludes rows once they're no longer uncategorized"
else
  fail "Phase G: preview_policy_historical_matches showed $SAMPLE_ROW_COUNT already-applied rows as still eligible"
fi

if as_user "$USER_B" "select public.confirm_transaction_category('$GTXN2');" >/dev/null 2>$ARTIFACT_DIR/pfe_g_cross_confirm_stderr.log; then
  fail "Phase G: User B could confirm a category on User A's transaction - isolation breach"
else
  pass "Phase G: User B cannot confirm a category on User A's transaction"
fi
rm -f $ARTIFACT_DIR/pfe_g_cross_confirm_stderr.log

if as_user "$USER_B" "select public.dismiss_suggested_category('$GTXN2');" >/dev/null 2>$ARTIFACT_DIR/pfe_g_cross_dismiss_stderr.log; then
  fail "Phase G: User B could dismiss a suggestion on User A's transaction - isolation breach"
else
  pass "Phase G: User B cannot dismiss a suggestion on User A's transaction"
fi
rm -f $ARTIFACT_DIR/pfe_g_cross_dismiss_stderr.log

# ===========================================================================
# Phase H: learned-policy suggestions. Reuses pfe_rls (USER_A/WORKSPACE_A/
# account d1). Seeds its own transactions/corrections for a counterparty
# with 3+ manual corrections to the same category.
# ===========================================================================
echo "=== Phase H: learned-policy suggestions ==="

psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  insert into public.momo_messages (id, raw_message, processing_status)
  select ('00000000-0000-0000-0000-0000000009' || lpad(i::text,2,'0'))::uuid, 'seed-h'||i, 'processed'
  from generate_series(1,3) i;
  insert into public.transactions (id, momo_message_id, account_id, workspace_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version, counterparty_name)
  select
    ('00000000-0000-0000-0000-0000000010' || lpad(i::text,2,'0'))::uuid,
    ('00000000-0000-0000-0000-0000000009' || lpad(i::text,2,'0'))::uuid,
    '00000000-0000-0000-0000-0000000000d1', '$WORKSPACE_A',
    'send_money', 'out', 'success', 2000, 0, ('2026-08-2'||i||' 09:00:00+02')::timestamptz, 'test', 'Kigali Supermarket H'
  from generate_series(1,3) i;
" >/dev/null

for i in 01 02 03; do
  as_user "$USER_A" "select public.apply_manual_category_correction('00000000-0000-0000-0000-0000000010$i'::uuid, 'Food', 'Groceries');" >/dev/null
done

SUGGESTION_COUNT="$(as_user "$USER_A" "select count(*) from public.detect_learned_policy_suggestions('$WORKSPACE_A', 3) where counterparty_name = 'Kigali Supermarket H';")"
if [ "$SUGGESTION_COUNT" = "1" ]; then
  pass "Phase H: 3 manual corrections to the same counterparty/category produce a suggestion"
else
  fail "Phase H: expected 1 suggestion for the 3x-corrected counterparty, got $SUGGESTION_COUNT"
fi

SUGGESTION_KEY="$(as_user "$USER_A" "select suggestion_key from public.detect_learned_policy_suggestions('$WORKSPACE_A', 3) where counterparty_name = 'Kigali Supermarket H';")"

BELOW_THRESHOLD_COUNT="$(as_user "$USER_A" "select count(*) from public.detect_learned_policy_suggestions('$WORKSPACE_A', 4) where counterparty_name = 'Kigali Supermarket H';")"
if [ "$BELOW_THRESHOLD_COUNT" = "0" ]; then
  pass "Phase H: raising the occurrence threshold above the actual count excludes the suggestion"
else
  fail "Phase H: a suggestion with only 3 occurrences matched a minimum-occurrence threshold of 4"
fi

as_user "$USER_A" "insert into public.learned_policy_suggestion_decisions (workspace_id, suggestion_key, status, decided_by) values ('$WORKSPACE_A', '$SUGGESTION_KEY', 'dismissed', '$USER_A');" >/dev/null
AFTER_DISMISS_COUNT="$(as_user "$USER_A" "select count(*) from public.detect_learned_policy_suggestions('$WORKSPACE_A', 3) where counterparty_name = 'Kigali Supermarket H';")"
if [ "$AFTER_DISMISS_COUNT" = "0" ]; then
  pass "Phase H: a dismissed suggestion never resurfaces"
else
  fail "Phase H: a dismissed suggestion still appeared - dismissal exclusion is broken"
fi

if as_user "$USER_A" "insert into public.learned_policy_suggestion_decisions (workspace_id, suggestion_key, status, decided_by) values ('$WORKSPACE_A', '$SUGGESTION_KEY', 'accepted', '$USER_A');" >/dev/null 2>$ARTIFACT_DIR/pfe_h_dup_decision_stderr.log; then
  fail "Phase H: the same suggestion could be decided twice (unique constraint not enforced)"
else
  pass "Phase H: a suggestion can only be decided once per workspace (unique constraint enforced)"
fi
rm -f $ARTIFACT_DIR/pfe_h_dup_decision_stderr.log

# An active policy already covering the counterparty+category excludes it
# even without an explicit dismissal - proven on a second, undismissed
# counterparty so this test is independent of the dismissal above.
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  insert into public.momo_messages (id, raw_message, processing_status)
  select ('00000000-0000-0000-0000-0000000011' || lpad(i::text,2,'0'))::uuid, 'seed-h2-'||i, 'processed'
  from generate_series(1,3) i;
  insert into public.transactions (id, momo_message_id, account_id, workspace_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version, counterparty_name)
  select
    ('00000000-0000-0000-0000-0000000012' || lpad(i::text,2,'0'))::uuid,
    ('00000000-0000-0000-0000-0000000011' || lpad(i::text,2,'0'))::uuid,
    '00000000-0000-0000-0000-0000000000d1', '$WORKSPACE_A',
    'send_money', 'out', 'success', 500, 0, ('2026-08-2'||i||' 10:00:00+02')::timestamptz, 'test', 'Chez Robert H'
  from generate_series(1,3) i;
" >/dev/null
for i in 01 02 03; do
  as_user "$USER_A" "select public.apply_manual_category_correction('00000000-0000-0000-0000-0000000012$i'::uuid, 'Food', 'Restaurant');" >/dev/null
done
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  insert into public.categorization_policies (workspace_id, category, subcategory, merchant_pattern, match_type, is_active, confidence)
  values ('$WORKSPACE_A', 'Food', 'Restaurant', 'Chez Robert H', 'exact', true, 1.0);
" >/dev/null
ALREADY_COVERED_COUNT="$(as_user "$USER_A" "select count(*) from public.detect_learned_policy_suggestions('$WORKSPACE_A', 3) where counterparty_name = 'Chez Robert H';")"
if [ "$ALREADY_COVERED_COUNT" = "0" ]; then
  pass "Phase H: a counterparty/category already covered by an active policy is excluded from suggestions"
else
  fail "Phase H: a suggestion appeared even though an active policy already covers that counterparty/category"
fi

# Cross-workspace: User B cannot call detect_learned_policy_suggestions
# against WORKSPACE_A, and cannot see or insert decisions there either.
if as_user "$USER_B" "select public.detect_learned_policy_suggestions('$WORKSPACE_A', 3);" >/dev/null 2>$ARTIFACT_DIR/pfe_h_cross_stderr.log; then
  fail "Phase H: User B could call detect_learned_policy_suggestions against User A's workspace - isolation breach"
else
  pass "Phase H: User B cannot call detect_learned_policy_suggestions against User A's workspace"
fi
rm -f $ARTIFACT_DIR/pfe_h_cross_stderr.log

B_SEES_DECISIONS="$(as_user "$USER_B" "select count(*) from public.learned_policy_suggestion_decisions where workspace_id = '$WORKSPACE_A';")"
if [ "$B_SEES_DECISIONS" = "0" ]; then
  pass "Phase H: User B cannot see User A's learned_policy_suggestion_decisions rows"
else
  fail "Phase H: User B could read $B_SEES_DECISIONS of User A's learned_policy_suggestion_decisions rows - isolation breach"
fi

# ===========================================================================
# Phase J: report_preferences / report_runs / report_deliveries RLS.
# Reuses pfe_rls's existing USER_A/WORKSPACE_A/USER_B/WORKSPACE_B/as_user
# from the block above.
# ===========================================================================
echo "=== Phase J: reporting RLS ==="

psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  insert into public.report_preferences (id, workspace_id, user_id, delivery_email, email_enabled, daily_report_enabled)
  values ('00000000-0000-0000-0000-0000000000e1', '$WORKSPACE_B', '$USER_B', 'b@example.com', true, true);
  insert into public.report_runs (id, workspace_id, user_id, period_start, period_end, timezone, scheduled_for, status, report_payload)
  values ('00000000-0000-0000-0000-0000000000e2', '$WORKSPACE_B', '$USER_B', '2026-08-24T00:00:00+02', '2026-08-25T00:00:00+02', 'Africa/Kigali', '2026-08-25T00:05:00+02', 'generated', '{\"closing_balance_minor\": 100000}'::jsonb);
  insert into public.report_deliveries (id, report_run_id, user_id, destination, status)
  values ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000e2', '$USER_B', 'b@example.com', 'pending');
" >/dev/null

# A cannot read B's report preferences, report run, or delivery row.
READ_OTHER_PREFS="$(as_user "$USER_A" "select count(*) from public.report_preferences where id = '00000000-0000-0000-0000-0000000000e1';")"
READ_OTHER_RUN="$(as_user "$USER_A" "select count(*) from public.report_runs where id = '00000000-0000-0000-0000-0000000000e2';")"
READ_OTHER_DELIVERY="$(as_user "$USER_A" "select count(*) from public.report_deliveries where id = '00000000-0000-0000-0000-0000000000e3';")"
if [ "$READ_OTHER_PREFS" = "0" ] && [ "$READ_OTHER_RUN" = "0" ] && [ "$READ_OTHER_DELIVERY" = "0" ]; then
  pass "Phase J RLS: User A cannot read User B's report preferences, report run, or delivery"
else
  fail "Phase J RLS: User A read User B's reporting data (prefs=$READ_OTHER_PREFS run=$READ_OTHER_RUN delivery=$READ_OTHER_DELIVERY) - isolation breach"
fi

# A cannot update B's report preferences (destination hijack attempt).
as_user "$USER_A" "update public.report_preferences set delivery_email = 'attacker@example.com' where id = '00000000-0000-0000-0000-0000000000e1';" >/dev/null
PREFS_EMAIL_UNCHANGED="$(psql -d pfe_rls -t -A -c "select count(*) from public.report_preferences where id = '00000000-0000-0000-0000-0000000000e1' and delivery_email = 'b@example.com';")"
if [ "$PREFS_EMAIL_UNCHANGED" = "1" ]; then
  pass "Phase J RLS: User A cannot update User B's report delivery email"
else
  fail "Phase J RLS: User A's update against User B's report_preferences was not blocked - isolation breach"
fi

# A cannot trigger/insert a delivery against B's report run.
if as_user "$USER_A" "insert into public.report_deliveries (report_run_id, user_id, destination) values ('00000000-0000-0000-0000-0000000000e2', '$USER_A', 'a@example.com');" >/dev/null 2>$ARTIFACT_DIR/pfe_rls_j_stderr.log; then
  fail "Phase J RLS: User A was able to insert a delivery attempt against User B's report run - isolation breach"
else
  pass "Phase J RLS: User A cannot insert a delivery attempt against User B's report run (no authenticated write policy)"
fi
rm -f $ARTIFACT_DIR/pfe_rls_j_stderr.log

# A CAN manage their own report_preferences and read their own report_runs
# (positive control).
as_user "$USER_A" "insert into public.report_preferences (workspace_id, user_id, delivery_email, email_enabled, daily_report_enabled) values ('$WORKSPACE_A', '$USER_A', 'a@example.com', true, true);" >/dev/null
OWN_PREFS_COUNT="$(psql -d pfe_rls -t -A -c "select count(*) from public.report_preferences where workspace_id = '$WORKSPACE_A' and user_id = '$USER_A' and delivery_email = 'a@example.com';")"
if [ "$OWN_PREFS_COUNT" = "1" ]; then
  pass "Phase J RLS: User A can create and read their own report preferences (positive control)"
else
  fail "Phase J RLS: User A could not create their own report preferences - policies are over-blocking"
fi

psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  insert into public.report_runs (id, workspace_id, user_id, period_start, period_end, timezone, scheduled_for, status, report_payload)
  values ('00000000-0000-0000-0000-0000000000e4', '$WORKSPACE_A', '$USER_A', '2026-08-24T00:00:00+02', '2026-08-25T00:00:00+02', 'Africa/Kigali', '2026-08-25T00:05:00+02', 'generated', '{\"closing_balance_minor\": 50000}'::jsonb);
" >/dev/null
OWN_RUN_READABLE="$(as_user "$USER_A" "select count(*) from public.report_runs where id = '00000000-0000-0000-0000-0000000000e4';")"
if [ "$OWN_RUN_READABLE" = "1" ]; then
  pass "Phase J RLS: User A can read their own report run (positive control)"
else
  fail "Phase J RLS: User A could not read their own report run - policies are over-blocking"
fi

# Idempotency: a second insert for the identical (workspace, user, type,
# period_start) is rejected by the unique constraint, not silently
# duplicated - this is what the generation job's ON CONFLICT DO NOTHING
# relies on.
if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  insert into public.report_runs (workspace_id, user_id, period_start, period_end, timezone, scheduled_for, status)
  values ('$WORKSPACE_A', '$USER_A', '2026-08-24T00:00:00+02', '2026-08-25T00:00:00+02', 'Africa/Kigali', '2026-08-25T00:05:00+02', 'scheduled');
" >/dev/null 2>$ARTIFACT_DIR/pfe_rls_j_dup_stderr.log; then
  fail "Phase J RLS: a second report_runs row for the same (workspace, user, type, period_start) was accepted - idempotency constraint missing/broken"
else
  pass "Phase J RLS: a duplicate report_runs insert for the same recipient/period is rejected (idempotency constraint enforced)"
fi
rm -f $ARTIFACT_DIR/pfe_rls_j_dup_stderr.log

# service_role remains completely unaffected by every policy above.
SERVICE_ROLE_SEES_BOTH_RUNS="$(psql -d pfe_rls -t -A -c "set role service_role; select count(*) from public.report_runs where id in ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e4');" | tail -1)"
if [ "$SERVICE_ROLE_SEES_BOTH_RUNS" = "2" ]; then
  pass "Phase J RLS: service_role can read both users' report_runs, unaffected by RLS"
else
  fail "Phase J RLS: service_role could not see both report_runs rows ($SERVICE_ROLE_SEES_BOTH_RUNS of 2) - service_role should bypass RLS entirely"
fi

# ===========================================================================
# Phase K: report_artifacts grants NOTHING to authenticated/anon at all
# (unlike report_preferences/report_runs/report_deliveries, which at
# least grant select) - the PDF route is the only path to this table's
# data, and it always uses service_role. Prove authenticated genuinely
# cannot read or write it, even its own report's row.
# ===========================================================================
echo "=== Phase K: report_artifacts has zero authenticated/anon access ==="

psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  insert into public.report_artifacts (id, report_run_id, storage_path, byte_size)
  values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e4', 'reports/e4.pdf', 12345);
" >/dev/null

# Direct `if as_user ...; then` (not a command-substitution assignment) is
# deliberate here: authenticated has no SELECT grant on report_artifacts
# at all, so this query fails outright (permission denied), not merely
# an RLS-filtered empty result - a command-substitution assignment would
# trip `set -e` on that failure before this script could even check it.
if as_user "$USER_A" "select count(*) from public.report_artifacts where id = '00000000-0000-0000-0000-0000000000f1';" >/dev/null 2>$ARTIFACT_DIR/pfe_rls_k_read_stderr.log; then
  fail "Phase K RLS: authenticated was able to query report_artifacts - should have no grant at all"
else
  pass "Phase K RLS: authenticated cannot query report_artifacts, even for their own report (no grant at all)"
fi
rm -f $ARTIFACT_DIR/pfe_rls_k_read_stderr.log

if as_user "$USER_A" "insert into public.report_artifacts (report_run_id, storage_path, byte_size) values ('00000000-0000-0000-0000-0000000000e4', 'reports/forged.pdf', 1);" >/dev/null 2>$ARTIFACT_DIR/pfe_rls_k_stderr.log; then
  fail "Phase K RLS: authenticated was able to insert into report_artifacts - isolation breach"
else
  pass "Phase K RLS: authenticated cannot insert into report_artifacts (no grant at all)"
fi
rm -f $ARTIFACT_DIR/pfe_rls_k_stderr.log

SERVICE_ROLE_SEES_ARTIFACT="$(psql -d pfe_rls -t -A -c "set role service_role; select count(*) from public.report_artifacts where id = '00000000-0000-0000-0000-0000000000f1';" | tail -1)"
if [ "$SERVICE_ROLE_SEES_ARTIFACT" = "1" ]; then
  pass "Phase K RLS: service_role can read report_artifacts, unaffected by RLS"
else
  fail "Phase K RLS: service_role could not see the report_artifacts row - service_role should bypass RLS entirely"
fi

# ===========================================================================
# Phase M: USSD directory. Non-admin visibility is limited to published
# rows; the admin RPCs are is_platform_admin()-gated; the publication
# state machine rejects illegal jumps; the report insert is rate-limited;
# favourites are per-user; and the seed migration is idempotent.
# Reuses pfe_rls (USER_A/USER_B/WORKSPACE_A already set up above).
# ===========================================================================
echo "=== Phase M: USSD directory ==="

USER_ADMIN="$(psql -d pfe_rls -t -A -c "insert into auth.users (email) values ('ussd-admin@example.com') returning id;" | head -1)"
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  update public.profiles set is_platform_admin = true where id = '$USER_ADMIN';
  insert into public.service_providers (id, slug, display_name, kind)
  values ('11111111-1111-4111-8111-111111111111', 'test-mno', 'Test MNO', 'mno');
  insert into public.service_codes (id, provider_id, slug, category, display_name_en, ussd_template, state)
  values
    ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'pub-code', 'mobile_money', 'Published code', '*111#', 'published'),
    ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'draft-code', 'mobile_money', 'Draft code', '*112#', 'draft');
" >/dev/null

# Non-admin sees the published row but not the draft.
M_PUB="$(as_user "$USER_A" "select count(*) from public.service_codes where slug = 'pub-code';")"
M_DRAFT="$(as_user "$USER_A" "select count(*) from public.service_codes where slug = 'draft-code';")"
if [ "$M_PUB" = "1" ] && [ "$M_DRAFT" = "0" ]; then
  pass "Phase M: a non-admin sees published service codes but not drafts (RLS)"
else
  fail "Phase M: non-admin directory visibility wrong (published=$M_PUB draft=$M_DRAFT, expected 1/0)"
fi

# Admin sees both.
M_ADMIN_DRAFT="$(as_user "$USER_ADMIN" "select count(*) from public.service_codes where slug = 'draft-code';")"
if [ "$M_ADMIN_DRAFT" = "1" ]; then
  pass "Phase M: a platform admin sees unpublished service codes"
else
  fail "Phase M: platform admin could not see the draft code (got $M_ADMIN_DRAFT)"
fi

# Non-admin cannot call the admin RPCs.
if as_user "$USER_A" "select public.admin_set_service_code_state('33333333-3333-4333-8333-333333333333', 'pending_review', null);" >/dev/null 2>$ARTIFACT_DIR/pfe_m_rpc.log; then
  fail "Phase M: a non-admin was allowed to call admin_set_service_code_state - authorization gap"
else
  pass "Phase M: admin_set_service_code_state refuses a non-admin caller"
fi
rm -f $ARTIFACT_DIR/pfe_m_rpc.log

# The publication state machine rejects draft -> published directly.
if as_user "$USER_ADMIN" "select public.admin_set_service_code_state('33333333-3333-4333-8333-333333333333', 'published', 'skip review');" >/dev/null 2>$ARTIFACT_DIR/pfe_m_sm.log; then
  fail "Phase M: draft -> published was allowed, skipping pending_review"
else
  pass "Phase M: the publication state machine rejects draft -> published"
fi
rm -f $ARTIFACT_DIR/pfe_m_sm.log

# ... but draft -> pending_review -> published works, and writes version snapshots.
as_user "$USER_ADMIN" "select public.admin_set_service_code_state('33333333-3333-4333-8333-333333333333', 'pending_review', null);" >/dev/null
as_user "$USER_ADMIN" "select public.admin_set_service_code_state('33333333-3333-4333-8333-333333333333', 'published', null);" >/dev/null
M_NOW_PUB="$(psql -d pfe_rls -t -A -c "select state from public.service_codes where slug = 'draft-code';")"
M_VERSIONS="$(psql -d pfe_rls -t -A -c "select count(*) from public.service_code_versions where service_code_id = '33333333-3333-4333-8333-333333333333';")"
if [ "$M_NOW_PUB" = "published" ] && [ "$M_VERSIONS" -ge "2" ]; then
  pass "Phase M: draft -> pending_review -> published succeeds and records version snapshots"
else
  fail "Phase M: staged publish failed (state=$M_NOW_PUB versions=$M_VERSIONS)"
fi

# admin_upsert_service_code from a non-admin is rejected; from an admin it
# creates a code + a v1 snapshot + an audit row.
if as_user "$USER_A" "select public.admin_upsert_service_code('{\"provider_id\":\"11111111-1111-4111-8111-111111111111\",\"slug\":\"forged\",\"category\":\"other\",\"display_name_en\":\"x\",\"ussd_template\":\"*9#\"}'::jsonb);" >/dev/null 2>$ARTIFACT_DIR/pfe_m_up.log; then
  fail "Phase M: a non-admin created a service code via admin_upsert_service_code"
else
  pass "Phase M: admin_upsert_service_code refuses a non-admin caller"
fi
rm -f $ARTIFACT_DIR/pfe_m_up.log
NEW_CODE_ID="$(as_user "$USER_ADMIN" "select public.admin_upsert_service_code('{\"provider_id\":\"11111111-1111-4111-8111-111111111111\",\"slug\":\"admin-made\",\"category\":\"other\",\"display_name_en\":\"Admin made\",\"ussd_template\":\"*9#\",\"change_reason\":\"initial\"}'::jsonb);")"
M_AUDIT="$(psql -d pfe_rls -t -A -c "select count(*) from public.service_directory_audit_events where service_code_id = '$NEW_CODE_ID' and action = 'service_code.create';")"
if [ -n "$NEW_CODE_ID" ] && [ "$M_AUDIT" = "1" ]; then
  pass "Phase M: an admin upsert creates the code and writes an audit event"
else
  fail "Phase M: admin upsert did not record an audit event (id=$NEW_CODE_ID audit=$M_AUDIT)"
fi

# Report insert rate limit: the 6th open report from one user in an hour fails.
M_RL_OK=1
for i in 1 2 3 4 5; do
  as_user "$USER_B" "insert into public.service_code_reports (service_code_id, reporter_user_id, report_type) values ('22222222-2222-4222-8222-222222222222', '$USER_B', 'other');" >/dev/null 2>&1 || M_RL_OK=0
done
if as_user "$USER_B" "insert into public.service_code_reports (service_code_id, reporter_user_id, report_type) values ('22222222-2222-4222-8222-222222222222', '$USER_B', 'other');" >/dev/null 2>$ARTIFACT_DIR/pfe_m_rl.log; then
  fail "Phase M: a 6th open report in an hour was accepted - rate limit not enforced"
elif [ "$M_RL_OK" = "1" ]; then
  pass "Phase M: service_code_reports insert is rate-limited to 5 open per user per hour"
else
  fail "Phase M: one of the first 5 reports was unexpectedly rejected"
fi
rm -f $ARTIFACT_DIR/pfe_m_rl.log

# Favourites are per-user.
as_user "$USER_A" "insert into public.service_favourites (user_id, service_code_id) values ('$USER_A', '22222222-2222-4222-8222-222222222222');" >/dev/null
M_FAV_A="$(as_user "$USER_A" "select count(*) from public.service_favourites;")"
M_FAV_B="$(as_user "$USER_B" "select count(*) from public.service_favourites;")"
if [ "$M_FAV_A" = "1" ] && [ "$M_FAV_B" = "0" ]; then
  pass "Phase M: User B cannot see User A's service favourites"
else
  fail "Phase M: favourites are not per-user (A sees $M_FAV_A, B sees $M_FAV_B)"
fi

# The seed migration is idempotent.
SEED_FILE="$MIGRATIONS_DIR/20260906000100_phase_m_ussd_seed.sql"
M_SEED_BEFORE="$(psql -d pfe_rls -t -A -c "select count(*) from public.service_codes;")"
psql -d pfe_rls -v ON_ERROR_STOP=1 -f "$SEED_FILE" >/dev/null 2>&1
M_SEED_AFTER="$(psql -d pfe_rls -t -A -c "select count(*) from public.service_codes;")"
if [ "$M_SEED_BEFORE" = "$M_SEED_AFTER" ]; then
  pass "Phase M: re-running the USSD seed migration inserts nothing new (idempotent)"
else
  fail "Phase M: seed migration is not idempotent ($M_SEED_BEFORE -> $M_SEED_AFTER service codes)"
fi

# ===========================================================================
# Phase N: payment-intent orchestration. Idempotency-key dedupe, the
# server-enforced state machine, manual-confirm != verified, lazy expiry,
# the no-secret template trigger, and per-workspace RLS on intents /
# recipients / templates. Reuses pfe_rls (USER_A/USER_B/WORKSPACE_A/_B).
# ===========================================================================
echo "=== Phase N: payment-intent orchestration ==="

N_MK_PAYLOAD() {
  # $1 = workspace, $2 = idempotency key (may be empty)
  echo "{\"workspace_id\":\"$1\",\"idempotency_key\":\"$2\",\"payment_type\":\"pay_person\",\"amount_minor\":5000,\"recipient_kind\":\"phone\",\"recipient_name\":\"Test\",\"recipient_msisdn_normalized\":\"250781234567\"}"
}

# create_payment_intent is idempotent on (workspace_id, idempotency_key).
N_R1="$(as_user "$USER_A" "select public.create_payment_intent('$(N_MK_PAYLOAD "$WORKSPACE_A" "key-abc")'::jsonb);")"
N_R2="$(as_user "$USER_A" "select public.create_payment_intent('$(N_MK_PAYLOAD "$WORKSPACE_A" "key-abc")'::jsonb);")"
N_INTENT_ID="$(psql -d pfe_rls -t -A -c "select id from public.payment_intents where workspace_id = '$WORKSPACE_A' and idempotency_key = 'key-abc';")"
N_INTENT_COUNT="$(psql -d pfe_rls -t -A -c "select count(*) from public.payment_intents where workspace_id = '$WORKSPACE_A' and idempotency_key = 'key-abc';")"
if [ "$N_INTENT_COUNT" = "1" ] && echo "$N_R2" | grep -q '"existed": true'; then
  pass "Phase N: create_payment_intent is idempotent on the idempotency key (2 calls -> 1 row, second returns existed:true)"
else
  fail "Phase N: idempotency-key dedupe failed (rows=$N_INTENT_COUNT r2=$N_R2)"
fi

# A member of another workspace cannot create an intent there, nor read A's.
if as_user "$USER_B" "select public.create_payment_intent('$(N_MK_PAYLOAD "$WORKSPACE_A" "forged")'::jsonb);" >/dev/null 2>$ARTIFACT_DIR/pfe_n_forge.log; then
  fail "Phase N: User B created a payment intent in User A's workspace - authorization gap"
else
  pass "Phase N: create_payment_intent refuses a non-member workspace_id"
fi
rm -f $ARTIFACT_DIR/pfe_n_forge.log
N_B_SEES="$(as_user "$USER_B" "select count(*) from public.payment_intents where id = '$N_INTENT_ID';")"
if [ "$N_B_SEES" = "0" ]; then
  pass "Phase N: User B cannot read User A's payment intent (RLS)"
else
  fail "Phase N: User B read User A's payment intent (got $N_B_SEES)"
fi

# The state machine rejects an illegal jump.
if as_user "$USER_A" "select public.transition_payment_intent('$N_INTENT_ID', 'successful', null, '{}'::jsonb);" >/dev/null 2>$ARTIFACT_DIR/pfe_n_sm.log; then
  fail "Phase N: draft -> successful was allowed via transition_payment_intent"
else
  pass "Phase N: the payment-intent state machine rejects draft -> successful"
fi
rm -f $ARTIFACT_DIR/pfe_n_sm.log

# draft -> initiated -> awaiting_verification works and logs events.
as_user "$USER_A" "select public.transition_payment_intent('$N_INTENT_ID', 'initiated', null, '{}'::jsonb);" >/dev/null
as_user "$USER_A" "select public.transition_payment_intent('$N_INTENT_ID', 'awaiting_verification', null, '{}'::jsonb);" >/dev/null
N_STATE="$(psql -d pfe_rls -t -A -c "select state from public.payment_intents where id = '$N_INTENT_ID';")"
N_EVENTS="$(psql -d pfe_rls -t -A -c "select count(*) from public.payment_events where payment_intent_id = '$N_INTENT_ID';")"
if [ "$N_STATE" = "awaiting_verification" ] && [ "$N_EVENTS" -ge "3" ]; then
  pass "Phase N: draft -> initiated -> awaiting_verification succeeds and writes lifecycle events"
else
  fail "Phase N: staged transition failed (state=$N_STATE events=$N_EVENTS)"
fi

# manually_confirm_payment reaches 'successful' but leaves verified_at NULL.
as_user "$USER_A" "select public.manually_confirm_payment('$N_INTENT_ID', 'confirmed on my phone');" >/dev/null
N_CONF="$(psql -d pfe_rls -t -A -c "select state || '|' || coalesce(verified_at::text,'null') || '|' || (manually_confirmed_at is not null)::text from public.payment_intents where id = '$N_INTENT_ID';")"
if [ "$N_CONF" = "successful|null|true" ]; then
  pass "Phase N: manual confirmation reaches 'successful' with verified_at still NULL (not a verified check)"
else
  fail "Phase N: manual confirmation stamped the wrong fields ($N_CONF)"
fi

# expire_stale_payment_intents only touches past-due non-terminal intents.
N_EXP_ID="$(as_user "$USER_A" "select (public.create_payment_intent('$(N_MK_PAYLOAD "$WORKSPACE_A" "to-expire")'::jsonb)->>'id');")"
as_user "$USER_A" "select public.transition_payment_intent('$N_EXP_ID', 'initiated', null, '{}'::jsonb);" >/dev/null
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "update public.payment_intents set expires_at = now() - interval '1 hour' where id = '$N_EXP_ID';" >/dev/null
N_EXPIRED_N="$(psql -d pfe_rls -t -A -c "set role service_role; select public.expire_stale_payment_intents(now());" | tail -1)"
N_EXP_STATE="$(psql -d pfe_rls -t -A -c "select state from public.payment_intents where id = '$N_EXP_ID';")"
N_CONF_STATE="$(psql -d pfe_rls -t -A -c "select state from public.payment_intents where id = '$N_INTENT_ID';")"
if [ "$N_EXP_STATE" = "expired" ] && [ "$N_CONF_STATE" = "successful" ] && [ "$N_EXPIRED_N" -ge "1" ]; then
  pass "Phase N: expire_stale_payment_intents expires the past-due intent and leaves terminal ones alone"
else
  fail "Phase N: expiry sweep wrong (expired=$N_EXP_STATE terminal=$N_CONF_STATE n=$N_EXPIRED_N)"
fi

# The no-secret trigger blocks a template carrying a PIN.
if as_user "$USER_A" "insert into public.payment_templates (workspace_id, name, payment_type, recipient_snapshot) values ('$WORKSPACE_A', 'Bad', 'pay_person', '{\"pin\":\"1234\"}'::jsonb);" >/dev/null 2>$ARTIFACT_DIR/pfe_n_pin.log; then
  fail "Phase N: a payment_templates row carrying a pin key was accepted"
else
  pass "Phase N: enforce_no_payment_secret rejects a template recipient_snapshot containing a pin"
fi
rm -f $ARTIFACT_DIR/pfe_n_pin.log

# Trusted recipients + templates are per-workspace.
as_user "$USER_A" "insert into public.trusted_recipients (workspace_id, display_name, kind, normalized_msisdn) values ('$WORKSPACE_A', 'Mum', 'phone', '250788111222');" >/dev/null
N_TR_A="$(as_user "$USER_A" "select count(*) from public.trusted_recipients;")"
N_TR_B="$(as_user "$USER_B" "select count(*) from public.trusted_recipients;")"
if [ "$N_TR_A" = "1" ] && [ "$N_TR_B" = "0" ]; then
  pass "Phase N: User B cannot see User A's trusted recipients"
else
  fail "Phase N: trusted recipients not workspace-isolated (A=$N_TR_A B=$N_TR_B)"
fi

# service_role is unaffected by every policy above.
N_SR="$(psql -d pfe_rls -t -A -c "set role service_role; select count(*) from public.payment_intents where id = '$N_INTENT_ID';" | tail -1)"
if [ "$N_SR" = "1" ]; then
  pass "Phase N: service_role reads payment intents unaffected by RLS"
else
  fail "Phase N: service_role could not read the intent (got $N_SR)"
fi

# ===========================================================================
# Phase O: SMS-to-intent reconciliation. Deterministic linking (never a
# second ledger row), observe vs apply mode, ambiguity -> conflict, the
# category lands as a review-queue suggestion and never overwrites a
# stronger decision, and the user-facing resolution RPCs are member-gated.
# Reuses pfe_rls (USER_A/USER_B/WORKSPACE_A, account d1).
# ===========================================================================
echo "=== Phase O: SMS reconciliation ==="

# Helper: insert an outgoing RWF success transaction that matches a given
# msisdn/amount, at `now()`, in WORKSPACE_A on account d1.
O_MK_TXN() {
  # $1 = txn uuid, $2 = counterparty ref (phone), $3 = amount, [$4 = category_source, $5 = decision_status, $6 = category]
  local cat_sql="null"
  local src_sql="null"
  local ds="${5:-uncategorized}"
  [ -n "${6:-}" ] && cat_sql="'$6'"
  [ -n "${4:-}" ] && src_sql="'$4'"
  psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
    set role service_role;
    with m as (
      insert into public.momo_messages (id, raw_message, processing_status)
      values (gen_random_uuid(), 'seed-O', 'processed')
      returning id
    )
    insert into public.transactions
      (id, momo_message_id, account_id, workspace_id, source, transaction_type, direction, status,
       currency, amount_rwf, fee_rwf, counterparty_reference, occurred_at, parser_version,
       category, category_source, category_decision_status)
    select '$1', m.id, '00000000-0000-0000-0000-0000000000d1', '$WORKSPACE_A', 'mtn_momo', 'send_money', 'out', 'success',
           'RWF', $3, 0, '$2', now(), 'test', $cat_sql, $src_sql, '$ds'
    from m;
  " >/dev/null
}

# --- apply mode: a single deterministic match links + verifies + suggests a category
O_INTENT1="$(as_user "$USER_A" "select (public.create_payment_intent('{\"workspace_id\":\"$WORKSPACE_A\",\"idempotency_key\":\"O-1\",\"payment_type\":\"pay_person\",\"amount_minor\":5000,\"recipient_kind\":\"phone\",\"recipient_name\":\"Mum\",\"recipient_msisdn_normalized\":\"250788111333\",\"category\":\"Transport\"}'::jsonb)->>'id');")"
as_user "$USER_A" "select public.transition_payment_intent('$O_INTENT1', 'initiated', null, '{}'::jsonb);" >/dev/null
as_user "$USER_A" "select public.transition_payment_intent('$O_INTENT1', 'awaiting_verification', null, '{}'::jsonb);" >/dev/null
O_TXN1="00000000-0000-0000-0000-00000000f001"
O_MK_TXN "$O_TXN1" "0788111333" 5000
O_R1="$(psql -d pfe_rls -t -A -c "set role service_role; select public.reconcile_transaction_with_payment_intents('$O_TXN1', 'apply');" | tail -1)"
O_STATE1="$(psql -d pfe_rls -t -A -c "select state || '|' || (verified_at is not null)::text || '|' || coalesce(linked_transaction_id::text,'null') from public.payment_intents where id = '$O_INTENT1';")"
O_CAT1="$(psql -d pfe_rls -t -A -c "select coalesce(suggested_category,'-') || '|' || category_decision_status from public.transactions where id = '$O_TXN1';")"
O_HIST1="$(psql -d pfe_rls -t -A -c "select count(*) from public.transaction_category_history where transaction_id = '$O_TXN1' and new_category_source = 'system' and new_decision_status = 'suggested';")"
if echo "$O_R1" | grep -q '"status": "linked"' \
   && [ "$O_STATE1" = "successful|true|$O_TXN1" ] \
   && [ "$O_CAT1" = "Transport|suggested" ] \
   && [ "$O_HIST1" = "1" ]; then
  pass "Phase O: apply-mode single match links + verifies the intent and suggests its category (no ledger insert)"
else
  fail "Phase O: apply-mode link wrong (r=$O_R1 state=$O_STATE1 cat=$O_CAT1 hist=$O_HIST1)"
fi

# No second ledger row was created.
O_TXN_COUNT="$(psql -d pfe_rls -t -A -c "select count(*) from public.transactions where workspace_id = '$WORKSPACE_A' and counterparty_reference = '0788111333';")"
if [ "$O_TXN_COUNT" = "1" ]; then
  pass "Phase O: reconciliation never creates a second transaction row"
else
  fail "Phase O: expected exactly 1 matching transaction, found $O_TXN_COUNT"
fi

# Re-running on the same transaction is a no-op.
O_R1B="$(psql -d pfe_rls -t -A -c "set role service_role; select public.reconcile_transaction_with_payment_intents('$O_TXN1', 'apply');" | tail -1)"
O_RECON_COUNT="$(psql -d pfe_rls -t -A -c "select count(*) from public.payment_reconciliations where transaction_id = '$O_TXN1' and status = 'linked';")"
if echo "$O_R1B" | grep -q 'already_linked' && [ "$O_RECON_COUNT" = "1" ]; then
  pass "Phase O: re-reconciling a linked transaction is a no-op (idempotent)"
else
  fail "Phase O: second reconcile call was not a no-op (r=$O_R1B count=$O_RECON_COUNT)"
fi

# --- observe mode: records the candidate but does not mutate the intent
O_INTENT2="$(as_user "$USER_A" "select (public.create_payment_intent('{\"workspace_id\":\"$WORKSPACE_A\",\"idempotency_key\":\"O-2\",\"payment_type\":\"pay_person\",\"amount_minor\":7000,\"recipient_kind\":\"phone\",\"recipient_name\":\"Bro\",\"recipient_msisdn_normalized\":\"250788222444\"}'::jsonb)->>'id');")"
as_user "$USER_A" "select public.transition_payment_intent('$O_INTENT2', 'initiated', null, '{}'::jsonb);" >/dev/null
as_user "$USER_A" "select public.transition_payment_intent('$O_INTENT2', 'awaiting_verification', null, '{}'::jsonb);" >/dev/null
O_TXN2="00000000-0000-0000-0000-00000000f002"
O_MK_TXN "$O_TXN2" "0788222444" 7000
psql -d pfe_rls -t -A -c "set role service_role; select public.reconcile_transaction_with_payment_intents('$O_TXN2', 'observe');" >/dev/null
O_OBS="$(psql -d pfe_rls -t -A -c "select r.status || '|' || (r.applied_at is null)::text || '|' || i.state from public.payment_reconciliations r join public.payment_intents i on i.id = r.payment_intent_id where r.transaction_id = '$O_TXN2';")"
if [ "$O_OBS" = "linked|true|awaiting_verification" ]; then
  pass "Phase O: observe mode records a linked candidate (applied_at NULL) without changing the intent"
else
  fail "Phase O: observe mode mutated state or wrong row ($O_OBS)"
fi

# apply_payment_reconciliation promotes the observed row.
O_RECON2="$(psql -d pfe_rls -t -A -c "select id from public.payment_reconciliations where transaction_id = '$O_TXN2';")"
as_user "$USER_A" "select public.apply_payment_reconciliation('$O_RECON2');" >/dev/null
O_OBS2="$(psql -d pfe_rls -t -A -c "select (r.applied_at is not null)::text || '|' || i.state || '|' || (i.verified_at is not null)::text from public.payment_reconciliations r join public.payment_intents i on i.id = r.payment_intent_id where r.id = '$O_RECON2';")"
if [ "$O_OBS2" = "true|successful|true" ]; then
  pass "Phase O: apply_payment_reconciliation promotes an observed match to applied + verified"
else
  fail "Phase O: apply_payment_reconciliation did not promote correctly ($O_OBS2)"
fi

# A non-member cannot apply/reject another workspace's reconciliation.
if as_user "$USER_B" "select public.apply_payment_reconciliation('$O_RECON2');" >/dev/null 2>$ARTIFACT_DIR/pfe_o_auth.log; then
  fail "Phase O: User B applied User A's reconciliation - authorization gap"
else
  pass "Phase O: apply_payment_reconciliation refuses a non-member"
fi
rm -f $ARTIFACT_DIR/pfe_o_auth.log

# authenticated cannot EXECUTE the service_role-only matchers.
if as_user "$USER_A" "select public.reconcile_transaction_with_payment_intents('$O_TXN1', 'apply');" >/dev/null 2>$ARTIFACT_DIR/pfe_o_exec.log; then
  fail "Phase O: authenticated was able to call reconcile_transaction_with_payment_intents"
else
  pass "Phase O: reconcile_transaction_with_payment_intents is not authenticated-callable"
fi
rm -f $ARTIFACT_DIR/pfe_o_exec.log
if as_user "$USER_A" "select public.system_transition_payment_intent('$O_INTENT1', 'reversed', null, '{}'::jsonb);" >/dev/null 2>$ARTIFACT_DIR/pfe_o_exec2.log; then
  fail "Phase O: authenticated was able to call system_transition_payment_intent"
else
  pass "Phase O: system_transition_payment_intent is not authenticated-callable"
fi
rm -f $ARTIFACT_DIR/pfe_o_exec2.log

# --- ambiguity -> conflict, never a guess
O_INTENT3A="$(as_user "$USER_A" "select (public.create_payment_intent('{\"workspace_id\":\"$WORKSPACE_A\",\"idempotency_key\":\"O-3a\",\"payment_type\":\"pay_person\",\"amount_minor\":9000,\"recipient_kind\":\"phone\",\"recipient_name\":\"X\",\"recipient_msisdn_normalized\":\"250788333555\"}'::jsonb)->>'id');")"
O_INTENT3B="$(as_user "$USER_A" "select (public.create_payment_intent('{\"workspace_id\":\"$WORKSPACE_A\",\"idempotency_key\":\"O-3b\",\"payment_type\":\"pay_person\",\"amount_minor\":9000,\"recipient_kind\":\"phone\",\"recipient_name\":\"Y\",\"recipient_msisdn_normalized\":\"250788333555\"}'::jsonb)->>'id');")"
for iid in "$O_INTENT3A" "$O_INTENT3B"; do
  as_user "$USER_A" "select public.transition_payment_intent('$iid', 'initiated', null, '{}'::jsonb);" >/dev/null
  as_user "$USER_A" "select public.transition_payment_intent('$iid', 'awaiting_verification', null, '{}'::jsonb);" >/dev/null
done
O_TXN3="00000000-0000-0000-0000-00000000f003"
O_MK_TXN "$O_TXN3" "0788333555" 9000
O_R3="$(psql -d pfe_rls -t -A -c "set role service_role; select public.reconcile_transaction_with_payment_intents('$O_TXN3', 'apply');" | tail -1)"
O_CONFLICTS="$(psql -d pfe_rls -t -A -c "select count(*) from public.payment_reconciliations where transaction_id = '$O_TXN3' and status = 'conflict';")"
O_REQ="$(psql -d pfe_rls -t -A -c "select count(*) from public.payment_intents where id in ('$O_INTENT3A','$O_INTENT3B') and state = 'requires_reconciliation';")"
O_NOLINK="$(psql -d pfe_rls -t -A -c "select count(*) from public.payment_reconciliations where transaction_id = '$O_TXN3' and status = 'linked';")"
if echo "$O_R3" | grep -q '"status": "conflict"' && [ "$O_CONFLICTS" = "2" ] && [ "$O_REQ" = "2" ] && [ "$O_NOLINK" = "0" ]; then
  pass "Phase O: two candidate intents -> conflict rows + both requires_reconciliation, nothing linked"
else
  fail "Phase O: ambiguity not handled as a conflict (r=$O_R3 conflicts=$O_CONFLICTS req=$O_REQ linked=$O_NOLINK)"
fi

# --- a stronger existing category decision is never overwritten
O_INTENT4="$(as_user "$USER_A" "select (public.create_payment_intent('{\"workspace_id\":\"$WORKSPACE_A\",\"idempotency_key\":\"O-4\",\"payment_type\":\"pay_person\",\"amount_minor\":4000,\"recipient_kind\":\"phone\",\"recipient_name\":\"Z\",\"recipient_msisdn_normalized\":\"250788444666\",\"category\":\"Gifts\"}'::jsonb)->>'id');")"
as_user "$USER_A" "select public.transition_payment_intent('$O_INTENT4', 'initiated', null, '{}'::jsonb);" >/dev/null
as_user "$USER_A" "select public.transition_payment_intent('$O_INTENT4', 'awaiting_verification', null, '{}'::jsonb);" >/dev/null
O_TXN4="00000000-0000-0000-0000-00000000f004"
O_MK_TXN "$O_TXN4" "0788444666" 4000 "manual" "confirmed" "Groceries"
psql -d pfe_rls -t -A -c "set role service_role; select public.reconcile_transaction_with_payment_intents('$O_TXN4', 'apply');" >/dev/null
O_CAT4="$(psql -d pfe_rls -t -A -c "select category || '|' || category_decision_status || '|' || coalesce(suggested_category,'-') from public.transactions where id = '$O_TXN4';")"
if [ "$O_CAT4" = "Groceries|confirmed|-" ]; then
  pass "Phase O: a confirmed/manual transaction category is not overwritten by reconciliation"
else
  fail "Phase O: reconciliation overwrote a stronger category decision ($O_CAT4)"
fi

# --- no match: wrong amount
O_TXN5="00000000-0000-0000-0000-00000000f005"
O_MK_TXN "$O_TXN5" "0788111333" 1234
O_R5="$(psql -d pfe_rls -t -A -c "set role service_role; select public.reconcile_transaction_with_payment_intents('$O_TXN5', 'apply');" | tail -1)"
if echo "$O_R5" | grep -q '"status": "no_match"'; then
  pass "Phase O: an amount mismatch produces no match and writes nothing"
else
  fail "Phase O: amount mismatch was not a clean no_match ($O_R5)"
fi

# ===========================================================================
# Phase P: payment networks, access routes, granular directory.* perms.
# The seeded eKash network is published; its draft participation rows are
# not visible to non-admins; has_directory_permission() gates the RPCs;
# per-transition permissions enforce maker-checker; a PIN parameter_key in
# a menu step is rejected; evidence metadata is RLS-gated; alias
# normalisation dedupes; the seed is idempotent. Reuses pfe_rls.
# ===========================================================================
echo "=== Phase P: payment networks & directory permissions ==="

P_EKASH="d0000000-0000-4000-8000-0000000000d3"
P_PROVIDER="11111111-1111-4111-8111-111111111111"   # created in the Phase M block
USER_PADMIN="$(psql -d pfe_rls -t -A -c "insert into auth.users (email) values ('dir-admin@example.com') returning id;" | head -1)"
USER_PCREATOR="$(psql -d pfe_rls -t -A -c "insert into auth.users (email) values ('dir-creator@example.com') returning id;" | head -1)"
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; update public.profiles set is_platform_admin = true where id = '$USER_PADMIN';" >/dev/null

# A plain user sees the published eKash network, and sees only PUBLISHED
# participation - a fresh draft participation is invisible to them. The
# 20260909000400 seed publishes the campaign bank routes, so eKash now has
# published participation; this test creates its own draft to isolate the
# RLS behaviour.
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  insert into public.institution_network_participation (provider_id, payment_network_id, participant_role, state)
  values ('$P_PROVIDER', '$P_EKASH', 'bank', 'draft')
  on conflict do nothing;
" >/dev/null
P_NET="$(as_user "$USER_A" "select count(*) from public.payment_networks where slug = 'ekash';")"
P_PART_USER="$(as_user "$USER_A" "select count(*) from public.institution_network_participation where payment_network_id = '$P_EKASH';")"
P_PART_PUB="$(psql -d pfe_rls -t -A -c "select count(*) from public.institution_network_participation where payment_network_id = '$P_EKASH' and state = 'published' and effective_from <= now() and (effective_to is null or effective_to > now());")"
P_PART_DRAFT_SEEN="$(as_user "$USER_A" "select count(*) from public.institution_network_participation where payment_network_id = '$P_EKASH' and provider_id = '$P_PROVIDER' and state = 'draft';")"
if [ "$P_NET" = "1" ] && [ "$P_PART_USER" = "$P_PART_PUB" ] && [ "$P_PART_DRAFT_SEEN" = "0" ]; then
  pass "Phase P: a non-admin sees the published eKash network + only its published participation, never a draft (RLS)"
else
  fail "Phase P: non-admin network visibility wrong (network=$P_NET user_part=$P_PART_USER published=$P_PART_PUB draft_seen=$P_PART_DRAFT_SEEN)"
fi

# has_directory_permission is false for a plain user, true after a grant.
P_HASBEFORE="$(as_user "$USER_PCREATOR" "select public.has_directory_permission('directory.create');")"
# Grant the authoring permissions (create/edit/submit) but NOT publish -
# this is the maker-checker split the publish test below depends on.
as_user "$USER_PADMIN" "select public.admin_grant_directory_permission('$USER_PCREATOR', 'directory.create', null);" >/dev/null
as_user "$USER_PADMIN" "select public.admin_grant_directory_permission('$USER_PCREATOR', 'directory.edit_draft', null);" >/dev/null
as_user "$USER_PADMIN" "select public.admin_grant_directory_permission('$USER_PCREATOR', 'directory.submit_review', null);" >/dev/null
P_HASAFTER="$(as_user "$USER_PCREATOR" "select public.has_directory_permission('directory.create');")"
if [ "$P_HASBEFORE" = "f" ] && [ "$P_HASAFTER" = "t" ]; then
  pass "Phase P: has_directory_permission flips false -> true after admin_grant_directory_permission"
else
  fail "Phase P: permission grant did not take effect (before=$P_HASBEFORE after=$P_HASAFTER)"
fi

# A user with no directory permission cannot create a network at all.
if as_user "$USER_B" "select public.admin_upsert_payment_network('{\"slug\":\"forged-net\",\"canonical_name\":\"x\",\"display_name_en\":\"x\",\"entity_type\":\"other\"}'::jsonb);" >/dev/null 2>$ARTIFACT_DIR/pfe_p_forge.log; then
  fail "Phase P: a user without directory.create created a payment network"
else
  pass "Phase P: admin_upsert_payment_network refuses a caller without directory.create"
fi
rm -f $ARTIFACT_DIR/pfe_p_forge.log

# An author (create/edit/submit) can draft and submit for review, but NOT publish.
P_NEWNET="$(as_user "$USER_PCREATOR" "select public.admin_upsert_payment_network('{\"slug\":\"testnet\",\"canonical_name\":\"TestNet\",\"display_name_en\":\"TestNet\",\"entity_type\":\"other\",\"change_reason\":\"initial\"}'::jsonb);")"
as_user "$USER_PCREATOR" "select public.admin_set_payment_network_state('$P_NEWNET', 'pending_review', null);" >/dev/null
if as_user "$USER_PCREATOR" "select public.admin_set_payment_network_state('$P_NEWNET', 'published', null);" >/dev/null 2>$ARTIFACT_DIR/pfe_p_pub.log; then
  fail "Phase P: an author without directory.publish published a network (maker-checker not enforced)"
else
  pass "Phase P: publishing requires directory.publish, not just the authoring permissions (maker-checker)"
fi
rm -f $ARTIFACT_DIR/pfe_p_pub.log

# The state machine rejects draft -> published directly (even for a platform admin).
P_NEWNET2="$(as_user "$USER_PADMIN" "select public.admin_upsert_payment_network('{\"slug\":\"testnet2\",\"canonical_name\":\"TestNet2\",\"display_name_en\":\"TestNet2\",\"entity_type\":\"other\"}'::jsonb);")"
if as_user "$USER_PADMIN" "select public.admin_set_payment_network_state('$P_NEWNET2', 'published', 'skip');" >/dev/null 2>$ARTIFACT_DIR/pfe_p_sm.log; then
  fail "Phase P: draft -> published was allowed, skipping pending_review"
else
  pass "Phase P: the network state machine rejects draft -> published"
fi
rm -f $ARTIFACT_DIR/pfe_p_sm.log

# draft -> pending_review -> published works for a platform admin and writes version snapshots.
as_user "$USER_PADMIN" "select public.admin_set_payment_network_state('$P_NEWNET2', 'pending_review', null);" >/dev/null
as_user "$USER_PADMIN" "select public.admin_set_payment_network_state('$P_NEWNET2', 'published', null);" >/dev/null
P_NOWSTATE="$(psql -d pfe_rls -t -A -c "select state from public.payment_networks where id = '$P_NEWNET2';")"
P_VERSIONS="$(psql -d pfe_rls -t -A -c "select count(*) from public.directory_versions where subject_type = 'payment_network' and subject_id = '$P_NEWNET2';")"
if [ "$P_NOWSTATE" = "published" ] && [ "$P_VERSIONS" -ge "2" ]; then
  pass "Phase P: draft -> pending_review -> published succeeds and records directory_versions snapshots"
else
  fail "Phase P: staged network publish failed (state=$P_NOWSTATE versions=$P_VERSIONS)"
fi

# A menu step whose parameter_key names a secret is rejected outright.
if as_user "$USER_PADMIN" "select public.admin_upsert_access_route('{\"slug\":\"bad-route\",\"provider_id\":\"$P_PROVIDER\",\"channel\":\"ussd\",\"display_name_en\":\"Bad route\",\"approved_entry_point_en\":\"*000#\",\"menu_steps\":[{\"instruction_en\":\"Enter your PIN\",\"parameter_key\":\"pin\"}]}'::jsonb);" >/dev/null 2>$ARTIFACT_DIR/pfe_p_pin.log; then
  fail "Phase P: an access-route menu step with parameter_key='pin' was accepted (ADR 0001 violation)"
else
  pass "Phase P: admin_upsert_access_route rejects a PIN/OTP/secret parameter_key in a menu step"
fi
rm -f $ARTIFACT_DIR/pfe_p_pin.log

# Evidence metadata is visible to a directory.view_evidence holder only.
P_SRC="$(as_user "$USER_PADMIN" "select public.admin_upsert_directory_source('{\"organization\":\"Test Bank\",\"classification\":\"official_financial_institution\"}'::jsonb);")"
as_user "$USER_PADMIN" "select public.admin_attach_directory_evidence(('{\"source_id\":\"'||'$P_SRC'||'\",\"subject_type\":\"payment_network\",\"subject_id\":\"$P_EKASH\",\"internal_note\":\"seen it\"}')::jsonb);" >/dev/null
P_EV_PLAIN="$(as_user "$USER_A" "select count(*) from public.directory_evidence;")"
P_EV_ADMIN="$(as_user "$USER_PADMIN" "select count(*) from public.directory_evidence;")"
if [ "$P_EV_PLAIN" = "0" ] && [ "$P_EV_ADMIN" -ge "1" ]; then
  pass "Phase P: directory_evidence metadata is hidden from a user without directory.view_evidence"
else
  fail "Phase P: directory_evidence visibility wrong (plain=$P_EV_PLAIN admin=$P_EV_ADMIN)"
fi

# Alias normalisation + seed dedupe.
P_NORM="$(psql -d pfe_rls -t -A -c "select public.normalize_directory_alias('e-Kash!');")"
P_ALIASES="$(psql -d pfe_rls -t -A -c "select count(*) from public.directory_aliases where subject_type = 'payment_network' and subject_id = '$P_EKASH';")"
if [ "$P_NORM" = "ekash" ] && [ "$P_ALIASES" = "3" ]; then
  pass "Phase P: alias normalisation collapses 'e-Kash!' -> 'ekash' and the seed dedupes to 3 distinct aliases"
else
  fail "Phase P: alias handling wrong (normalised='$P_NORM' distinct aliases=$P_ALIASES, expected ekash/3)"
fi

# The Phase P seed is idempotent.
P_SEED_FILE="$MIGRATIONS_DIR/20260909000100_phase_p_payment_networks_seed.sql"
P_SEED_BEFORE="$(psql -d pfe_rls -t -A -c "select count(*) from public.payment_networks;")"
psql -d pfe_rls -v ON_ERROR_STOP=1 -f "$P_SEED_FILE" >/dev/null 2>&1
P_SEED_AFTER="$(psql -d pfe_rls -t -A -c "select count(*) from public.payment_networks;")"
if [ "$P_SEED_BEFORE" = "$P_SEED_AFTER" ]; then
  pass "Phase P: re-running the payment-network seed inserts nothing new (idempotent)"
else
  fail "Phase P: seed migration is not idempotent ($P_SEED_BEFORE -> $P_SEED_AFTER payment networks)"
fi

# --- directory_suggestions (P4): moderation-only, rate-limited, reporter-scoped.
S_R1="$(as_user "$USER_B" "insert into public.directory_suggestions (suggester_user_id, suggestion_type, body) values ('$USER_B', 'new_service', 'add code X') returning id;")"
if [ -n "$S_R1" ]; then
  pass "Phase P: a user can submit a directory suggestion"
else
  fail "Phase P: directory_suggestions insert failed for the suggester"
fi

S_RL_OK=1
for i in 2 3 4 5; do
  as_user "$USER_B" "insert into public.directory_suggestions (suggester_user_id, suggestion_type, body) values ('$USER_B', 'other', 'more $i');" >/dev/null 2>&1 || S_RL_OK=0
done
if as_user "$USER_B" "insert into public.directory_suggestions (suggester_user_id, suggestion_type, body) values ('$USER_B', 'other', 'sixth');" >/dev/null 2>$ARTIFACT_DIR/pfe_p_sugg_rl.log; then
  fail "Phase P: a 6th open suggestion in an hour was accepted - rate limit not enforced"
elif [ "$S_RL_OK" = "1" ]; then
  pass "Phase P: directory_suggestions insert is rate-limited to 5 open per user per hour"
else
  fail "Phase P: one of the first 5 suggestions was unexpectedly rejected"
fi
rm -f $ARTIFACT_DIR/pfe_p_sugg_rl.log

S_SEE_A="$(as_user "$USER_A" "select count(*) from public.directory_suggestions;")"
if [ "$S_SEE_A" = "0" ]; then
  pass "Phase P: a user cannot see another user's directory suggestions (RLS)"
else
  fail "Phase P: directory_suggestions are not reporter-scoped (User A sees $S_SEE_A)"
fi

if as_user "$USER_B" "select public.admin_resolve_directory_suggestion('$S_R1', 'accepted', 'ok', null, null);" >/dev/null 2>$ARTIFACT_DIR/pfe_p_sugg_res.log; then
  fail "Phase P: a non-admin resolved a directory suggestion - authorization gap"
else
  pass "Phase P: admin_resolve_directory_suggestion refuses a caller without directory.resolve_reports"
fi
rm -f $ARTIFACT_DIR/pfe_p_sugg_res.log

as_user "$USER_PADMIN" "select public.admin_resolve_directory_suggestion('$S_R1', 'accepted', 'linked to a new draft', null, null);" >/dev/null
S_STATUS="$(psql -d pfe_rls -t -A -c "select status from public.directory_suggestions where id = '$S_R1';")"
S_AUDIT="$(psql -d pfe_rls -t -A -c "select count(*) from public.service_directory_audit_events where subject_type = 'directory_suggestion' and subject_id = '$S_R1';")"
if [ "$S_STATUS" = "accepted" ] && [ "$S_AUDIT" = "1" ]; then
  pass "Phase P: an admin resolves a suggestion and it writes an audit event (never an auto-publish)"
else
  fail "Phase P: suggestion resolution wrong (status=$S_STATUS audit=$S_AUDIT)"
fi

# ===========================================================================
# Phase Q: OneLedger Spaces foundation - the household Space kind, the
# person-owned financial-source model, and the hard privacy rule that
# joining a household shares nothing until the source owner explicitly
# allocates a source into it. Reuses pfe_rls (USER_A/WORKSPACE_A,
# USER_B/WORKSPACE_B, and the User A transaction d3 from the RLS block).
# ===========================================================================
echo "=== Phase Q: Spaces foundation - household kind and source visibility ==="

# --- household workspace creation ----------------------------------------

Q_HH="$(as_user "$USER_A" "select public.create_household_workspace('Niyoyo Household');")"
Q_HH_OK="$(psql -d pfe_rls -t -A -c "select count(*) from public.workspaces w join public.workspace_memberships m on m.workspace_id = w.id where w.id = '$Q_HH' and w.kind = 'household' and m.user_id = '$USER_A' and m.role = 'owner' and m.status = 'active';")"
if [ "$Q_HH_OK" = "1" ]; then
  pass "Phase Q: create_household_workspace makes a kind='household' workspace with the caller as sole active owner"
else
  fail "Phase Q: create_household_workspace did not produce the expected household + owner membership (got $Q_HH_OK)"
fi

# currency/timezone inherited from the creator's profile (RWF/Africa/Kigali
# defaults here, since the mock profile is never customised) - assert the
# household is at least well-formed, not left with NULLs.
Q_HH_SHAPE="$(psql -d pfe_rls -t -A -c "select count(*) from public.workspaces where id = '$Q_HH' and default_currency = 'RWF' and timezone = 'Africa/Kigali' and status = 'active';")"
if [ "$Q_HH_SHAPE" = "1" ]; then
  pass "Phase Q: a new household inherits currency/timezone (profile defaults) and opens active"
else
  fail "Phase Q: new household currency/timezone/status not set as expected"
fi

# --- financial_sources ownership isolation ------------------------------

Q_SRC_A="$(as_user "$USER_A" "insert into public.financial_sources (owner_user_id, provider, source_type, display_name, currency) values ('$USER_A', 'mtn_momo', 'mobile_money', 'Alice MTN MoMo', 'RWF') returning id;")"
Q_SRC_SEES_OWNER="$(as_user "$USER_A" "select count(*) from public.financial_sources where id = '$Q_SRC_A';")"
Q_SRC_SEES_OTHER="$(as_user "$USER_B" "select count(*) from public.financial_sources where id = '$Q_SRC_A';")"
if [ "$Q_SRC_SEES_OWNER" = "1" ] && [ "$Q_SRC_SEES_OTHER" = "0" ]; then
  pass "Phase Q: a financial source is visible to its owner and to nobody else by default (personal_only)"
else
  fail "Phase Q: financial_sources visibility wrong (owner=$Q_SRC_SEES_OWNER other=$Q_SRC_SEES_OTHER, expected 1/0)"
fi

# User B cannot create a source owned by User A.
if as_user "$USER_B" "insert into public.financial_sources (owner_user_id, provider, source_type, display_name, currency) values ('$USER_A', 'bank', 'bank_account', 'Forged', 'RWF');" >/dev/null 2>$ARTIFACT_DIR/pfe_q_forge_src.log; then
  fail "Phase Q: User B created a financial source owned by User A - insert policy not owner-scoped"
else
  pass "Phase Q: financial_sources insert is rejected unless owner_user_id = auth.uid()"
fi
rm -f $ARTIFACT_DIR/pfe_q_forge_src.log

# --- joining a household shares nothing --------------------------------

# User B joins the household as a member (membership rows are service-role
# managed - Phase B/C left workspace_memberships SELECT-only for authenticated).
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; insert into public.workspace_memberships (workspace_id, user_id, role, status, joined_at) values ('$Q_HH', '$USER_B', 'member', 'active', now());" >/dev/null

# Fixture: an account + transaction in the household, backed by User A's
# source, created via service_role (mirrors the Phase C fixture style).
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  insert into public.accounts (id, workspace_id, name, provider, currency, financial_source_id)
  values ('00000000-0000-0000-0000-0000000000aa', '$Q_HH', 'Alice MoMo (household)', 'mtn_momo', 'RWF', '$Q_SRC_A');
  insert into public.transactions (id, source, financial_source_id, account_id, workspace_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version)
  values ('00000000-0000-0000-0000-0000000000ab', 'manual', '$Q_SRC_A', '00000000-0000-0000-0000-0000000000aa', '$Q_HH', 'merchant_payment', 'out', 'success', 15000, 0, now(), 'test');
" >/dev/null

Q_B_SEES_TXN_BEFORE="$(as_user "$USER_B" "select count(*) from public.transactions where id = '00000000-0000-0000-0000-0000000000ab';")"
Q_B_SEES_ACCT_BEFORE="$(as_user "$USER_B" "select count(*) from public.accounts where id = '00000000-0000-0000-0000-0000000000aa';")"
if [ "$Q_B_SEES_TXN_BEFORE" = "0" ] && [ "$Q_B_SEES_ACCT_BEFORE" = "0" ]; then
  pass "Phase Q: a household member cannot see a co-member's source, account, or transactions with no share link (the hard privacy rule)"
else
  fail "Phase Q: household member saw an unshared co-member's data (txn=$Q_B_SEES_TXN_BEFORE acct=$Q_B_SEES_ACCT_BEFORE, expected 0/0) - privacy breach"
fi

# Positive control: the source owner, who is also a household member, sees
# their own source's household data.
Q_A_SEES_TXN="$(as_user "$USER_A" "select count(*) from public.transactions where id = '00000000-0000-0000-0000-0000000000ab';")"
if [ "$Q_A_SEES_TXN" = "1" ]; then
  pass "Phase Q: the source owner sees their own source's transactions inside the household (positive control)"
else
  fail "Phase Q: the source owner could not see their own household transaction - policy over-blocking"
fi

# --- explicit allocation makes it visible -----------------------------

as_user "$USER_A" "insert into public.source_space_links (financial_source_id, workspace_id, visibility_mode, created_by) values ('$Q_SRC_A', '$Q_HH', 'share_transactions', '$USER_A');" >/dev/null
Q_B_SEES_TXN_AFTER="$(as_user "$USER_B" "select count(*) from public.transactions where id = '00000000-0000-0000-0000-0000000000ab';")"
Q_B_SEES_ACCT_AFTER="$(as_user "$USER_B" "select count(*) from public.accounts where id = '00000000-0000-0000-0000-0000000000aa';")"
if [ "$Q_B_SEES_TXN_AFTER" = "1" ] && [ "$Q_B_SEES_ACCT_AFTER" = "1" ]; then
  pass "Phase Q: after the owner allocates the source into the household with share_transactions, the co-member sees its transactions and account"
else
  fail "Phase Q: share link did not grant the co-member visibility (txn=$Q_B_SEES_TXN_AFTER acct=$Q_B_SEES_ACCT_AFTER, expected 1/1)"
fi

# A non-owner cannot forge a share link for someone else's source.
if as_user "$USER_B" "insert into public.source_space_links (financial_source_id, workspace_id, visibility_mode) values ('$Q_SRC_A', '$WORKSPACE_B', 'share_account');" >/dev/null 2>$ARTIFACT_DIR/pfe_q_forge_link.log; then
  fail "Phase Q: User B created a share link for User A's source - source_space_links insert not owner-scoped"
else
  pass "Phase Q: source_space_links insert is rejected unless the caller owns the source"
fi
rm -f $ARTIFACT_DIR/pfe_q_forge_link.log

# Pausing the link immediately hides the household-allocated history again.
as_user "$USER_A" "update public.source_space_links set status = 'paused' where financial_source_id = '$Q_SRC_A' and workspace_id = '$Q_HH';" >/dev/null
Q_B_SEES_TXN_PAUSED="$(as_user "$USER_B" "select count(*) from public.transactions where id = '00000000-0000-0000-0000-0000000000ab';")"
if [ "$Q_B_SEES_TXN_PAUSED" = "0" ]; then
  pass "Phase Q: pausing the share link immediately revokes the co-member's visibility of household-allocated history"
else
  fail "Phase Q: co-member still saw the transaction after the share link was paused (got $Q_B_SEES_TXN_PAUSED)"
fi

# --- personal/organization workspaces are unaffected -------------------

# User A can still read their own personal-workspace transaction (d3 from
# the RLS block) - can_view_source_in_space collapses to is_workspace_member
# for non-household workspaces, so the re-issued policy is behaviourally
# unchanged there.
Q_A_PERSONAL_STILL_OK="$(as_user "$USER_A" "select count(*) from public.transactions where id = '00000000-0000-0000-0000-0000000000d3';")"
if [ "$Q_A_PERSONAL_STILL_OK" = "1" ]; then
  pass "Phase Q: the re-issued accounts/transactions policies leave personal-workspace access unchanged (regression guard)"
else
  fail "Phase Q: User A lost access to their own personal-workspace transaction after the Phase Q policy re-issue - regression"
fi

# service_role still bypasses every Phase Q policy.
Q_SERVICE_SEES="$(psql -d pfe_rls -t -A -c "set role service_role; select count(*) from public.transactions where id = '00000000-0000-0000-0000-0000000000ab';" | tail -1)"
if [ "$Q_SERVICE_SEES" = "1" ]; then
  pass "Phase Q: service_role still sees household transactions regardless of source-visibility policies (ingestion unaffected)"
else
  fail "Phase Q: service_role visibility changed under the Phase Q policies (got $Q_SERVICE_SEES) - would break ingest-momo"
fi

# ===========================================================================
# Phase R: Spaces authorization capability layer + audit/activity write
# primitives + membership/invite RPC hardening. Continues in pfe_rls, on
# the Phase Q household Q_HH (USER_A owner, USER_B member) and USER_A's
# source Q_SRC_A.
# ===========================================================================
echo "=== Phase R: Spaces authz capabilities and audit ==="

# --- capability matrix ---------------------------------------------------

R_MATRIX_MISMATCHES="$(psql -d pfe_rls -t -A -c "
  with capabilities(capability) as (values
    ('space.manage_settings'), ('space.delete'),
    ('space.transfer_ownership'), ('members.manage'), ('budget.manage'),
    ('goal.manage'), ('rule.manage'), ('report.config'),
    ('category.manage'), ('transaction.create'),
    ('transaction.categorize'), ('audit.view')
  ), roles(role) as (values ('owner'), ('admin'), ('member'), ('viewer')),
  expected as (
    select role, capability,
      case
        when role = 'owner' then true
        when role = 'admin' then capability not in ('space.delete', 'space.transfer_ownership')
        when role = 'member' then capability in ('transaction.create', 'transaction.categorize')
        else false
      end as allowed
    from roles cross join capabilities
  )
  select count(*) from expected
  where public.space_role_has_capability('household', role, capability) is distinct from allowed;")"
R_UNKNOWN_OWNER="$(psql -d pfe_rls -t -A -c "select public.space_role_has_capability('household', 'owner', 'capability.typo');")"
R_UNKNOWN_ADMIN="$(psql -d pfe_rls -t -A -c "select public.space_role_has_capability('household', 'admin', 'capability.typo');")"
R_NULL_OWNER="$(psql -d pfe_rls -t -A -c "select public.space_role_has_capability('household', 'owner', null);")"
if [ "$R_MATRIX_MISMATCHES" = "0" ] && [ "$R_UNKNOWN_OWNER" = "f" ] && [ "$R_UNKNOWN_ADMIN" = "f" ] && [ "$R_NULL_OWNER" = "f" ]; then
  pass "Phase R: all 48 household role/capability cells match the closed authorization matrix"
else
  fail "Phase R: closed capability matrix mismatch (cells=$R_MATRIX_MISMATCHES owner_unknown=$R_UNKNOWN_OWNER admin_unknown=$R_UNKNOWN_ADMIN owner_null=$R_NULL_OWNER)"
fi

R_OWNER_DELETE="$(as_user "$USER_A" "select public.has_space_capability('$Q_HH', 'space.delete');")"
R_MEMBER_BUDGET="$(as_user "$USER_B" "select public.has_space_capability('$Q_HH', 'budget.manage');")"
R_MEMBER_TXN="$(as_user "$USER_B" "select public.has_space_capability('$Q_HH', 'transaction.create');")"
R_NONMEMBER="$(as_user "$USER_B" "select public.has_space_capability('$WORKSPACE_A', 'transaction.create');")"
if [ "$R_OWNER_DELETE" = "t" ] && [ "$R_MEMBER_BUDGET" = "f" ] && [ "$R_MEMBER_TXN" = "t" ] && [ "$R_NONMEMBER" = "f" ]; then
  pass "Phase R: has_space_capability reflects the role matrix (owner:space.delete, member:transaction.create yes / budget.manage no, non-member:nothing)"
else
  fail "Phase R: capability matrix wrong (owner.delete=$R_OWNER_DELETE member.budget=$R_MEMBER_BUDGET member.txn=$R_MEMBER_TXN nonmember=$R_NONMEMBER)"
fi

R_HAS_UNKNOWN="$(as_user "$USER_A" "select public.has_space_capability('$Q_HH', 'capability.typo');")"
if [ "$R_HAS_UNKNOWN" = "f" ]; then
  pass "Phase R: has_space_capability fails closed for an unknown capability"
else
  fail "Phase R: an owner received an unknown capability (got $R_HAS_UNKNOWN)"
fi

if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; insert into public.space_member_capability_grants (workspace_id, user_id, capability) values ('$Q_HH', '$USER_B', 'capability.typo');" >/dev/null 2>$ARTIFACT_DIR/pfe_r_unknown_capability.log; then
  fail "Phase R: service_role inserted a capability outside the closed catalog"
else
  pass "Phase R: the grants table rejects capability names outside the catalog"
fi
rm -f $ARTIFACT_DIR/pfe_r_unknown_capability.log

# Exercise the matrix through real memberships, including Viewer and a
# suspended membership. Keep this household isolated from later fixtures.
R_MATRIX_HH="$(as_user "$USER_A" "select public.create_household_workspace('R Matrix Household');")"
R_ADMIN_USER="$(psql -d pfe_rls -t -A -c "insert into auth.users (email) values ('r-matrix-admin@example.com') returning id;" | head -1)"
R_MEMBER_USER="$(psql -d pfe_rls -t -A -c "insert into auth.users (email) values ('r-matrix-member@example.com') returning id;" | head -1)"
R_VIEWER_USER="$(psql -d pfe_rls -t -A -c "insert into auth.users (email) values ('r-matrix-viewer@example.com') returning id;" | head -1)"
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; insert into public.workspace_memberships (workspace_id, user_id, role, status, joined_at) values ('$R_MATRIX_HH', '$R_ADMIN_USER', 'admin', 'active', now()), ('$R_MATRIX_HH', '$R_MEMBER_USER', 'member', 'active', now()), ('$R_MATRIX_HH', '$R_VIEWER_USER', 'viewer', 'active', now());" >/dev/null

R_OWNER_CAPS="$(as_user "$USER_A" "select count(*) from unnest(array['space.manage_settings','space.delete','space.transfer_ownership','members.manage','budget.manage','goal.manage','rule.manage','report.config','category.manage','transaction.create','transaction.categorize','audit.view']) c where public.has_space_capability('$R_MATRIX_HH', c);")"
R_ADMIN_CAPS="$(as_user "$R_ADMIN_USER" "select count(*) from unnest(array['space.manage_settings','space.delete','space.transfer_ownership','members.manage','budget.manage','goal.manage','rule.manage','report.config','category.manage','transaction.create','transaction.categorize','audit.view']) c where public.has_space_capability('$R_MATRIX_HH', c);")"
R_MEMBER_CAPS="$(as_user "$R_MEMBER_USER" "select count(*) from unnest(array['space.manage_settings','space.delete','space.transfer_ownership','members.manage','budget.manage','goal.manage','rule.manage','report.config','category.manage','transaction.create','transaction.categorize','audit.view']) c where public.has_space_capability('$R_MATRIX_HH', c);")"
R_VIEWER_CAPS="$(as_user "$R_VIEWER_USER" "select count(*) from unnest(array['space.manage_settings','space.delete','space.transfer_ownership','members.manage','budget.manage','goal.manage','rule.manage','report.config','category.manage','transaction.create','transaction.categorize','audit.view']) c where public.has_space_capability('$R_MATRIX_HH', c);")"
if [ "$R_OWNER_CAPS" = "12" ] && [ "$R_ADMIN_CAPS" = "10" ] && [ "$R_MEMBER_CAPS" = "2" ] && [ "$R_VIEWER_CAPS" = "0" ]; then
  pass "Phase R: active memberships expose 12/10/2/0 capabilities for owner/admin/member/viewer"
else
  fail "Phase R: membership capability totals wrong (owner=$R_OWNER_CAPS admin=$R_ADMIN_CAPS member=$R_MEMBER_CAPS viewer=$R_VIEWER_CAPS)"
fi

psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; update public.workspace_memberships set status = 'suspended' where workspace_id = '$R_MATRIX_HH' and user_id = '$R_MEMBER_USER';" >/dev/null
R_SUSPENDED_CAP="$(as_user "$R_MEMBER_USER" "select public.has_space_capability('$R_MATRIX_HH', 'transaction.create');")"
if [ "$R_SUSPENDED_CAP" = "f" ]; then
  pass "Phase R: suspending a membership removes its role capabilities immediately"
else
  fail "Phase R: a suspended member retained transaction.create"
fi

# --- per-member capability grant --------------------------------------

as_user "$USER_A" "select public.grant_space_capability('$Q_HH', '$USER_B', 'budget.manage');" >/dev/null
R_MEMBER_BUDGET_AFTER="$(as_user "$USER_B" "select public.has_space_capability('$Q_HH', 'budget.manage');")"
R_GRANT_AUDIT="$(psql -d pfe_rls -t -A -c "select count(*) from public.space_audit_events where workspace_id = '$Q_HH' and event_type = 'capability.granted';")"
if [ "$R_MEMBER_BUDGET_AFTER" = "t" ] && [ "$R_GRANT_AUDIT" = "1" ]; then
  pass "Phase R: grant_space_capability flips a member's capability on and writes one audit event"
else
  fail "Phase R: capability grant did not take effect (has=$R_MEMBER_BUDGET_AFTER audit=$R_GRANT_AUDIT)"
fi

# A plain member (no members.manage) cannot grant capabilities.
if as_user "$USER_B" "select public.grant_space_capability('$Q_HH', '$USER_B', 'rule.manage');" >/dev/null 2>$ARTIFACT_DIR/pfe_r_grant.log; then
  fail "Phase R: a member without members.manage granted a capability"
else
  pass "Phase R: grant_space_capability refuses a caller without members.manage"
fi
rm -f $ARTIFACT_DIR/pfe_r_grant.log

as_user "$USER_A" "select public.revoke_space_capability('$Q_HH', '$USER_B', 'budget.manage');" >/dev/null
R_MEMBER_BUDGET_REVOKED="$(as_user "$USER_B" "select public.has_space_capability('$Q_HH', 'budget.manage');")"
if [ "$R_MEMBER_BUDGET_REVOKED" = "f" ]; then
  pass "Phase R: revoke_space_capability removes the grant"
else
  fail "Phase R: capability still held after revoke (got $R_MEMBER_BUDGET_REVOKED)"
fi

# --- audit vs activity visibility -----------------------------------

R_AUDIT_MEMBER="$(as_user "$USER_B" "select count(*) from public.space_audit_events where workspace_id = '$Q_HH';")"
R_AUDIT_OWNER="$(as_user "$USER_A" "select count(*) from public.space_audit_events where workspace_id = '$Q_HH';")"
if [ "$R_AUDIT_MEMBER" = "0" ] && [ "$R_AUDIT_OWNER" -ge "1" ]; then
  pass "Phase R: space_audit_events is owner/admin-readable only (a plain member sees none)"
else
  fail "Phase R: space_audit_events visibility wrong (member=$R_AUDIT_MEMBER owner=$R_AUDIT_OWNER)"
fi

R_ACTIVITY_MEMBER="$(as_user "$USER_B" "select count(*) from public.space_activity where workspace_id = '$Q_HH' and kind = 'space.created';")"
if [ "$R_ACTIVITY_MEMBER" = "1" ]; then
  pass "Phase R: create_household_workspace wrote a member-readable 'space.created' activity row"
else
  fail "Phase R: expected one member-visible space.created activity row, got $R_ACTIVITY_MEMBER"
fi

# --- internal helpers are not authenticated-callable -----------------

R_HELPERS_LOCKED=1
for fn in "record_space_audit_event('$Q_HH','x','y',null,null,null)" "record_space_activity('$Q_HH','x','y',null,null)"; do
  if as_user "$USER_A" "select public.$fn;" >/dev/null 2>&1; then R_HELPERS_LOCKED=0; fi
done
if [ "$R_HELPERS_LOCKED" = "1" ]; then
  pass "Phase R: record_space_audit_event / record_space_activity are not authenticated-callable (internal helpers)"
else
  fail "Phase R: an internal audit/activity helper was callable by an authenticated user"
fi

# --- invite hardening -------------------------------------------------

USER_R="$(psql -d pfe_rls -t -A -c "insert into auth.users (email) values ('r-invitee@example.com') returning id;" | head -1)"
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; insert into public.workspace_invites (workspace_id, email, role, token_hash, token_prefix, invited_by) values ('$Q_HH', 'r-invitee@example.com', 'member', 'r-token-hash-1', 'r-pref-1', '$USER_A');" >/dev/null

R_ACCEPT_WS="$(as_user "$USER_R" "select public.accept_workspace_invite('r-token-hash-1');")"
R_ACCEPTED_BY="$(psql -d pfe_rls -t -A -c "select count(*) from public.workspace_invites where token_hash = 'r-token-hash-1' and status = 'accepted' and accepted_by = '$USER_R';")"
R_JOIN_AUDIT="$(psql -d pfe_rls -t -A -c "select count(*) from public.space_audit_events where workspace_id = '$Q_HH' and event_type = 'member.joined_via_invite';")"
if [ "$R_ACCEPT_WS" = "$Q_HH" ] && [ "$R_ACCEPTED_BY" = "1" ] && [ "$R_JOIN_AUDIT" = "1" ]; then
  pass "Phase R: accept_workspace_invite records accepted_by and writes a member.joined_via_invite audit event"
else
  fail "Phase R: invite acceptance bookkeeping wrong (ws=$R_ACCEPT_WS accepted_by=$R_ACCEPTED_BY audit=$R_JOIN_AUDIT)"
fi

# Re-accepting the same (now non-pending) token is rejected.
if as_user "$USER_R" "select public.accept_workspace_invite('r-token-hash-1');" >/dev/null 2>$ARTIFACT_DIR/pfe_r_reaccept.log; then
  fail "Phase R: an already-accepted invite token was accepted a second time"
else
  pass "Phase R: accept_workspace_invite rejects an already-redeemed token"
fi
rm -f $ARTIFACT_DIR/pfe_r_reaccept.log

# A revoked invite cannot be accepted.
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; insert into public.workspace_invites (workspace_id, email, role, token_hash, token_prefix, invited_by, status) values ('$Q_HH', 'r2@example.com', 'member', 'r-token-hash-2', 'r-pref-2', '$USER_A', 'revoked');" >/dev/null
if as_user "$USER_R" "select public.accept_workspace_invite('r-token-hash-2');" >/dev/null 2>$ARTIFACT_DIR/pfe_r_revoked.log; then
  fail "Phase R: a revoked invite token was accepted"
else
  pass "Phase R: accept_workspace_invite rejects a revoked token"
fi
rm -f $ARTIFACT_DIR/pfe_r_revoked.log

# --- membership RPC hardening + post-removal access revocation --------

# Re-activate the Q_SRC_A -> Q_HH share so USER_B can see the household txn
# again, then remove USER_B and confirm the access is gone.
as_user "$USER_A" "update public.source_space_links set status = 'active' where financial_source_id = '$Q_SRC_A' and workspace_id = '$Q_HH';" >/dev/null
R_B_SEES_BEFORE_REMOVE="$(as_user "$USER_B" "select count(*) from public.transactions where id = '00000000-0000-0000-0000-0000000000ab';")"

R_MEMB_B="$(psql -d pfe_rls -t -A -c "select id from public.workspace_memberships where workspace_id = '$Q_HH' and user_id = '$USER_B' and status = 'active';" | head -1)"
as_user "$USER_A" "select public.remove_member('$R_MEMB_B');" >/dev/null
R_B_SEES_AFTER_REMOVE="$(as_user "$USER_B" "select count(*) from public.transactions where id = '00000000-0000-0000-0000-0000000000ab';")"
R_REMOVE_AUDIT="$(psql -d pfe_rls -t -A -c "select count(*) from public.space_audit_events where workspace_id = '$Q_HH' and event_type = 'member.removed' and resource_id = '$R_MEMB_B';")"
if [ "$R_B_SEES_BEFORE_REMOVE" = "1" ] && [ "$R_B_SEES_AFTER_REMOVE" = "0" ] && [ "$R_REMOVE_AUDIT" = "1" ]; then
  pass "Phase R: remove_member immediately revokes the removed member's Space access and writes a member.removed audit event"
else
  fail "Phase R: removal did not revoke access / audit (before=$R_B_SEES_BEFORE_REMOVE after=$R_B_SEES_AFTER_REMOVE audit=$R_REMOVE_AUDIT)"
fi

# The last-owner guard still holds after the re-issue.
R_MEMB_A="$(psql -d pfe_rls -t -A -c "select id from public.workspace_memberships where workspace_id = '$Q_HH' and user_id = '$USER_A' and role = 'owner' and status = 'active';" | head -1)"
if as_user "$USER_A" "select public.set_member_role('$R_MEMB_A', 'member');" >/dev/null 2>$ARTIFACT_DIR/pfe_r_lastowner.log; then
  fail "Phase R: the sole owner was allowed to demote themselves"
else
  pass "Phase R: set_member_role still refuses to demote the final owner (guard survived the re-issue)"
fi
rm -f $ARTIFACT_DIR/pfe_r_lastowner.log

# set_member_role writes an audit event (promote USER_R, still a member).
R_MEMB_R="$(psql -d pfe_rls -t -A -c "select id from public.workspace_memberships where workspace_id = '$Q_HH' and user_id = '$USER_R' and status = 'active';" | head -1)"
as_user "$USER_A" "select public.set_member_role('$R_MEMB_R', 'admin');" >/dev/null
R_ROLE_AUDIT="$(psql -d pfe_rls -t -A -c "select count(*) from public.space_audit_events where workspace_id = '$Q_HH' and event_type = 'member.role_changed' and resource_id = '$R_MEMB_R';")"
if [ "$R_ROLE_AUDIT" = "1" ]; then
  pass "Phase R: set_member_role writes a member.role_changed audit event"
else
  fail "Phase R: expected one member.role_changed audit event, got $R_ROLE_AUDIT"
fi

# service_role reads the audit trail unaffected by RLS.
R_SERVICE_AUDIT="$(psql -d pfe_rls -t -A -c "set role service_role; select count(*) from public.space_audit_events where workspace_id = '$Q_HH';" | tail -1)"
if [ "$R_SERVICE_AUDIT" -ge "1" ]; then
  pass "Phase R: service_role reads space_audit_events unaffected by RLS"
else
  fail "Phase R: service_role could not read space_audit_events (got $R_SERVICE_AUDIT)"
fi

# ===========================================================================
# Phase S: the shared-ledger mutation RPCs - source sharing,
# per-transaction attribution, and cross-Space reallocation. Continues in
# pfe_rls on the Phase Q/R household Q_HH (USER_A owner, USER_R admin,
# USER_B removed), USER_A's source Q_SRC_A (actively shared into Q_HH),
# and the household transaction ...ab.
# ===========================================================================
echo "=== Phase S: shared-ledger mutation RPCs ==="

S_TXN="00000000-0000-0000-0000-0000000000ab"
S_D3="00000000-0000-0000-0000-0000000000d3"

# --- set_transaction_attribution: member --------------------------------

as_user "$USER_A" "select public.set_transaction_attribution('$S_TXN', 'member', '$USER_R', null);" >/dev/null
S_MEMBER_OK="$(psql -d pfe_rls -t -A -c "select count(*) from public.transactions where id = '$S_TXN' and attribution_type = 'member' and attributed_user_id = '$USER_R' and allocation_status = 'allocated';")"
S_ATTR_AUDIT="$(psql -d pfe_rls -t -A -c "select count(*) from public.space_audit_events where workspace_id = '$Q_HH' and event_type = 'transaction.attribution_changed';")"
if [ "$S_MEMBER_OK" = "1" ] && [ "$S_ATTR_AUDIT" -ge "1" ]; then
  pass "Phase S: set_transaction_attribution('member') stamps attributed_user_id and writes an audit event"
else
  fail "Phase S: member attribution wrong (txn=$S_MEMBER_OK audit=$S_ATTR_AUDIT)"
fi

# --- set_transaction_attribution: split --------------------------------

as_user "$USER_A" "select public.set_transaction_attribution('$S_TXN', 'split', null, '[{\"user_id\":\"$USER_A\",\"share_bps\":4000},{\"user_id\":\"$USER_R\",\"share_bps\":6000}]'::jsonb);" >/dev/null
S_SPLIT_ROWS="$(psql -d pfe_rls -t -A -c "select coalesce(sum(share_bps),0) from public.transaction_member_attributions where transaction_id = '$S_TXN';")"
S_SPLIT_TYPE="$(psql -d pfe_rls -t -A -c "select count(*) from public.transactions where id = '$S_TXN' and attribution_type = 'split' and attributed_user_id is null;")"
if [ "$S_SPLIT_ROWS" = "10000" ] && [ "$S_SPLIT_TYPE" = "1" ]; then
  pass "Phase S: set_transaction_attribution('split') writes basis-point rows totalling 10000 and clears attributed_user_id"
else
  fail "Phase S: split attribution wrong (bps_total=$S_SPLIT_ROWS type_ok=$S_SPLIT_TYPE)"
fi

# A split that does not total 10000 is rejected (deferrable trigger).
if as_user "$USER_A" "select public.set_transaction_attribution('$S_TXN', 'split', null, '[{\"user_id\":\"$USER_A\",\"share_bps\":3000},{\"user_id\":\"$USER_R\",\"share_bps\":6000}]'::jsonb);" >/dev/null 2>$ARTIFACT_DIR/pfe_s_split.log; then
  fail "Phase S: a split totalling 9000 bps was accepted"
else
  pass "Phase S: a member-attribution split that does not total 10000 bps is rejected"
fi
rm -f $ARTIFACT_DIR/pfe_s_split.log

# A split naming a non-member (USER_B was removed in Phase R) is rejected.
if as_user "$USER_A" "select public.set_transaction_attribution('$S_TXN', 'split', null, '[{\"user_id\":\"$USER_A\",\"share_bps\":5000},{\"user_id\":\"$USER_B\",\"share_bps\":5000}]'::jsonb);" >/dev/null 2>$ARTIFACT_DIR/pfe_s_split2.log; then
  fail "Phase S: a split naming a non-member was accepted"
else
  pass "Phase S: a split naming a non-member of the Space is rejected"
fi
rm -f $ARTIFACT_DIR/pfe_s_split2.log

# --- unassigned -> shared transitions clear the split rows -----------

as_user "$USER_A" "select public.set_transaction_attribution('$S_TXN', 'unassigned', null, null);" >/dev/null
as_user "$USER_A" "select public.set_transaction_attribution('$S_TXN', 'shared', null, null);" >/dev/null
S_SHARED_OK="$(psql -d pfe_rls -t -A -c "select count(*) from public.transactions t where t.id = '$S_TXN' and t.attribution_type = 'shared' and t.attributed_user_id is null;")"
S_SPLIT_CLEARED="$(psql -d pfe_rls -t -A -c "select count(*) from public.transaction_member_attributions where transaction_id = '$S_TXN';")"
if [ "$S_SHARED_OK" = "1" ] && [ "$S_SPLIT_CLEARED" = "0" ]; then
  pass "Phase S: switching a transaction to 'shared' clears any prior member-split rows"
else
  fail "Phase S: shared transition wrong (shared_ok=$S_SHARED_OK split_rows_left=$S_SPLIT_CLEARED)"
fi

# A user who cannot see the transaction cannot attribute it.
if as_user "$USER_B" "select public.set_transaction_attribution('$S_TXN', 'shared', null, null);" >/dev/null 2>$ARTIFACT_DIR/pfe_s_nonmember.log; then
  fail "Phase S: a non-member attributed a household transaction"
else
  pass "Phase S: set_transaction_attribution refuses a caller who cannot see the transaction"
fi
rm -f $ARTIFACT_DIR/pfe_s_nonmember.log

# Attribution is household-only.
if as_user "$USER_A" "select public.set_transaction_attribution('$S_D3', 'shared', null, null);" >/dev/null 2>$ARTIFACT_DIR/pfe_s_personal.log; then
  fail "Phase S: attribution was allowed on a personal-workspace transaction"
else
  pass "Phase S: set_transaction_attribution refuses a non-household transaction"
fi
rm -f $ARTIFACT_DIR/pfe_s_personal.log

# --- allocate_source_to_space -------------------------------------------

S_SRC2="$(as_user "$USER_A" "insert into public.financial_sources (owner_user_id, provider, source_type, display_name, currency) values ('$USER_A', 'bank', 'bank_account', 'Alice BK', 'RWF') returning id;")"
S_HH2="$(as_user "$USER_A" "select public.create_household_workspace('Second Household');")"

# Accounts for the reallocation fixtures below (transactions.account_id is
# NOT NULL - Phase B backfill). One per workspace the fixtures touch.
S_ACCT_HH2="$(psql -d pfe_rls -t -A -c "set role service_role; insert into public.accounts (workspace_id, name, provider, currency, financial_source_id) values ('$S_HH2', 'Alice BK (h2)', 'bank', 'RWF', '$S_SRC2') returning id;" | grep -Eo '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)"
S_ACCT_A="$(psql -d pfe_rls -t -A -c "set role service_role; insert into public.accounts (workspace_id, name, provider, currency, financial_source_id) values ('$WORKSPACE_A', 'Alice BK (personal)', 'bank', 'RWF', '$S_SRC2') returning id;" | grep -Eo '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)"

as_user "$USER_A" "select public.allocate_source_to_space('$S_SRC2', '$S_HH2', 'share_account', true, now());" >/dev/null
S_LINK_OK="$(psql -d pfe_rls -t -A -c "select count(*) from public.source_space_links where financial_source_id = '$S_SRC2' and workspace_id = '$S_HH2' and status = 'active' and visibility_mode = 'share_account' and is_default_target;")"
S_CEILING="$(psql -d pfe_rls -t -A -c "select visibility_mode from public.financial_sources where id = '$S_SRC2';")"
S_SHARE_ACT="$(psql -d pfe_rls -t -A -c "select count(*) from public.space_activity where workspace_id = '$S_HH2' and kind = 'source.shared';")"
if [ "$S_LINK_OK" = "1" ] && [ "$S_CEILING" = "share_account" ] && [ "$S_SHARE_ACT" = "1" ]; then
  pass "Phase S: allocate_source_to_space creates the link, raises the source ceiling, and logs activity"
else
  fail "Phase S: allocate_source_to_space wrong (link=$S_LINK_OK ceiling=$S_CEILING activity=$S_SHARE_ACT)"
fi

# Only the source owner can share it.
if as_user "$USER_R" "select public.allocate_source_to_space('$S_SRC2', '$S_HH2', 'share_transactions', false, now());" >/dev/null 2>$ARTIFACT_DIR/pfe_s_alloc.log; then
  fail "Phase S: a non-owner shared a financial source into a Space"
else
  pass "Phase S: allocate_source_to_space refuses a non-owner of the source"
fi
rm -f $ARTIFACT_DIR/pfe_s_alloc.log

# Per-source sharing is household-only.
if as_user "$USER_A" "select public.allocate_source_to_space('$S_SRC2', '$WORKSPACE_A', 'share_transactions', false, now());" >/dev/null 2>$ARTIFACT_DIR/pfe_s_alloc2.log; then
  fail "Phase S: allocate_source_to_space accepted a personal-workspace target"
else
  pass "Phase S: allocate_source_to_space refuses a non-household target"
fi
rm -f $ARTIFACT_DIR/pfe_s_alloc2.log

# --- set_source_space_link_status -----------------------------------

as_user "$USER_A" "select public.set_source_space_link_status('$S_SRC2', '$S_HH2', 'paused');" >/dev/null
S_PAUSED="$(psql -d pfe_rls -t -A -c "select status from public.source_space_links where financial_source_id = '$S_SRC2' and workspace_id = '$S_HH2';")"
as_user "$USER_A" "select public.set_source_space_link_status('$S_SRC2', '$S_HH2', 'active');" >/dev/null
S_RESUMED="$(psql -d pfe_rls -t -A -c "select status from public.source_space_links where financial_source_id = '$S_SRC2' and workspace_id = '$S_HH2';")"
if [ "$S_PAUSED" = "paused" ] && [ "$S_RESUMED" = "active" ]; then
  pass "Phase S: set_source_space_link_status pauses and resumes a share link"
else
  fail "Phase S: link status transitions wrong (paused=$S_PAUSED resumed=$S_RESUMED)"
fi

# --- reallocate_transaction --------------------------------------------

# A transaction backed by S_SRC2, sitting in S_HH2, moves to USER_A's
# personal workspace (source visible there because USER_A owns it).
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  insert into public.transactions (id, source, financial_source_id, account_id, workspace_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version)
  values ('00000000-0000-0000-0000-0000000000ac', 'manual', '$S_SRC2', '$S_ACCT_HH2', '$S_HH2', 'merchant_payment', 'out', 'success', 9000, 0, now(), 'test');
" >/dev/null
as_user "$USER_A" "select public.reallocate_transaction('00000000-0000-0000-0000-0000000000ac', '$WORKSPACE_A');" >/dev/null
S_MOVED="$(psql -d pfe_rls -t -A -c "select count(*) from public.transactions where id = '00000000-0000-0000-0000-0000000000ac' and workspace_id = '$WORKSPACE_A' and allocation_status = 'allocated' and attribution_type is null;")"
S_MOVE_OUT_AUDIT="$(psql -d pfe_rls -t -A -c "select count(*) from public.space_audit_events where workspace_id = '$S_HH2' and event_type = 'transaction.reallocated_out';")"
if [ "$S_MOVED" = "1" ] && [ "$S_MOVE_OUT_AUDIT" = "1" ]; then
  pass "Phase S: reallocate_transaction moves a transaction to another Space and audits both sides"
else
  fail "Phase S: reallocation wrong (moved=$S_MOVED out_audit=$S_MOVE_OUT_AUDIT)"
fi

# Reallocation refuses a transaction that carries Space-scoped derived data.
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  insert into public.transactions (id, source, financial_source_id, account_id, workspace_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version) values
    ('00000000-0000-0000-0000-0000000000ad', 'manual', '$S_SRC2', '$S_ACCT_HH2', '$S_HH2', 'send_money', 'out', 'success', 5000, 0, now(), 'test'),
    ('00000000-0000-0000-0000-0000000000ae', 'manual', '$S_SRC2', '$S_ACCT_HH2', '$S_HH2', 'money_received', 'in', 'success', 5000, 0, now(), 'test');
  insert into public.transfer_links (workspace_id, out_transaction_id, in_transaction_id, status)
  values ('$S_HH2', '00000000-0000-0000-0000-0000000000ad', '00000000-0000-0000-0000-0000000000ae', 'linked');
" >/dev/null
if as_user "$USER_A" "select public.reallocate_transaction('00000000-0000-0000-0000-0000000000ad', '$WORKSPACE_A');" >/dev/null 2>$ARTIFACT_DIR/pfe_s_realloc.log; then
  fail "Phase S: a transaction with a linked transfer was reallocated"
else
  pass "Phase S: reallocate_transaction refuses a transaction that has a transfer link / split / goal / payment match"
fi
rm -f $ARTIFACT_DIR/pfe_s_realloc.log

# Reallocation into a household refuses a transaction dated before the share began.
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  insert into public.transactions (id, source, financial_source_id, account_id, workspace_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version)
  values ('00000000-0000-0000-0000-0000000000af', 'manual', '$S_SRC2', '$S_ACCT_A', '$WORKSPACE_A', 'merchant_payment', 'out', 'success', 2500, 0, now() - interval '2 days', 'test');
" >/dev/null
if as_user "$USER_A" "select public.reallocate_transaction('00000000-0000-0000-0000-0000000000af', '$S_HH2');" >/dev/null 2>$ARTIFACT_DIR/pfe_s_retro.log; then
  fail "Phase S: a transaction predating the share link was moved into the household"
else
  pass "Phase S: reallocate_transaction enforces the no-retroactive-exposure boundary (effective_from)"
fi
rm -f $ARTIFACT_DIR/pfe_s_retro.log

# --- set_source_visibility narrowing cascades ----------------------

# USER_R can currently see the Q_HH transaction (Q_SRC_A shared into Q_HH).
S_R_BEFORE="$(as_user "$USER_R" "select count(*) from public.transactions where id = '$S_TXN';")"
as_user "$USER_A" "select public.set_source_visibility('$Q_SRC_A', 'personal_only');" >/dev/null
S_R_AFTER="$(as_user "$USER_R" "select count(*) from public.transactions where id = '$S_TXN';")"
S_LINK_REVOKED="$(psql -d pfe_rls -t -A -c "select status from public.source_space_links where financial_source_id = '$Q_SRC_A' and workspace_id = '$Q_HH';")"
S_CEIL2="$(psql -d pfe_rls -t -A -c "select visibility_mode from public.financial_sources where id = '$Q_SRC_A';")"
if [ "$S_R_BEFORE" = "1" ] && [ "$S_R_AFTER" = "0" ] && [ "$S_LINK_REVOKED" = "revoked" ] && [ "$S_CEIL2" = "personal_only" ]; then
  pass "Phase S: set_source_visibility('personal_only') revokes every share link and immediately cuts co-member access"
else
  fail "Phase S: visibility narrowing wrong (before=$S_R_BEFORE after=$S_R_AFTER link=$S_LINK_REVOKED ceiling=$S_CEIL2)"
fi

# --- Phase S PR2b: space_member_directory -----------------------------

# USER_A and USER_R are active members of Q_HH (USER_R was promoted to
# admin in the Phase R block); USER_B was removed.
S_DIR_MEMBER="$(as_user "$USER_A" "select count(*) from public.space_member_directory('$Q_HH');")"
S_DIR_HAS_R="$(as_user "$USER_A" "select count(*) from public.space_member_directory('$Q_HH') where user_id = '$USER_R';")"
S_DIR_NONMEMBER="$(as_user "$USER_B" "select count(*) from public.space_member_directory('$Q_HH');")"
if [ "$S_DIR_MEMBER" -ge "2" ] && [ "$S_DIR_HAS_R" = "1" ] && [ "$S_DIR_NONMEMBER" = "0" ]; then
  pass "Phase S PR2b: space_member_directory lists active co-members to a member, and nothing to a non-member"
else
  fail "Phase S PR2b: space_member_directory wrong (member_sees=$S_DIR_MEMBER has_R=$S_DIR_HAS_R nonmember_sees=$S_DIR_NONMEMBER)"
fi

# ===========================================================================
# Phase S PR2d: an Admin can manage members (workspace_invites RLS +
# set_member_role / remove_member re-issued to has_space_capability), while
# anything touching an Owner stays Owner-only. USER_R is an Admin of Q_HH
# (promoted in the Phase R block); USER_A is the sole Owner.
# ===========================================================================
echo "=== Phase S PR2d: Admin member management ==="

# An Admin can issue an invite (was Owner-only through Phase C).
D_INV="$(as_user "$USER_R" "insert into public.workspace_invites (workspace_id, email, role, token_hash, token_prefix, invited_by) values ('$Q_HH', 'd-invitee@example.com', 'member', 'd-token-hash-1', 'd-pref-1', '$USER_R') returning id;")"
if [ -n "$D_INV" ]; then
  pass "Phase S PR2d: an Admin can create a workspace invite"
else
  fail "Phase S PR2d: an Admin was blocked from creating an invite"
fi

USER_D="$(psql -d pfe_rls -t -A -c "insert into auth.users (email) values ('d-invitee@example.com') returning id;" | head -1)"
as_user "$USER_D" "select public.accept_workspace_invite('d-token-hash-1');" >/dev/null
D_MEMB="$(psql -d pfe_rls -t -A -c "select id from public.workspace_memberships where workspace_id = '$Q_HH' and user_id = '$USER_D' and status = 'active';" | head -1)"

# An Admin can change a non-Owner member's role, and it is audited.
as_user "$USER_R" "select public.set_member_role('$D_MEMB', 'viewer');" >/dev/null
D_ROLE="$(psql -d pfe_rls -t -A -c "select role from public.workspace_memberships where id = '$D_MEMB';")"
D_ROLE_AUDIT="$(psql -d pfe_rls -t -A -c "select count(*) from public.space_audit_events where workspace_id = '$Q_HH' and event_type = 'member.role_changed' and resource_id = '$D_MEMB';")"
if [ "$D_ROLE" = "viewer" ] && [ "$D_ROLE_AUDIT" -ge "1" ]; then
  pass "Phase S PR2d: an Admin can change a non-Owner member's role (audited)"
else
  fail "Phase S PR2d: Admin role change wrong (role=$D_ROLE audit=$D_ROLE_AUDIT)"
fi

# An Admin cannot promote anyone to Owner.
if as_user "$USER_R" "select public.set_member_role('$D_MEMB', 'owner');" >/dev/null 2>$ARTIFACT_DIR/pfe_d_promote.log; then
  fail "Phase S PR2d: an Admin promoted a member to Owner"
else
  pass "Phase S PR2d: an Admin cannot promote a member to Owner"
fi
rm -f $ARTIFACT_DIR/pfe_d_promote.log

# An Admin cannot remove the Owner.
A_MEMB="$(psql -d pfe_rls -t -A -c "select id from public.workspace_memberships where workspace_id = '$Q_HH' and user_id = '$USER_A' and role = 'owner' and status = 'active';" | head -1)"
if as_user "$USER_R" "select public.remove_member('$A_MEMB');" >/dev/null 2>$ARTIFACT_DIR/pfe_d_rmowner.log; then
  fail "Phase S PR2d: an Admin removed the Owner"
else
  pass "Phase S PR2d: an Admin cannot remove an Owner"
fi
rm -f $ARTIFACT_DIR/pfe_d_rmowner.log

# An Admin can remove a plain member.
as_user "$USER_R" "select public.remove_member('$D_MEMB');" >/dev/null
D_STATUS="$(psql -d pfe_rls -t -A -c "select status from public.workspace_memberships where id = '$D_MEMB';")"
if [ "$D_STATUS" = "removed" ]; then
  pass "Phase S PR2d: an Admin can remove a non-Owner member"
else
  fail "Phase S PR2d: Admin removal of a member did not take effect (status=$D_STATUS)"
fi

# A plain member still cannot manage members. Bring one in via USER_D's
# re-invite path is spent; use a fresh invite + user.
as_user "$USER_R" "insert into public.workspace_invites (workspace_id, email, role, token_hash, token_prefix, invited_by) values ('$Q_HH', 'e-invitee@example.com', 'member', 'e-token-hash-1', 'e-pref-1', '$USER_R');" >/dev/null
USER_E="$(psql -d pfe_rls -t -A -c "insert into auth.users (email) values ('e-invitee@example.com') returning id;" | head -1)"
as_user "$USER_E" "select public.accept_workspace_invite('e-token-hash-1');" >/dev/null
if as_user "$USER_E" "insert into public.workspace_invites (workspace_id, email, role, token_hash, token_prefix, invited_by) values ('$Q_HH', 'x@example.com', 'member', 'x-hash', 'x-pref', '$USER_E');" >/dev/null 2>$ARTIFACT_DIR/pfe_e_inv.log; then
  fail "Phase S PR2d: a plain member created an invite"
else
  pass "Phase S PR2d: a plain member still cannot create invites (members.manage required)"
fi
rm -f $ARTIFACT_DIR/pfe_e_inv.log

# The last-owner guard survives the re-issue.
if as_user "$USER_A" "select public.set_member_role('$A_MEMB', 'member');" >/dev/null 2>$ARTIFACT_DIR/pfe_d_lastowner.log; then
  fail "Phase S PR2d: the sole Owner demoted themselves after the re-issue"
else
  pass "Phase S PR2d: set_member_role still refuses to demote the final Owner"
fi
rm -f $ARTIFACT_DIR/pfe_d_lastowner.log

# ===========================================================================
# Phase T PR1: notification-preference resolution. should_notify() +
# notification_event_catalog(). Continues in pfe_rls on Q_HH - USER_E is
# an active member (joined via invite in the PR2d block), USER_B is not.
# ===========================================================================
echo "=== Phase T PR1: notification-preference resolution ==="

# A non-member is never notified.
T_NONMEMBER="$(as_user "$USER_B" "select public.should_notify('$Q_HH', '$USER_B', 'budget.exceeded', 'in_app');")"
# A member with no stored preference gets the event/channel default.
T_DEFAULT_ON="$(as_user "$USER_E" "select public.should_notify('$Q_HH', '$USER_E', 'budget.exceeded', 'in_app');")"
T_DEFAULT_OFF="$(as_user "$USER_E" "select public.should_notify('$Q_HH', '$USER_E', 'report.daily', 'in_app');")"
if [ "$T_NONMEMBER" = "f" ] && [ "$T_DEFAULT_ON" = "t" ] && [ "$T_DEFAULT_OFF" = "f" ]; then
  pass "Phase T PR1: should_notify is false for a non-member, and follows the event/channel default for a member with no stored preference"
else
  fail "Phase T PR1: should_notify defaults wrong (nonmember=$T_NONMEMBER default_on=$T_DEFAULT_ON default_off=$T_DEFAULT_OFF)"
fi

# A stored preference overrides the default.
as_user "$USER_E" "insert into public.space_member_notification_prefs (workspace_id, user_id, event_key, channel, enabled) values ('$Q_HH', '$USER_E', 'budget.exceeded', 'in_app', false);" >/dev/null
T_OVERRIDE="$(as_user "$USER_E" "select public.should_notify('$Q_HH', '$USER_E', 'budget.exceeded', 'in_app');")"
if [ "$T_OVERRIDE" = "f" ]; then
  pass "Phase T PR1: a member's stored preference overrides the default"
else
  fail "Phase T PR1: stored preference not honoured (got $T_OVERRIDE)"
fi

# A security-notable event cannot be suppressed - even with a disabling row.
T_SEC_DEFAULT="$(as_user "$USER_E" "select public.should_notify('$Q_HH', '$USER_E', 'owner.transferred', 'email');")"
as_user "$USER_E" "insert into public.space_member_notification_prefs (workspace_id, user_id, event_key, channel, enabled) values ('$Q_HH', '$USER_E', 'owner.transferred', 'email', false);" >/dev/null
T_SEC_FORCED="$(as_user "$USER_E" "select public.should_notify('$Q_HH', '$USER_E', 'owner.transferred', 'email');")"
if [ "$T_SEC_DEFAULT" = "t" ] && [ "$T_SEC_FORCED" = "t" ]; then
  pass "Phase T PR1: a security-notable event stays on regardless of a disabling preference row"
else
  fail "Phase T PR1: security-notable override wrong (default=$T_SEC_DEFAULT with_disabling_row=$T_SEC_FORCED)"
fi

# The catalog is populated and includes a known event.
T_CATALOG="$(as_user "$USER_E" "select count(*) from public.notification_event_catalog();")"
T_CATALOG_HAS="$(as_user "$USER_E" "select count(*) from public.notification_event_catalog() where event_key = 'budget.exceeded' and security_notable = false;")"
if [ "$T_CATALOG" -ge "8" ] && [ "$T_CATALOG_HAS" = "1" ]; then
  pass "Phase T PR1: notification_event_catalog returns the configurable events"
else
  fail "Phase T PR1: notification_event_catalog wrong (count=$T_CATALOG has_budget_exceeded=$T_CATALOG_HAS)"
fi

# ===========================================================================
# Phase T PR2: budget threshold-crossing state. record_budget_threshold_
# crossing() returns a bucket name only on an upward crossing (one alert
# per crossing, not per transaction). Service-role-only.
# ===========================================================================
echo "=== Phase T PR2: budget threshold-crossing state ==="

T2_BUDGET="$(psql -d pfe_rls -t -A -c "set role service_role; insert into public.budgets (workspace_id, name, currency, period_start, period_end, income_amount_minor, normalized_monthly_income_minor, normalized_annual_income_minor, income_frequency) values ('$Q_HH', 'T2 Threshold Budget', 'RWF', '2026-08-01', '2026-08-31', 100000, 100000, 1200000, 'monthly') returning id;" | grep -Eo '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)"

cross() {
  psql -d pfe_rls -t -A -c "set role service_role; select coalesce(public.record_budget_threshold_crossing('$T2_BUDGET', '__total__', $1), 'NULL');" | tail -1
}

T2_A="$(cross 50)"    # ok -> ok
T2_B="$(cross 80)"    # ok -> watch (upward)
T2_C="$(cross 82)"    # watch -> watch (no re-alert)
T2_D="$(cross 95)"    # watch -> at_risk (upward)
T2_E="$(cross 60)"    # at_risk -> ok (downward, silent)
T2_F="$(cross 92)"    # ok -> at_risk (re-crossing after a drop)
T2_FINAL="$(psql -d pfe_rls -t -A -c "select last_bucket from public.budget_threshold_state where budget_id = '$T2_BUDGET' and scope = '__total__';")"

if [ "$T2_A" = "NULL" ] && [ "$T2_B" = "watch" ] && [ "$T2_C" = "NULL" ] && [ "$T2_D" = "at_risk" ] && [ "$T2_E" = "NULL" ] && [ "$T2_F" = "at_risk" ] && [ "$T2_FINAL" = "at_risk" ]; then
  pass "Phase T PR2: record_budget_threshold_crossing alerts once per upward crossing, stays quiet within a bucket, and re-alerts after a drop"
else
  fail "Phase T PR2: crossing sequence wrong (50=$T2_A 80=$T2_B 82=$T2_C 95=$T2_D 60=$T2_E 92=$T2_F final=$T2_FINAL)"
fi

# Not authenticated-callable.
if as_user "$USER_A" "select public.record_budget_threshold_crossing('$T2_BUDGET', '__total__', 100);" >/dev/null 2>$ARTIFACT_DIR/pfe_t2.log; then
  fail "Phase T PR2: record_budget_threshold_crossing was callable by an authenticated user"
else
  pass "Phase T PR2: record_budget_threshold_crossing is service-role-only"
fi
rm -f $ARTIFACT_DIR/pfe_t2.log

# ===========================================================================
# Phase T PR3: shared goals. financial_goals writes move to goal.manage
# (an Admin can now manage goals); any member can contribute;
# goal_participants + goal_progress. Continues in pfe_rls on Q_HH -
# USER_A owner, USER_R admin, USER_E member, USER_B non-member.
# ===========================================================================
echo "=== Phase T PR3: shared goals ==="

# An Admin can create a household goal (was Owner-only through Phase D).
T3_GOAL="$(as_user "$USER_R" "insert into public.financial_goals (workspace_id, goal_type, name, currency, target_amount_minor, target_date) values ('$Q_HH', 'general_savings', 'T3 Emergency Fund', 'RWF', 1000000, (current_date + 60)) returning id;")"
if [ -n "$T3_GOAL" ]; then
  pass "Phase T PR3: an Admin can create a goal in a household (goal.manage, not Owner-only)"
else
  fail "Phase T PR3: an Admin was blocked from creating a goal"
fi

# A plain member cannot create a goal.
if as_user "$USER_E" "insert into public.financial_goals (workspace_id, goal_type, name, currency, target_amount_minor) values ('$Q_HH', 'general_savings', 'Nope', 'RWF', 500000);" >/dev/null 2>$ARTIFACT_DIR/pfe_t3_goal.log; then
  fail "Phase T PR3: a plain member created a goal"
else
  pass "Phase T PR3: a plain member cannot create a goal"
fi
rm -f $ARTIFACT_DIR/pfe_t3_goal.log

# A plain member CAN contribute to a goal.
as_user "$USER_E" "insert into public.goal_contributions (goal_id, workspace_id, amount_minor, source) values ('$T3_GOAL', '$Q_HH', 200000, 'manual');" >/dev/null
T3_CURRENT="$(psql -d pfe_rls -t -A -c "select current_amount_minor from public.financial_goals where id = '$T3_GOAL';")"
if [ "$T3_CURRENT" = "200000" ]; then
  pass "Phase T PR3: any member can record a goal contribution"
else
  fail "Phase T PR3: member contribution not reflected (current=$T3_CURRENT)"
fi

# set_goal_participants: Admin sets the participant list; audited.
as_user "$USER_R" "select public.set_goal_participants('$T3_GOAL', array['$USER_A', '$USER_E']::uuid[]);" >/dev/null
T3_PART_COUNT="$(psql -d pfe_rls -t -A -c "select count(*) from public.goal_participants where goal_id = '$T3_GOAL';")"
T3_PART_AUDIT="$(psql -d pfe_rls -t -A -c "select count(*) from public.space_audit_events where workspace_id = '$Q_HH' and event_type = 'goal.participants_changed' and resource_id = '$T3_GOAL';")"
if [ "$T3_PART_COUNT" = "2" ] && [ "$T3_PART_AUDIT" -ge "1" ]; then
  pass "Phase T PR3: set_goal_participants replaces the participant set and writes an audit event"
else
  fail "Phase T PR3: participant set wrong (count=$T3_PART_COUNT audit=$T3_PART_AUDIT)"
fi

# A non-member cannot be named a participant.
if as_user "$USER_R" "select public.set_goal_participants('$T3_GOAL', array['$USER_A', '$USER_B']::uuid[]);" >/dev/null 2>$ARTIFACT_DIR/pfe_t3_part.log; then
  fail "Phase T PR3: a non-member was added as a goal participant"
else
  pass "Phase T PR3: set_goal_participants rejects a non-member"
fi
rm -f $ARTIFACT_DIR/pfe_t3_part.log

# A plain member cannot set participants.
if as_user "$USER_E" "select public.set_goal_participants('$T3_GOAL', array['$USER_E']::uuid[]);" >/dev/null 2>$ARTIFACT_DIR/pfe_t3_part2.log; then
  fail "Phase T PR3: a plain member set goal participants"
else
  pass "Phase T PR3: set_goal_participants refuses a caller without goal.manage"
fi
rm -f $ARTIFACT_DIR/pfe_t3_part2.log

# goal_progress: a member reads the computed metrics; a non-member gets nothing.
T3_PROG="$(as_user "$USER_E" "select current_minor || '/' || pct_complete from public.goal_progress('$T3_GOAL');")"
T3_PROG_NONMEMBER="$(as_user "$USER_B" "select count(*) from public.goal_progress('$T3_GOAL');")"
if [ "$T3_PROG" = "200000/20.0" ] && [ "$T3_PROG_NONMEMBER" = "0" ]; then
  pass "Phase T PR3: goal_progress returns the computed metrics to a member and nothing to a non-member"
else
  fail "Phase T PR3: goal_progress wrong (member='$T3_PROG' nonmember_rows=$T3_PROG_NONMEMBER)"
fi

# ===========================================================================
# Phase T PR4: Space category vocabulary. workspace_categories writes go
# through upsert_workspace_category / set_workspace_category_archived
# (category.manage-gated, audited); direct authenticated writes are gone.
# Q_HH: USER_A owner, USER_R admin, USER_E member.
# ===========================================================================
echo "=== Phase T PR4: Space category vocabulary ==="

# An Admin can add a Space category via the RPC; it's audited.
as_user "$USER_R" "select public.upsert_workspace_category('$Q_HH', 'weekend_food', 'Weekend food', null);" >/dev/null
T4_ADDED="$(psql -d pfe_rls -t -A -c "select count(*) from public.workspace_categories where workspace_id = '$Q_HH' and key = 'weekend_food' and label = 'Weekend food' and not is_archived;")"
T4_AUDIT="$(psql -d pfe_rls -t -A -c "select count(*) from public.space_audit_events where workspace_id = '$Q_HH' and event_type = 'category.upserted';")"
if [ "$T4_ADDED" = "1" ] && [ "$T4_AUDIT" -ge "1" ]; then
  pass "Phase T PR4: upsert_workspace_category adds a category and writes an audit event"
else
  fail "Phase T PR4: category upsert wrong (added=$T4_ADDED audit=$T4_AUDIT)"
fi

# A plain member cannot.
if as_user "$USER_E" "select public.upsert_workspace_category('$Q_HH', 'nope', 'Nope', null);" >/dev/null 2>$ARTIFACT_DIR/pfe_t4_m.log; then
  fail "Phase T PR4: a plain member added a Space category"
else
  pass "Phase T PR4: upsert_workspace_category refuses a caller without category.manage"
fi
rm -f $ARTIFACT_DIR/pfe_t4_m.log

# A malformed key is rejected.
if as_user "$USER_R" "select public.upsert_workspace_category('$Q_HH', 'Bad Key!', 'Bad', null);" >/dev/null 2>$ARTIFACT_DIR/pfe_t4_k.log; then
  fail "Phase T PR4: a malformed category key was accepted"
else
  pass "Phase T PR4: upsert_workspace_category validates the key format"
fi
rm -f $ARTIFACT_DIR/pfe_t4_k.log

# Direct authenticated writes to workspace_categories are gone (RPC-only).
if as_user "$USER_R" "insert into public.workspace_categories (workspace_id, key, label) values ('$Q_HH', 'direct', 'Direct');" >/dev/null 2>$ARTIFACT_DIR/pfe_t4_d.log; then
  fail "Phase T PR4: an Admin wrote workspace_categories directly (should be RPC-only now)"
else
  pass "Phase T PR4: direct authenticated writes to workspace_categories are revoked"
fi
rm -f $ARTIFACT_DIR/pfe_t4_d.log

# Archive then restore; re-upserting an archived key un-archives it.
as_user "$USER_R" "select public.set_workspace_category_archived('$Q_HH', 'weekend_food', true);" >/dev/null
T4_ARCHIVED="$(psql -d pfe_rls -t -A -c "select is_archived from public.workspace_categories where workspace_id = '$Q_HH' and key = 'weekend_food';")"
as_user "$USER_R" "select public.upsert_workspace_category('$Q_HH', 'weekend_food', 'Weekend food', null);" >/dev/null
T4_UNARCHIVED="$(psql -d pfe_rls -t -A -c "select is_archived from public.workspace_categories where workspace_id = '$Q_HH' and key = 'weekend_food';")"
if [ "$T4_ARCHIVED" = "t" ] && [ "$T4_UNARCHIVED" = "f" ]; then
  pass "Phase T PR4: a category can be archived, and re-upserting its key restores it"
else
  fail "Phase T PR4: archive/restore wrong (archived=$T4_ARCHIVED after_reupsert=$T4_UNARCHIVED)"
fi

# A member can still read the Space's category list.
T4_MEMBER_SEES="$(as_user "$USER_E" "select count(*) from public.workspace_categories where workspace_id = '$Q_HH';")"
if [ "$T4_MEMBER_SEES" -ge "1" ]; then
  pass "Phase T PR4: any member can read the Space's category vocabulary"
else
  fail "Phase T PR4: a member could not read workspace_categories (got $T4_MEMBER_SEES)"
fi

# ===========================================================================
# Phase U PR1: ingestion routing + duplicate-detection primitives.
# compute_transaction_fingerprint / resolve_ingestion_target (ingestion-
# only) and transaction_duplicate_candidates / merge_duplicate_transaction
# (review UI). Continues in pfe_rls - USER_A owns WORKSPACE_A (personal);
# Q_HH is the Phase Q household; USER_B is not a member of either.
# ===========================================================================
echo "=== Phase U PR1: ingestion + dedup primitives ==="

# --- compute_transaction_fingerprint: deterministic --------------------

U_FP1="$(psql -d pfe_rls -t -A -c "set role service_role; select public.compute_transaction_fingerprint('mtn_momo', '250-788-***-482', 15000, 'rwf', 'OUT', '  Simba  Supermarket ', '2026-08-27T18:42:11Z'::timestamptz);")"
U_FP2="$(psql -d pfe_rls -t -A -c "set role service_role; select public.compute_transaction_fingerprint('mtn_momo', '250788482', 15000, 'RWF', 'out', 'Simba Supermarket', '2026-08-27T18:42:49Z'::timestamptz);")"
U_FP3="$(psql -d pfe_rls -t -A -c "set role service_role; select public.compute_transaction_fingerprint('mtn_momo', '250788482', 16000, 'RWF', 'out', 'Simba Supermarket', '2026-08-27T18:42:11Z'::timestamptz);")"
if [ -n "$U_FP1" ] && [ "$U_FP1" = "$U_FP2" ] && [ "$U_FP1" != "$U_FP3" ]; then
  pass "Phase U PR1: compute_transaction_fingerprint normalises punctuation/case/whitespace and rounds to the minute, but a different amount changes it"
else
  fail "Phase U PR1: fingerprint wrong (fp1='$U_FP1' fp2='$U_FP2' fp3='$U_FP3')"
fi

# --- resolve_ingestion_target ----------------------------------------

U_SRC="$(psql -d pfe_rls -t -A -c "set role service_role; insert into public.financial_sources (owner_user_id, provider, source_type, display_name, currency) values ('$USER_A', 'mtn_momo', 'mobile_money', 'Alice MoMo (U)', 'RWF') returning id;" | grep -Eo '[0-9a-f-]{36}' | head -1)"
U_ACCT="$(psql -d pfe_rls -t -A -c "set role service_role; insert into public.accounts (workspace_id, name, provider, currency, financial_source_id) values ('$WORKSPACE_A', 'Alice MoMo acct (U)', 'mtn_momo', 'RWF', '$U_SRC') returning id;" | grep -Eo '[0-9a-f-]{36}' | head -1)"
U_CONN="$(psql -d pfe_rls -t -A -c "set role service_role; insert into public.ingestion_connections (workspace_id, account_id, label, credential_hash, credential_prefix, created_by) values ('$WORKSPACE_A', '$U_ACCT', 'Alice phone (U)', 'u-cred-hash-1', 'pfe_uuuu', '$USER_A') returning id;" | grep -Eo '[0-9a-f-]{36}' | head -1)"

U_TGT_DEFAULT="$(psql -d pfe_rls -t -A -c "set role service_role; select workspace_id || ',' || financial_source_id from public.resolve_ingestion_target('$U_CONN', now());" | tail -1)"
# Now point the source's default target at the household, with a window
# that opened a day ago.
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; insert into public.source_space_links (financial_source_id, workspace_id, visibility_mode, is_default_target, status, effective_from) values ('$U_SRC', '$Q_HH', 'share_transactions', true, 'active', now() - interval '1 day');" >/dev/null
U_TGT_LINK="$(psql -d pfe_rls -t -A -c "set role service_role; select workspace_id || ',' || financial_source_id from public.resolve_ingestion_target('$U_CONN', now());" | tail -1)"
U_TGT_RETRO="$(psql -d pfe_rls -t -A -c "set role service_role; select workspace_id || ',' || financial_source_id from public.resolve_ingestion_target('$U_CONN', now() - interval '2 days');" | tail -1)"

if [ "$U_TGT_DEFAULT" = "$WORKSPACE_A,$U_SRC" ] && [ "$U_TGT_LINK" = "$Q_HH,$U_SRC" ] && [ "$U_TGT_RETRO" = "$WORKSPACE_A,$U_SRC" ]; then
  pass "Phase U PR1: resolve_ingestion_target routes to the connection's workspace by default, to an opened is_default_target link otherwise, and never before the link's effective_from"
else
  fail "Phase U PR1: routing wrong (default=$U_TGT_DEFAULT link=$U_TGT_LINK retro=$U_TGT_RETRO)"
fi

# --- duplicate candidates + merge ----------------------------------

psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  insert into public.transactions (id, source, financial_source_id, account_id, workspace_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version, dedupe_fingerprint) values
    ('00000000-0000-0000-0000-0000000000c7', 'manual', '$U_SRC', '$U_ACCT', '$WORKSPACE_A', 'merchant_payment', 'out', 'success', 15000, 0, now(), 'test', 'u-fp-dup-1'),
    ('00000000-0000-0000-0000-0000000000c8', 'manual', '$U_SRC', '$U_ACCT', '$WORKSPACE_A', 'merchant_payment', 'out', 'success', 15000, 0, now(), 'test', 'u-fp-dup-1');
" >/dev/null

U_CAND_BEFORE="$(as_user "$USER_A" "select count(*) from public.transaction_duplicate_candidates('u-fp-dup-1', '00000000-0000-0000-0000-0000000000c7');")"
as_user "$USER_A" "select public.merge_duplicate_transaction('00000000-0000-0000-0000-0000000000c8', '00000000-0000-0000-0000-0000000000c7');" >/dev/null
U_MERGED="$(psql -d pfe_rls -t -A -c "select count(*) from public.transactions where id = '00000000-0000-0000-0000-0000000000c8' and dedupe_state = 'merged' and merged_into_transaction_id = '00000000-0000-0000-0000-0000000000c7';")"
U_MERGE_AUDIT="$(psql -d pfe_rls -t -A -c "select count(*) from public.space_audit_events where workspace_id = '$WORKSPACE_A' and event_type = 'transaction.duplicate_merged' and resource_id = '00000000-0000-0000-0000-0000000000c8';")"
U_CAND_AFTER="$(as_user "$USER_A" "select count(*) from public.transaction_duplicate_candidates('u-fp-dup-1', '00000000-0000-0000-0000-0000000000c7');")"

if [ "$U_CAND_BEFORE" = "1" ] && [ "$U_MERGED" = "1" ] && [ "$U_MERGE_AUDIT" = "1" ] && [ "$U_CAND_AFTER" = "0" ]; then
  pass "Phase U PR1: a duplicate is found, merged (row kept, state='merged', audited), then no longer a candidate"
else
  fail "Phase U PR1: dedup flow wrong (before=$U_CAND_BEFORE merged=$U_MERGED audit=$U_MERGE_AUDIT after=$U_CAND_AFTER)"
fi

# The merged row still exists (evidence preserved).
U_ROW_KEPT="$(psql -d pfe_rls -t -A -c "select count(*) from public.transactions where id = '00000000-0000-0000-0000-0000000000c8';")"
if [ "$U_ROW_KEPT" = "1" ]; then
  pass "Phase U PR1: merge_duplicate_transaction never deletes the duplicate row"
else
  fail "Phase U PR1: the merged duplicate row was removed"
fi

# A non-member cannot merge.
if as_user "$USER_B" "select public.merge_duplicate_transaction('00000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-0000000000c8');" >/dev/null 2>$ARTIFACT_DIR/pfe_u_merge.log; then
  fail "Phase U PR1: a non-member merged transactions"
else
  pass "Phase U PR1: merge_duplicate_transaction refuses a caller without transaction.categorize"
fi
rm -f $ARTIFACT_DIR/pfe_u_merge.log

# ===========================================================================
# Phase U PR3: space_duplicate_review (the review feed) +
# dismiss_possible_duplicate ("not a duplicate"). Still in pfe_rls -
# USER_A owns WORKSPACE_A, USER_B is not a member. Seeds a fresh cluster
# (fp 'u-fp-pr3'): fa already in the ledger (unique), fb just ingested and
# flagged (possible_duplicate), fc a second flagged row for the permission
# check.
# ===========================================================================
echo "=== Phase U PR3: duplicate review + dismiss ==="

psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  insert into public.transactions (id, source, financial_source_id, account_id, workspace_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version, dedupe_fingerprint, dedupe_state) values
    ('00000000-0000-0000-0000-0000000000fa', 'manual', '$U_SRC', '$U_ACCT', '$WORKSPACE_A', 'merchant_payment', 'out', 'success', 8000, 0, now() - interval '3 minutes', 'test', 'u-fp-pr3', 'unique'),
    ('00000000-0000-0000-0000-0000000000fb', 'manual', '$U_SRC', '$U_ACCT', '$WORKSPACE_A', 'merchant_payment', 'out', 'success', 8000, 0, now(), 'test', 'u-fp-pr3', 'possible_duplicate'),
    ('00000000-0000-0000-0000-0000000000fc', 'manual', '$U_SRC', '$U_ACCT', '$WORKSPACE_A', 'merchant_payment', 'out', 'success', 8000, 0, now(), 'test', 'u-fp-pr3', 'possible_duplicate');
" >/dev/null

# The feed returns the whole cluster (all 3 non-merged rows sharing the
# flagged fingerprint), and nothing from clusters with no possible_duplicate
# (the PR1 'u-fp-dup-1' cluster: one unique + one merged).
U_PR3_ROWS="$(as_user "$USER_A" "select count(*) from public.space_duplicate_review('$WORKSPACE_A');")"
U_PR3_CLUSTER="$(as_user "$USER_A" "select count(*) from public.space_duplicate_review('$WORKSPACE_A') where fingerprint = 'u-fp-pr3';")"
U_PR3_MERGED_HIDDEN="$(as_user "$USER_A" "select count(*) from public.space_duplicate_review('$WORKSPACE_A') where transaction_id = '00000000-0000-0000-0000-0000000000c8';")"
if [ "$U_PR3_ROWS" = "3" ] && [ "$U_PR3_CLUSTER" = "3" ] && [ "$U_PR3_MERGED_HIDDEN" = "0" ]; then
  pass "Phase U PR3: space_duplicate_review returns the full flagged cluster, excludes merged rows, and skips clusters with no possible_duplicate"
else
  fail "Phase U PR3: review feed wrong (rows=$U_PR3_ROWS cluster=$U_PR3_CLUSTER merged_hidden=$U_PR3_MERGED_HIDDEN)"
fi

# A non-member sees nothing.
U_PR3_NONMEMBER="$(as_user "$USER_B" "select count(*) from public.space_duplicate_review('$WORKSPACE_A');")"
if [ "$U_PR3_NONMEMBER" = "0" ]; then
  pass "Phase U PR3: space_duplicate_review returns nothing to a non-member"
else
  fail "Phase U PR3: a non-member saw $U_PR3_NONMEMBER review row(s)"
fi

# Dismiss fb: possible_duplicate -> unique, audited. The cluster stays
# visible in full (fa + fb + fc = 3) because fc is still flagged - a
# reviewer working a cluster keeps seeing every member, including one just
# marked "not a duplicate".
as_user "$USER_A" "select public.dismiss_possible_duplicate('00000000-0000-0000-0000-0000000000fb');" >/dev/null
U_PR3_FB_STATE="$(psql -d pfe_rls -t -A -c "select dedupe_state from public.transactions where id = '00000000-0000-0000-0000-0000000000fb';")"
U_PR3_DISMISS_AUDIT="$(psql -d pfe_rls -t -A -c "select count(*) from public.space_audit_events where workspace_id = '$WORKSPACE_A' and event_type = 'transaction.duplicate_dismissed' and resource_id = '00000000-0000-0000-0000-0000000000fb';")"
U_PR3_ROWS_AFTER="$(as_user "$USER_A" "select count(*) from public.space_duplicate_review('$WORKSPACE_A');")"
if [ "$U_PR3_FB_STATE" = "unique" ] && [ "$U_PR3_DISMISS_AUDIT" = "1" ] && [ "$U_PR3_ROWS_AFTER" = "3" ]; then
  pass "Phase U PR3: dismiss_possible_duplicate moves the row to unique, audits it, and the still-flagged cluster stays visible in full"
else
  fail "Phase U PR3: dismiss wrong (fb_state=$U_PR3_FB_STATE audit=$U_PR3_DISMISS_AUDIT rows_after=$U_PR3_ROWS_AFTER)"
fi

# Dismissing a row that is not possible_duplicate is refused (fa is unique).
if as_user "$USER_A" "select public.dismiss_possible_duplicate('00000000-0000-0000-0000-0000000000fa');" >/dev/null 2>$ARTIFACT_DIR/pfe_u_pr3.log; then
  fail "Phase U PR3: dismiss_possible_duplicate accepted a non-possible_duplicate row"
else
  pass "Phase U PR3: dismiss_possible_duplicate refuses any row not in possible_duplicate state"
fi

# A non-member cannot dismiss the still-flagged fc.
if as_user "$USER_B" "select public.dismiss_possible_duplicate('00000000-0000-0000-0000-0000000000fc');" >/dev/null 2>$ARTIFACT_DIR/pfe_u_pr3.log; then
  fail "Phase U PR3: a non-member dismissed a possible duplicate"
else
  pass "Phase U PR3: dismiss_possible_duplicate refuses a caller without transaction.categorize"
fi

# With fc dismissed too, the cluster has no possible_duplicate left and
# disappears from the feed entirely.
as_user "$USER_A" "select public.dismiss_possible_duplicate('00000000-0000-0000-0000-0000000000fc');" >/dev/null
U_PR3_ROWS_CLEARED="$(as_user "$USER_A" "select count(*) from public.space_duplicate_review('$WORKSPACE_A') where fingerprint = 'u-fp-pr3';")"
if [ "$U_PR3_ROWS_CLEARED" = "0" ]; then
  pass "Phase U PR3: once no row in a cluster is possible_duplicate, the cluster leaves the review feed"
else
  fail "Phase U PR3: cluster still surfaced $U_PR3_ROWS_CLEARED row(s) after all its members were dismissed"
fi
rm -f $ARTIFACT_DIR/pfe_u_pr3.log

# ===========================================================================
# Phase U PR4: ingestion-connection lifecycle - the reversible 'paused'
# state. Reuses U_CONN (WORKSPACE_A, owned by USER_A, still active from the
# PR1 block).
# ===========================================================================
echo "=== Phase U PR4: connection pause / resume ==="

# Owner pauses their own connection.
as_user "$USER_A" "update public.ingestion_connections set status = 'paused', paused_at = now() where id = '$U_CONN';" >/dev/null
U_PR4_PAUSED="$(psql -d pfe_rls -t -A -c "select count(*) from public.ingestion_connections where id = '$U_CONN' and status = 'paused' and paused_at is not null and revoked_at is null;")"
if [ "$U_PR4_PAUSED" = "1" ]; then
  pass "Phase U PR4: workspace owner can pause their own ingestion connection (reversible, credential preserved)"
else
  fail "Phase U PR4: pausing a connection did not take (got $U_PR4_PAUSED)"
fi

# The status/timestamp consistency constraint rejects an inconsistent pause
# (status paused, no paused_at) and an inconsistent active (paused_at set).
if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; update public.ingestion_connections set status = 'paused', paused_at = null where id = '$U_CONN';" >/dev/null 2>$ARTIFACT_DIR/pfe_u_pr4.log; then
  fail "Phase U PR4: a paused connection with no paused_at was accepted"
else
  pass "Phase U PR4: the consistency constraint rejects status='paused' without paused_at"
fi

if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; update public.ingestion_connections set status = 'active', paused_at = now() where id = '$U_CONN';" >/dev/null 2>$ARTIFACT_DIR/pfe_u_pr4.log; then
  fail "Phase U PR4: an active connection carrying a paused_at was accepted"
else
  pass "Phase U PR4: the consistency constraint rejects status='active' with a lingering paused_at"
fi

# Owner resumes: paused -> active, paused_at cleared.
as_user "$USER_A" "update public.ingestion_connections set status = 'active', paused_at = null where id = '$U_CONN';" >/dev/null
U_PR4_RESUMED="$(psql -d pfe_rls -t -A -c "select count(*) from public.ingestion_connections where id = '$U_CONN' and status = 'active' and paused_at is null and revoked_at is null;")"
if [ "$U_PR4_RESUMED" = "1" ]; then
  pass "Phase U PR4: workspace owner can resume a paused connection back to active"
else
  fail "Phase U PR4: resuming a paused connection did not take (got $U_PR4_RESUMED)"
fi
rm -f $ARTIFACT_DIR/pfe_u_pr4.log

# ===========================================================================
# Phase U PR6: categorization-policy scope. A 'source'-scoped policy only
# matches transactions from its scope_source_id; 'space' (default) matches
# workspace-wide. Verified through preview_policy_historical_match_count(),
# which runs the re-issued policy_matches_transaction(). Reuses pfe_rls
# (USER_A / WORKSPACE_A / U_SRC / U_ACCT).
# ===========================================================================
echo "=== Phase U PR6: categorization-policy scope ==="

U_SRC2="$(psql -d pfe_rls -t -A -c "set role service_role; insert into public.financial_sources (owner_user_id, provider, source_type, display_name, currency) values ('$USER_A', 'airtel_money', 'mobile_money', 'Alice Airtel (U6)', 'RWF') returning id;" | grep -Eo '[0-9a-f-]{36}' | head -1)"
U6_ACCT2="$(psql -d pfe_rls -t -A -c "set role service_role; insert into public.accounts (workspace_id, name, provider, currency, financial_source_id) values ('$WORKSPACE_A', 'Alice second acct (U6)', 'mtn_momo', 'RWF', '$U_SRC2') returning id;" | grep -Eo '[0-9a-f-]{36}' | head -1)"

# One uncategorized transaction on each source, same distinctive counterparty.
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  insert into public.transactions (id, source, financial_source_id, account_id, workspace_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version, counterparty_name) values
    ('00000000-0000-0000-0000-00000000006a', 'manual', '$U_SRC',  '$U_ACCT',   '$WORKSPACE_A', 'merchant_payment', 'out', 'success', 4000, 0, now(), 'test', 'SCOPE-TEST-CP'),
    ('00000000-0000-0000-0000-00000000006b', 'manual', '$U_SRC2', '$U6_ACCT2', '$WORKSPACE_A', 'merchant_payment', 'out', 'success', 4000, 0, now(), 'test', 'SCOPE-TEST-CP');
" >/dev/null

U6_SPACE_POLICY="$(psql -d pfe_rls -t -A -c "
  insert into public.categorization_policies (workspace_id, category, merchant_pattern, match_type, confidence, priority)
  values ('$WORKSPACE_A', 'Scoped test - space', 'scope-test-cp', 'exact', 1.0, 100)
  returning id;" | head -1)"
U6_SOURCE_POLICY="$(psql -d pfe_rls -t -A -c "
  insert into public.categorization_policies (workspace_id, category, merchant_pattern, match_type, confidence, priority, scope_type, scope_source_id)
  values ('$WORKSPACE_A', 'Scoped test - source', 'scope-test-cp', 'exact', 1.0, 100, 'source', '$U_SRC')
  returning id;" | head -1)"

U6_SPACE_MATCHES="$(as_user "$USER_A" "select public.preview_policy_historical_match_count('$U6_SPACE_POLICY');")"
U6_SOURCE_MATCHES="$(as_user "$USER_A" "select public.preview_policy_historical_match_count('$U6_SOURCE_POLICY');")"
if [ "$U6_SPACE_MATCHES" = "2" ] && [ "$U6_SOURCE_MATCHES" = "1" ]; then
  pass "Phase U PR6: policy_matches_transaction honours scope - a space policy matches both sources' transactions, a source-scoped policy only its own"
else
  fail "Phase U PR6: scope match wrong (space=$U6_SPACE_MATCHES expected 2, source=$U6_SOURCE_MATCHES expected 1)"
fi

# The consistency CHECK rejects an inconsistent scope.
if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "insert into public.categorization_policies (workspace_id, category, scope_type) values ('$WORKSPACE_A', 'Bad scope', 'source');" >/dev/null 2>$ARTIFACT_DIR/pfe_u_pr6.log; then
  fail "Phase U PR6: a source-scoped policy with no scope_source_id was accepted"
else
  pass "Phase U PR6: the scope-consistency CHECK rejects scope_type='source' without a scope_source_id"
fi

# And rejects the reverse (a space policy carrying a stray scope_source_id).
if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "insert into public.categorization_policies (workspace_id, category, scope_type, scope_source_id) values ('$WORKSPACE_A', 'Bad scope 2', 'space', '$U_SRC');" >/dev/null 2>$ARTIFACT_DIR/pfe_u_pr6.log; then
  fail "Phase U PR6: a space-scoped policy carrying a scope_source_id was accepted"
else
  pass "Phase U PR6: the scope-consistency CHECK rejects scope_type='space' with a scope_source_id"
fi
rm -f $ARTIFACT_DIR/pfe_u_pr6.log

# ===========================================================================
# Phase U PR7: generic-CSV statement import (import_statement_transactions).
# Reuses pfe_rls: USER_A owns U_SRC (mtn_momo, masked_identifier NULL) ->
# U_ACCT -> WORKSPACE_A; USER_B is not the owner.
# ===========================================================================
echo "=== Phase U PR7: statement import ==="

# An existing ledger transaction whose fingerprint one statement line will
# collide with. Fingerprint computed exactly as the RPC will (provider
# 'mtn_momo', empty masked id, RWF, minute-rounded).
STMT_FP="$(psql -d pfe_rls -t -A -c "set role service_role; select public.compute_transaction_fingerprint('mtn_momo', '', 7500, 'RWF', 'out', 'STMT MATCH CP', '2026-08-20T14:30:00Z'::timestamptz);" | tail -1)"
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  insert into public.transactions (id, source, financial_source_id, account_id, workspace_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version, counterparty_name, dedupe_fingerprint)
  values ('00000000-0000-0000-0000-000000000770', 'manual', '$U_SRC', '$U_ACCT', '$WORKSPACE_A', 'merchant_payment', 'out', 'success', 7500, 0, '2026-08-20T14:30:00Z', 'test', 'STMT MATCH CP', '$STMT_FP');
" >/dev/null

STMT_JSON='[{"occurred_at":"2026-08-20T14:30:00Z","amount_minor":7500,"direction":"out","counterparty":"STMT MATCH CP"},{"occurred_at":"2026-08-21T09:00:00Z","amount_minor":3200,"direction":"in","counterparty":"STMT NEW CP","external_ref":"REF-NEW-1"},{"occurred_at":"2026-08-22T00:00:00Z","amount_minor":-50,"direction":"out","counterparty":"BAD ROW"}]'

STMT_SQL_1=$(cat <<SQL
with r as (select public.import_statement_transactions('$U_SRC', '$STMT_JSON'::jsonb) as j)
select (j->>'created')||','||(j->>'flagged_possible_duplicate')||','||(j->>'skipped') from r;
SQL
)
STMT_RESULT_1="$(as_user "$USER_A" "$STMT_SQL_1")"
STMT_ROWS="$(psql -d pfe_rls -t -A -c "select count(*) from public.transactions where financial_source_id = '$U_SRC' and source = 'statement';")"
STMT_DUP="$(psql -d pfe_rls -t -A -c "select count(*) from public.transactions where financial_source_id = '$U_SRC' and source = 'statement' and dedupe_state = 'possible_duplicate';")"
STMT_EVENTS="$(psql -d pfe_rls -t -A -c "select count(*) from public.raw_financial_events e join public.transactions t on t.id = e.canonical_transaction_id where e.channel = 'statement' and t.financial_source_id = '$U_SRC';")"
STMT_AUDIT="$(psql -d pfe_rls -t -A -c "select count(*) from public.space_audit_events where workspace_id = '$WORKSPACE_A' and event_type = 'statement.imported' and resource_id = '$U_SRC';")"
if [ "$STMT_RESULT_1" = "2,1,1" ] && [ "$STMT_ROWS" = "2" ] && [ "$STMT_DUP" = "1" ] && [ "$STMT_EVENTS" = "2" ] && [ "$STMT_AUDIT" = "1" ]; then
  pass "Phase U PR7: import creates a transaction + linked statement evidence per valid line, flags the fingerprint match as possible_duplicate, skips the invalid line, and audits the import"
else
  fail "Phase U PR7: import wrong (result=$STMT_RESULT_1 rows=$STMT_ROWS dup=$STMT_DUP events=$STMT_EVENTS audit=$STMT_AUDIT; expected 2,1,1 / 2 / 1 / 2 / 1)"
fi

# The accounting-effect constraints accepted the statement rows.
STMT_SETTLED="$(psql -d pfe_rls -t -A -c "select count(*) from public.transactions where financial_source_id = '$U_SRC' and source = 'statement' and settlement_state = 'settled' and affects_balance and effect_reason = 'statement_import';")"
if [ "$STMT_SETTLED" = "2" ]; then
  pass "Phase U PR7: imported rows carry a valid settled accounting effect (passes transactions_new_accounting_fields_all_or_nothing + net-effect match)"
else
  fail "Phase U PR7: only $STMT_SETTLED/2 imported rows have a complete settled accounting effect"
fi

# Re-importing the same file is a no-op (payload_hash de-dupe).
STMT_SQL_2=$(cat <<SQL
with r as (select public.import_statement_transactions('$U_SRC', '$STMT_JSON'::jsonb) as j)
select j->>'created' from r;
SQL
)
STMT_RESULT_2="$(as_user "$USER_A" "$STMT_SQL_2")"
if [ "$STMT_RESULT_2" = "0" ]; then
  pass "Phase U PR7: re-importing the same statement file creates nothing"
else
  fail "Phase U PR7: a re-import created $STMT_RESULT_2 transaction(s) - payload_hash de-dupe failed"
fi

# A non-owner cannot import into someone else's source.
if as_user "$USER_B" "select public.import_statement_transactions('$U_SRC', '[]'::jsonb);" >/dev/null 2>$ARTIFACT_DIR/pfe_u_pr7.log; then
  fail "Phase U PR7: a non-owner imported a statement into another user's source"
else
  pass "Phase U PR7: import_statement_transactions refuses a caller who does not own the source"
fi
rm -f $ARTIFACT_DIR/pfe_u_pr7.log

# ===========================================================================
# Phase V PR1: notification delivery spine (notifications table +
# enqueue_notification + mark-read RPCs, wired into accept_workspace_invite
# and remove_member). Fresh household V_HH so there is no prior noise.
# ===========================================================================
echo "=== Phase V PR1: notification delivery ==="

V_HH="$(as_user "$USER_A" "select public.create_household_workspace('Phase V Household');")"
V_USER="$(psql -d pfe_rls -t -A -c "insert into auth.users (email) values ('v-invitee@example.com') returning id;" | head -1)"

# USER_R accepts an invite into V_HH -> member.joined fires for the
# members who are NOT the joiner (just USER_A). member.joined is
# security-notable so both channels always deliver: 1 in_app + 1 email.
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; insert into public.workspace_invites (workspace_id, email, role, token_hash, token_prefix, invited_by) values ('$V_HH', 'r-invitee@example.com', 'member', 'v-token-1', 'v-pref-1', '$USER_A');" >/dev/null
as_user "$USER_R" "select public.accept_workspace_invite('v-token-1');" >/dev/null

V_A_INAPP="$(psql -d pfe_rls -t -A -c "select count(*) from public.notifications where workspace_id = '$V_HH' and user_id = '$USER_A' and event_key = 'member.joined' and channel = 'in_app';")"
V_A_EMAIL="$(psql -d pfe_rls -t -A -c "select count(*) from public.notifications where workspace_id = '$V_HH' and user_id = '$USER_A' and event_key = 'member.joined' and channel = 'email' and delivered_at is null;")"
V_R_SELF="$(psql -d pfe_rls -t -A -c "select count(*) from public.notifications where workspace_id = '$V_HH' and user_id = '$USER_R' and event_key = 'member.joined';")"
if [ "$V_A_INAPP" = "1" ] && [ "$V_A_EMAIL" = "1" ] && [ "$V_R_SELF" = "0" ]; then
  pass "Phase V PR1: accept_workspace_invite enqueues member.joined to the other members (in_app + pending email), never to the joiner"
else
  fail "Phase V PR1: join fan-out wrong (A in_app=$V_A_INAPP A email=$V_A_EMAIL R self=$V_R_SELF)"
fi

# unread_notification_count + mark_notification_read are own-scoped.
V_A_UNREAD_BEFORE="$(as_user "$USER_A" "select public.unread_notification_count();")"
V_NOTIF_ID="$(psql -d pfe_rls -t -A -c "select id from public.notifications where workspace_id = '$V_HH' and user_id = '$USER_A' and channel = 'in_app' limit 1;" | head -1)"
# USER_R calling mark_notification_read on USER_A's row is a silent no-op.
as_user "$USER_R" "select public.mark_notification_read('$V_NOTIF_ID');" >/dev/null
V_STILL_UNREAD="$(psql -d pfe_rls -t -A -c "select read_at is null from public.notifications where id = '$V_NOTIF_ID';" | head -1)"
# USER_A marking their own row does clear it.
as_user "$USER_A" "select public.mark_notification_read('$V_NOTIF_ID');" >/dev/null
V_NOW_READ="$(psql -d pfe_rls -t -A -c "select read_at is not null from public.notifications where id = '$V_NOTIF_ID';" | head -1)"
V_A_UNREAD_AFTER="$(as_user "$USER_A" "select public.unread_notification_count();")"
if [ "$V_STILL_UNREAD" = "t" ] && [ "$V_NOW_READ" = "t" ] && [ "$V_A_UNREAD_AFTER" = "$((V_A_UNREAD_BEFORE - 1))" ]; then
  pass "Phase V PR1: mark_notification_read only clears the caller's own row; unread_notification_count reflects it"
else
  fail "Phase V PR1: mark-read scoping wrong (still_unread_after_R=$V_STILL_UNREAD now_read=$V_NOW_READ unread $V_A_UNREAD_BEFORE -> $V_A_UNREAD_AFTER)"
fi

# remove_member fans member.removed out to the remaining members (not the
# removed user). USER_V joins then USER_A removes them.
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; insert into public.workspace_invites (workspace_id, email, role, token_hash, token_prefix, invited_by) values ('$V_HH', 'v-invitee@example.com', 'member', 'v-token-2', 'v-pref-2', '$USER_A');" >/dev/null
as_user "$V_USER" "select public.accept_workspace_invite('v-token-2');" >/dev/null
V_MEMB="$(psql -d pfe_rls -t -A -c "select id from public.workspace_memberships where workspace_id = '$V_HH' and user_id = '$V_USER' and status = 'active';" | head -1)"
as_user "$USER_A" "select public.remove_member('$V_MEMB');" >/dev/null

V_REMOVED_TO_R="$(psql -d pfe_rls -t -A -c "select count(*) from public.notifications where workspace_id = '$V_HH' and user_id = '$USER_R' and event_key = 'member.removed' and channel = 'in_app' and (metadata->>'self') is null;")"
# Phase W PR2: the removed member now also gets a "You were removed" one,
# flagged metadata.self = true.
V_REMOVED_TO_SELF="$(psql -d pfe_rls -t -A -c "select count(*) from public.notifications where workspace_id = '$V_HH' and user_id = '$V_USER' and event_key = 'member.removed' and channel = 'in_app' and (metadata->>'self') = 'true';")"
if [ "$V_REMOVED_TO_R" = "1" ] && [ "$V_REMOVED_TO_SELF" = "1" ]; then
  pass "Phase V PR1 / W PR2: remove_member notifies the remaining members and (self-flagged) the removed member"
else
  fail "Phase V PR1 / W PR2: removal fan-out wrong (to R=$V_REMOVED_TO_R self=$V_REMOVED_TO_SELF)"
fi

# mark_all_notifications_read clears the caller's unread in_app for a Space.
V_R_CLEARED="$(as_user "$USER_R" "select public.mark_all_notifications_read('$V_HH');")"
V_R_UNREAD="$(psql -d pfe_rls -t -A -c "select count(*) from public.notifications where workspace_id = '$V_HH' and user_id = '$USER_R' and channel = 'in_app' and read_at is null;")"
if [ "$V_R_CLEARED" -ge 1 ] && [ "$V_R_UNREAD" = "0" ]; then
  pass "Phase V PR1: mark_all_notifications_read clears every unread in_app row for the caller in that Space"
else
  fail "Phase V PR1: mark_all wrong (cleared=$V_R_CLEARED remaining unread=$V_R_UNREAD)"
fi

# enqueue_notification is internal - not authenticated-callable.
if as_user "$USER_A" "select public.enqueue_notification('$V_HH', null, null, 'member.joined', 'x', null, null, null, '{}'::jsonb);" >/dev/null 2>$ARTIFACT_DIR/pfe_v_pr1.log; then
  fail "Phase V PR1: enqueue_notification was callable by an authenticated user"
else
  pass "Phase V PR1: enqueue_notification is not authenticated-callable (internal producer helper)"
fi
rm -f $ARTIFACT_DIR/pfe_v_pr1.log

# ===========================================================================
# Phase V PR2: budget threshold sweep (sweep_budget_thresholds ->
# record_budget_threshold_crossing -> enqueue_notification). Fresh active
# budget in WORKSPACE_A (personal; USER_A is its sole member, so
# should_notify approves budget.threshold_90 in_app by default).
# ===========================================================================
echo "=== Phase V PR2: budget threshold sweep ==="

# Retire any earlier active RWF budget (Phase D / T PR2 fixtures) so this
# one can be the workspace's single active RWF budget.
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; update public.budgets set status = 'archived' where workspace_id = '$WORKSPACE_A' and currency = 'RWF' and status = 'active';" >/dev/null
V2_BUDGET="$(psql -d pfe_rls -t -A -c "set role service_role; insert into public.budgets (workspace_id, name, currency, period_start, period_end, income_amount_minor, normalized_monthly_income_minor, normalized_annual_income_minor, income_frequency, income_mode, status) values ('$WORKSPACE_A', 'V2 Budget', 'RWF', current_date - 5, current_date + 25, 100000, 100000, 1200000, 'monthly', 'fixed', 'draft') returning id;" | grep -Eo '[0-9a-f-]{36}' | head -1)"
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; insert into public.budget_allocations (budget_id, workspace_id, allocation_type, percentage, target_amount_minor) values ('$V2_BUDGET', '$WORKSPACE_A', 'ESSENTIALS', 100.00, 100000);" >/dev/null
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; update public.budgets set status = 'active', activated_at = now() where id = '$V2_BUDGET';" >/dev/null

# ~92% of the budget's income (100000) in settled outflow this period.
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  insert into public.transactions (id, source, account_id, workspace_id, transaction_type, direction, status, currency, amount_rwf, fee_rwf, occurred_at, parser_version, principal_effect_rwf, fee_effect_rwf, settlement_state, affects_balance, effect_reason)
  values ('00000000-0000-0000-0000-0000000000e6', 'manual', '$U_ACCT', '$WORKSPACE_A', 'merchant_payment', 'out', 'success', 'RWF', 92000, 0, now(), 'test', -92000, 0, 'settled', true, 'test');
" >/dev/null

V2_SWEEP_1="$(as_user "$USER_A" "select public.sweep_budget_thresholds('$WORKSPACE_A');")"
V2_AT_RISK_NOTIF="$(psql -d pfe_rls -t -A -c "select count(*) from public.notifications where workspace_id = '$WORKSPACE_A' and user_id = '$USER_A' and event_key = 'budget.threshold_90' and channel = 'in_app' and resource_id = '$V2_BUDGET';")"
V2_SWEEP_2="$(as_user "$USER_A" "select public.sweep_budget_thresholds('$WORKSPACE_A');")"
if [ "$V2_SWEEP_1" = "1" ] && [ "$V2_AT_RISK_NOTIF" = "1" ] && [ "$V2_SWEEP_2" = "0" ]; then
  pass "Phase V PR2: a budget crossing 90% enqueues one budget.threshold_90 notification; a second sweep with no new crossing enqueues nothing"
else
  fail "Phase V PR2: sweep wrong (sweep1=$V2_SWEEP_1 notif=$V2_AT_RISK_NOTIF sweep2=$V2_SWEEP_2)"
fi

# Push the same budget over 100% -> a fresh upward crossing -> budget.exceeded.
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  insert into public.transactions (id, source, account_id, workspace_id, transaction_type, direction, status, currency, amount_rwf, fee_rwf, occurred_at, parser_version, principal_effect_rwf, fee_effect_rwf, settlement_state, affects_balance, effect_reason)
  values ('00000000-0000-0000-0000-0000000000e7', 'manual', '$U_ACCT', '$WORKSPACE_A', 'merchant_payment', 'out', 'success', 'RWF', 15000, 0, now(), 'test', -15000, 0, 'settled', true, 'test');
" >/dev/null
V2_SWEEP_3="$(as_user "$USER_A" "select public.sweep_budget_thresholds('$WORKSPACE_A');")"
V2_EXCEEDED_NOTIF="$(psql -d pfe_rls -t -A -c "select count(*) from public.notifications where workspace_id = '$WORKSPACE_A' and user_id = '$USER_A' and event_key = 'budget.exceeded' and resource_id = '$V2_BUDGET';")"
if [ "$V2_SWEEP_3" = "1" ] && [ "$V2_EXCEEDED_NOTIF" -ge 1 ]; then
  pass "Phase V PR2: pushing the same budget past 100% is a fresh upward crossing and enqueues budget.exceeded"
else
  fail "Phase V PR2: over-100% crossing wrong (sweep3=$V2_SWEEP_3 exceeded_notif=$V2_EXCEEDED_NOTIF)"
fi

# A non-member cannot sweep another Space's budgets.
if as_user "$USER_B" "select public.sweep_budget_thresholds('$WORKSPACE_A');" >/dev/null 2>$ARTIFACT_DIR/pfe_v_pr2.log; then
  fail "Phase V PR2: a non-member ran sweep_budget_thresholds for another Space"
else
  pass "Phase V PR2: sweep_budget_thresholds refuses a non-member of the Space"
fi
rm -f $ARTIFACT_DIR/pfe_v_pr2.log

# ===========================================================================
# Phase V PR3 + Phase 0 hardening: atomically claim and ack the outbox.
# The V PR1 member.joined fan-out already left email rows pending.
# ===========================================================================
echo "=== Phase V PR3: email outbox ==="

V3_CLAIM_A="00000000-0000-4000-8000-0000000000a1"
V3_CLAIM_B="00000000-0000-4000-8000-0000000000b2"
V3_PENDING="$(psql -d pfe_rls -t -A -c "set role service_role; select count(*) from public.claim_notification_emails('$V3_CLAIM_A', 100, 300);" | tail -1)"
V3_HAS_EMAIL="$(psql -d pfe_rls -t -A -c "set role service_role; select count(*) from public.claim_notification_emails('$V3_CLAIM_A', 100, 300) where email is null or email = '';" | tail -1)"
V3_SECOND_CLAIM="$(psql -d pfe_rls -t -A -c "set role service_role; select count(*) from public.claim_notification_emails('$V3_CLAIM_B', 100, 300);" | tail -1)"
V3_IDS="$(psql -d pfe_rls -t -A -c "select string_agg(id::text, ',') from public.notifications where delivery_claim_token = '$V3_CLAIM_A';" | tail -1)"
V3_WRONG_ACK="$(psql -d pfe_rls -t -A -c "set role service_role; select public.ack_notification_email_claim('$V3_CLAIM_B', string_to_array('$V3_IDS', ',')::uuid[]);" | tail -1)"
V3_MARKED="$(psql -d pfe_rls -t -A -c "set role service_role; select public.ack_notification_email_claim('$V3_CLAIM_A', string_to_array('$V3_IDS', ',')::uuid[]);" | tail -1)"
V3_PENDING_AFTER="$(psql -d pfe_rls -t -A -c "set role service_role; select count(*) from public.claim_notification_emails('$V3_CLAIM_B', 100, 300);" | tail -1)"
if [ "$V3_PENDING" -ge 1 ] && [ "$V3_HAS_EMAIL" = "0" ] && [ "$V3_SECOND_CLAIM" = "0" ] && [ "$V3_WRONG_ACK" = "0" ] && [ "$V3_MARKED" = "$V3_PENDING" ] && [ "$V3_PENDING_AFTER" = "0" ]; then
  pass "Phase 0: outbox claims are exclusive, token-bound, recipient-complete, and drain after ack"
else
  fail "Phase 0: outbox claim wrong (pending=$V3_PENDING no_email=$V3_HAS_EMAIL second=$V3_SECOND_CLAIM wrong_ack=$V3_WRONG_ACK marked=$V3_MARKED after=$V3_PENDING_AFTER)"
fi

# Both RPCs are service-role-only.
if as_user "$USER_A" "select public.claim_notification_emails('$V3_CLAIM_A', 10, 300);" >/dev/null 2>$ARTIFACT_DIR/pfe_v_pr3.log; then
  fail "Phase 0: claim_notification_emails was callable by an authenticated user"
else
  pass "Phase 0: notification claim / ack / release RPCs are service-role-only"
fi
rm -f $ARTIFACT_DIR/pfe_v_pr3.log

# ===========================================================================
# Phase 0: exact-ingestion dedupe is scoped to its owning tenant/connection.
# ===========================================================================
echo "=== Phase 0: tenant-scoped ingestion dedupe ==="

P0_CONN_A="00000000-0000-4000-8000-0000000000c1"
P0_CONN_B="00000000-0000-4000-8000-0000000000c2"
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  insert into public.ingestion_connections
    (id, workspace_id, account_id, label, credential_hash, credential_prefix)
  values
    ('$P0_CONN_A', '$WORKSPACE_A', '00000000-0000-0000-0000-0000000000d1', 'P0 A', 'p0-hash-a', 'pfe_p0a'),
    ('$P0_CONN_B', '$WORKSPACE_B', '00000000-0000-0000-0000-0000000000c1', 'P0 B', 'p0-hash-b', 'pfe_p0b');

  insert into public.momo_messages
    (ingestion_connection_id, raw_message, message_fingerprint, processing_status)
  values
    ('$P0_CONN_A', 'identical provider text', 'same-message-hash', 'processed'),
    ('$P0_CONN_B', 'identical provider text', 'same-message-hash', 'processed');

  insert into public.raw_financial_events
    (ingestion_connection_id, channel, received_at, payload_hash, raw_payload)
  values
    ('$P0_CONN_A', 'sms', now(), 'same-payload-hash', '{}'),
    ('$P0_CONN_B', 'sms', now(), 'same-payload-hash', '{}');

  insert into public.transactions
    (workspace_id, account_id, source, external_transaction_id,
     transaction_type, direction, status, amount_rwf, fee_rwf,
     occurred_at, parser_version)
  values
    ('$WORKSPACE_A', '00000000-0000-0000-0000-0000000000d1', 'manual', 'provider-ref-same',
     'other', 'neutral', 'success', 1, 0, now(), 'p0-test'),
    ('$WORKSPACE_B', '00000000-0000-0000-0000-0000000000c1', 'manual', 'provider-ref-same',
     'other', 'neutral', 'success', 1, 0, now(), 'p0-test');
" >/dev/null

P0_MESSAGE_ROWS="$(psql -d pfe_rls -t -A -c "select count(*) from public.momo_messages where message_fingerprint = 'same-message-hash';")"
P0_EVENT_ROWS="$(psql -d pfe_rls -t -A -c "select count(*) from public.raw_financial_events where payload_hash = 'same-payload-hash';")"
P0_TX_ROWS="$(psql -d pfe_rls -t -A -c "select count(*) from public.transactions where external_transaction_id = 'provider-ref-same';")"
if [ "$P0_MESSAGE_ROWS" = "2" ] && [ "$P0_EVENT_ROWS" = "2" ] && [ "$P0_TX_ROWS" = "2" ]; then
  pass "Phase 0: identical SMS, raw payloads, and provider references coexist across two workspaces"
else
  fail "Phase 0: cross-tenant evidence was collapsed (messages=$P0_MESSAGE_ROWS events=$P0_EVENT_ROWS transactions=$P0_TX_ROWS)"
fi

if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "insert into public.momo_messages (ingestion_connection_id, raw_message, message_fingerprint) values ('$P0_CONN_A', 'retry', 'same-message-hash');" >/dev/null 2>$ARTIFACT_DIR/pfe_p0_dedupe.log; then
  fail "Phase 0: the same connection accepted a duplicate message fingerprint"
else
  pass "Phase 0: the same connection still rejects an exact SMS retry"
fi
if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "insert into public.raw_financial_events (ingestion_connection_id, channel, received_at, payload_hash, raw_payload) values ('$P0_CONN_A', 'sms', now(), 'same-payload-hash', '{}');" >/dev/null 2>>$ARTIFACT_DIR/pfe_p0_dedupe.log; then
  fail "Phase 0: the same connection accepted a duplicate raw payload hash"
else
  pass "Phase 0: the same connection still rejects an exact raw-event retry"
fi
if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "insert into public.transactions (workspace_id, account_id, source, external_transaction_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version) values ('$WORKSPACE_A', '00000000-0000-0000-0000-0000000000d1', 'manual', 'provider-ref-same', 'other', 'neutral', 'success', 1, 0, now(), 'p0-test');" >/dev/null 2>>$ARTIFACT_DIR/pfe_p0_dedupe.log; then
  fail "Phase 0: the same workspace accepted a duplicate provider reference"
else
  pass "Phase 0: the same workspace still rejects a duplicate provider reference"
fi
rm -f $ARTIFACT_DIR/pfe_p0_dedupe.log

# Explicit trusted-service RPC boundary. These functions handle unscoped
# delivery, ingestion, threshold, or report data and must never be callable
# from a browser JWT.
P0_SERVICE_RPC_AUTH_GRANTS="$(psql -d pfe_rls -t -A -c "
  with f(signature) as (values
    ('public.claim_notification_emails(uuid,integer,integer)'),
    ('public.ack_notification_email_claim(uuid,uuid[])'),
    ('public.release_notification_email_claim(uuid,uuid[],text)'),
    ('public.resolve_ingestion_target(uuid,timestamp with time zone)'),
    ('public.record_budget_threshold_crossing(uuid,text,numeric)'),
    ('public.visible_source_ids_for_user(uuid,uuid)')
  )
  select count(*) from f
  where has_function_privilege('authenticated', to_regprocedure(signature), 'EXECUTE')
     or has_function_privilege('anon', to_regprocedure(signature), 'EXECUTE');")"
P0_SERVICE_RPC_SERVICE_GRANTS="$(psql -d pfe_rls -t -A -c "
  with f(signature) as (values
    ('public.claim_notification_emails(uuid,integer,integer)'),
    ('public.ack_notification_email_claim(uuid,uuid[])'),
    ('public.release_notification_email_claim(uuid,uuid[],text)'),
    ('public.resolve_ingestion_target(uuid,timestamp with time zone)'),
    ('public.record_budget_threshold_crossing(uuid,text,numeric)'),
    ('public.visible_source_ids_for_user(uuid,uuid)')
  )
  select count(*) from f
  where has_function_privilege('service_role', to_regprocedure(signature), 'EXECUTE');")"
if [ "$P0_SERVICE_RPC_AUTH_GRANTS" = "0" ] && [ "$P0_SERVICE_RPC_SERVICE_GRANTS" = "6" ]; then
  pass "Phase 0: all six trusted-service RPCs deny browser roles and allow service_role"
else
  fail "Phase 0: trusted-service RPC ACL drift (browser_grants=$P0_SERVICE_RPC_AUTH_GRANTS service_grants=$P0_SERVICE_RPC_SERVICE_GRANTS)"
fi

# ===========================================================================
# Connector model Stage A: additive installation/device credential schema.
# Existing ingestion_connections remains live and no existing row is backfilled.
# ===========================================================================
echo "=== Connector model Stage A ==="

CMA_UNMAPPED_LEGACY="$(psql -d pfe_rls -t -A -c "select count(*) from public.ingestion_connections where id in ('$P0_CONN_A', '$P0_CONN_B') and connector_installation_id is null and device_credential_id is null;")"
CMA_UNMAPPED_EVENTS="$(psql -d pfe_rls -t -A -c "select count(*) from public.raw_financial_events where ingestion_connection_id in ('$P0_CONN_A', '$P0_CONN_B') and connector_installation_id is null and device_credential_id is null;")"
if [ "$CMA_UNMAPPED_LEGACY" = "2" ] && [ "$CMA_UNMAPPED_EVENTS" = "2" ]; then
  pass "Connector Stage A: nullable canonical fields do not implicitly rewrite legacy connections or raw provenance"
else
  fail "Connector Stage A: legacy-only writes unexpectedly gained canonical mappings (connections=$CMA_UNMAPPED_LEGACY events=$CMA_UNMAPPED_EVENTS)"
fi

CMA_INSTALL_A="00000000-0000-4000-8000-0000000000e1"
CMA_INSTALL_B="00000000-0000-4000-8000-0000000000e2"
CMA_SOURCE_A="00000000-0000-4000-8000-0000000000e3"
CMA_SOURCE_B="00000000-0000-4000-8000-0000000000e4"
CMA_ACCOUNT_A="00000000-0000-4000-8000-0000000000e5"
CMA_ACCOUNT_B="00000000-0000-4000-8000-0000000000e6"
CMA_CRED_A="00000000-0000-4000-8000-0000000000e7"

psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  insert into public.connector_installations
    (id, owner_user_id, home_workspace_id, connector_key, display_name, status, auth_mode)
  values
    ('$CMA_INSTALL_A', '$USER_A', '$WORKSPACE_A', 'mtn_momo_sms_v1', 'A phone', 'healthy', 'device_secret'),
    ('$CMA_INSTALL_B', '$USER_B', '$WORKSPACE_B', 'bank_open_api_v1', 'B bank', 'healthy', 'oauth');

  insert into public.financial_sources
    (id, owner_user_id, connector_installation_id, provider, provider_key,
     source_type, display_name, currency, external_source_ref_hash)
  values
    ('$CMA_SOURCE_A', '$USER_A', '$CMA_INSTALL_A', 'mtn_momo', 'mtn_rw',
     'mobile_money', 'A canonical source', 'RWF', 'source-ref-a'),
    ('$CMA_SOURCE_B', '$USER_B', '$CMA_INSTALL_B', 'bank', 'bank_rw',
     'bank_account', 'B canonical source', 'RWF', 'source-ref-b');

  insert into public.accounts
    (id, workspace_id, financial_source_id, name, provider, currency)
  values
    ('$CMA_ACCOUNT_A', '$WORKSPACE_A', '$CMA_SOURCE_A', 'A canonical account', 'mtn_momo', 'RWF'),
    ('$CMA_ACCOUNT_B', '$WORKSPACE_B', '$CMA_SOURCE_B', 'B canonical account', 'bank', 'RWF');

  insert into public.device_credentials
    (id, connector_installation_id, account_id, label, credential_hash, credential_prefix)
  values
    ('$CMA_CRED_A', '$CMA_INSTALL_A', '$CMA_ACCOUNT_A', 'A device', 'cma-credential-hash-a', 'cma_a');

  insert into public.raw_financial_events
    (financial_source_id, connector_installation_id, device_credential_id,
     channel, received_at, payload_hash, raw_payload)
  values
    ('$CMA_SOURCE_A', '$CMA_INSTALL_A', '$CMA_CRED_A',
     'sms', now(), 'cma-raw-hash-a', '{\"stage\":\"a\"}');
" >/dev/null

CMA_PROVENANCE="$(psql -d pfe_rls -t -A -c "select count(*) from public.raw_financial_events where financial_source_id = '$CMA_SOURCE_A' and connector_installation_id = '$CMA_INSTALL_A' and device_credential_id = '$CMA_CRED_A';")"
if [ "$CMA_PROVENANCE" = "1" ]; then
  pass "Connector Stage A: raw evidence accepts nullable canonical installation and credential provenance"
else
  fail "Connector Stage A: canonical raw-event provenance was not retained"
fi

if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; insert into public.raw_financial_events (financial_source_id, connector_installation_id, device_credential_id, channel, received_at, payload_hash, raw_payload) values ('$CMA_SOURCE_B', '$CMA_INSTALL_B', '$CMA_CRED_A', 'sms', now(), 'cma-mixed-provenance', '{}');" >/dev/null 2>$ARTIFACT_DIR/pfe_cma_provenance.log; then
  fail "Connector Stage A: raw evidence accepted mismatched installation/source/credential provenance"
else
  pass "Connector Stage A: composite FKs reject mixed canonical provenance"
fi
rm -f $ARTIFACT_DIR/pfe_cma_provenance.log

if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; insert into public.device_credentials (connector_installation_id, account_id, label, credential_hash, credential_prefix) values ('$CMA_INSTALL_A', '$CMA_ACCOUNT_B', 'cross tenant', 'cma-cross-hash', 'cma_x');" >/dev/null 2>$ARTIFACT_DIR/pfe_cma_scope.log; then
  fail "Connector Stage A: a credential was scoped to another installation's account"
else
  pass "Connector Stage A: database trigger rejects cross-installation account scope"
fi

if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; insert into public.financial_sources (owner_user_id, connector_installation_id, provider, source_type, display_name, currency) values ('$USER_B', '$CMA_INSTALL_A', 'other', 'import', 'wrong owner', 'RWF');" >/dev/null 2>>$ARTIFACT_DIR/pfe_cma_scope.log; then
  fail "Connector Stage A: another user's source attached to an installation"
else
  pass "Connector Stage A: composite FK enforces installation/source ownership"
fi
rm -f $ARTIFACT_DIR/pfe_cma_scope.log

CMA_A_SEES="$(as_user "$USER_A" "select count(*) from public.device_credentials where id = '$CMA_CRED_A' and credential_prefix = 'cma_a';")"
CMA_B_SEES="$(as_user "$USER_B" "select count(*) from public.device_credentials where id = '$CMA_CRED_A';")"
if [ "$CMA_A_SEES" = "1" ] && [ "$CMA_B_SEES" = "0" ]; then
  pass "Connector Stage A: owners see credential metadata and cross-tenant users see no credential rows"
else
  fail "Connector Stage A: credential metadata RLS wrong (owner=$CMA_A_SEES other=$CMA_B_SEES)"
fi

if as_user "$USER_A" "select credential_hash from public.device_credentials where id = '$CMA_CRED_A';" >/dev/null 2>$ARTIFACT_DIR/pfe_cma_secret.log; then
  fail "Connector Stage A: authenticated owner could read a credential hash"
else
  pass "Connector Stage A: credential hashes remain service-role-only"
fi
if as_user "$USER_A" "select sync_cursor_encrypted from public.connector_installations where id = '$CMA_INSTALL_A';" >/dev/null 2>>$ARTIFACT_DIR/pfe_cma_secret.log; then
  fail "Connector Stage A: authenticated owner could read encrypted connector state"
else
  pass "Connector Stage A: encrypted connector state remains service-role-only"
fi
rm -f $ARTIFACT_DIR/pfe_cma_secret.log

# ===========================================================================
# Connector model Stage B: deterministic legacy preflight and backfill.
# ===========================================================================
echo "=== Connector model Stage B ==="

CMB_SOURCE="00000000-0000-4000-8000-0000000000f1"
CMB_ACCOUNT="00000000-0000-4000-8000-0000000000f2"
CMB_LEGACY="00000000-0000-4000-8000-0000000000f3"
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  insert into public.financial_sources
    (id, owner_user_id, provider, source_type, display_name, currency)
  values ('$CMB_SOURCE', '$USER_A', 'mtn_momo', 'mobile_money', 'B legacy source', 'RWF');
  insert into public.accounts
    (id, workspace_id, financial_source_id, name, provider, currency)
  values ('$CMB_ACCOUNT', '$WORKSPACE_A', '$CMB_SOURCE', 'B legacy account', 'mtn_momo', 'RWF');
  insert into public.ingestion_connections
    (id, workspace_id, account_id, label, provider, credential_hash,
     credential_prefix, created_by, last_used_at)
  values ('$CMB_LEGACY', '$WORKSPACE_A', '$CMB_ACCOUNT', 'B legacy phone',
     'mtn_momo', 'cmb-legacy-hash', 'cmb_pref', '$USER_A', now() - interval '1 hour');
" >/dev/null

CMB_PREFLIGHT="$(psql -d pfe_rls -t -A -c "set role service_role; select count(*) from public.connector_stage_b_preflight('$CMB_LEGACY');" | tail -1)"
CMB_MAPPING="$(psql -d pfe_rls -t -A -c "set role service_role; select connector_installation_id || '|' || device_credential_id from public.backfill_legacy_ingestion_connection('$CMB_LEGACY');" | tail -1)"
CMB_INSTALL="${CMB_MAPPING%%|*}"
CMB_CREDENTIAL="${CMB_MAPPING##*|}"
CMB_SHAPE="$(psql -d pfe_rls -t -A -c "select count(*) from public.ingestion_connections ic join public.connector_installations ci on ci.id = ic.connector_installation_id join public.device_credentials dc on dc.id = ic.device_credential_id join public.financial_sources fs on fs.connector_installation_id = ci.id where ic.id = '$CMB_LEGACY' and ci.legacy_ingestion_connection_id = ic.id and dc.legacy_ingestion_connection_id = ic.id and dc.connector_installation_id = ci.id and dc.account_id = ic.account_id and dc.credential_hash = ic.credential_hash and ci.owner_user_id = '$USER_A' and ci.home_workspace_id = '$WORKSPACE_A' and ci.connector_key = 'mtn_momo_sms_v1' and ci.status = 'healthy' and dc.status = 'active' and fs.id = '$CMB_SOURCE';")"
if [ "$CMB_PREFLIGHT" = "0" ] && [ "$CMB_SHAPE" = "1" ] && [ -n "$CMB_INSTALL" ] && [ -n "$CMB_CREDENTIAL" ]; then
  pass "Connector Stage B: one valid legacy row maps to one installation, credential, source, account, and reversible legacy IDs"
else
  fail "Connector Stage B: deterministic backfill shape wrong (preflight=$CMB_PREFLIGHT shape=$CMB_SHAPE mapping=$CMB_MAPPING)"
fi

CMB_MAPPING_AGAIN="$(psql -d pfe_rls -t -A -c "set role service_role; select connector_installation_id || '|' || device_credential_id from public.backfill_legacy_ingestion_connection('$CMB_LEGACY');" | tail -1)"
CMB_COUNTS="$(psql -d pfe_rls -t -A -c "select (select count(*) from public.connector_installations where legacy_ingestion_connection_id = '$CMB_LEGACY') || '|' || (select count(*) from public.device_credentials where legacy_ingestion_connection_id = '$CMB_LEGACY');")"
if [ "$CMB_MAPPING_AGAIN" = "$CMB_MAPPING" ] && [ "$CMB_COUNTS" = "1|1" ]; then
  pass "Connector Stage B: targeted backfill is idempotent"
else
  fail "Connector Stage B: retry changed or duplicated the mapping (first=$CMB_MAPPING second=$CMB_MAPPING_AGAIN counts=$CMB_COUNTS)"
fi

CMB_AMBIG_SOURCE="00000000-0000-4000-8000-0000000000f4"
CMB_AMBIG_ACCOUNT="00000000-0000-4000-8000-0000000000f5"
CMB_AMBIG_ONE="00000000-0000-4000-8000-0000000000f6"
CMB_AMBIG_TWO="00000000-0000-4000-8000-0000000000f7"
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  insert into public.financial_sources
    (id, owner_user_id, provider, source_type, display_name, currency)
  values ('$CMB_AMBIG_SOURCE', '$USER_A', 'mtn_momo', 'mobile_money', 'B ambiguous source', 'RWF');
  insert into public.accounts
    (id, workspace_id, financial_source_id, name, provider, currency)
  values ('$CMB_AMBIG_ACCOUNT', '$WORKSPACE_A', '$CMB_AMBIG_SOURCE', 'B ambiguous account', 'mtn_momo', 'RWF');
  insert into public.ingestion_connections
    (id, workspace_id, account_id, label, provider, credential_hash, credential_prefix)
  values
    ('$CMB_AMBIG_ONE', '$WORKSPACE_A', '$CMB_AMBIG_ACCOUNT', 'device one', 'mtn_momo', 'cmb-ambig-hash-1', 'cmb_a1'),
    ('$CMB_AMBIG_TWO', '$WORKSPACE_A', '$CMB_AMBIG_ACCOUNT', 'device two', 'mtn_momo', 'cmb-ambig-hash-2', 'cmb_a2');
" >/dev/null
CMB_AMBIG_ISSUES="$(psql -d pfe_rls -t -A -c "set role service_role; select count(*) from public.connector_stage_b_preflight('$CMB_AMBIG_ONE') where issue_code = 'shared_source_ambiguous';" | tail -1)"
if [ "$CMB_AMBIG_ISSUES" = "1" ]; then
  pass "Connector Stage B: preflight flags multiple legacy connections sharing one source instead of guessing"
else
  fail "Connector Stage B: shared-source ambiguity was not reported"
fi

if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; select public.backfill_legacy_ingestion_connection('$CMB_AMBIG_ONE');" >/dev/null 2>$ARTIFACT_DIR/pfe_cmb_ambiguous.log; then
  fail "Connector Stage B: ambiguous legacy mapping was backfilled"
else
  pass "Connector Stage B: backfill aborts when preflight returns an ambiguity"
fi
rm -f $ARTIFACT_DIR/pfe_cmb_ambiguous.log

if as_user "$USER_A" "select public.connector_stage_b_preflight('$CMB_LEGACY');" >/dev/null 2>$ARTIFACT_DIR/pfe_cmb_acl.log; then
  fail "Connector Stage B: authenticated user called the service-only preflight"
else
  pass "Connector Stage B: preflight and backfill helpers are service-role-only"
fi
rm -f $ARTIFACT_DIR/pfe_cmb_acl.log

# ===========================================================================
# Connector model Stage C: atomic enrollment, lifecycle mirroring, and shadow
# route rejection. Legacy lookup remains live; direct browser inserts retire.
# ===========================================================================
echo "=== Connector model Stage C ==="

CMC_SOURCE="00000000-0000-4000-8000-000000000101"
CMC_ACCOUNT="00000000-0000-4000-8000-000000000102"
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  insert into public.financial_sources
    (id, owner_user_id, provider, source_type, display_name, currency)
  values ('$CMC_SOURCE', '$USER_A', 'mtn_momo', 'mobile_money', 'C dual source', 'RWF');
  insert into public.accounts
    (id, workspace_id, financial_source_id, name, provider, currency)
  values ('$CMC_ACCOUNT', '$WORKSPACE_A', '$CMC_SOURCE', 'C dual account', 'mtn_momo', 'RWF');
" >/dev/null

CMC_CONNECTION="$(as_user "$USER_A" "select public.create_ingestion_connection_dual_write('$WORKSPACE_A', '$CMC_ACCOUNT', 'C phone', 'mtn_momo', 'cmc-hash-1', 'cmc_pref');")"
CMC_ATOMIC="$(psql -d pfe_rls -t -A -c "select count(*) from public.ingestion_connections ic join public.connector_installations ci on ci.id = ic.connector_installation_id join public.device_credentials dc on dc.id = ic.device_credential_id where ic.id = '$CMC_CONNECTION' and ci.legacy_ingestion_connection_id = ic.id and dc.legacy_ingestion_connection_id = ic.id and dc.credential_hash = ic.credential_hash;")"
if [ "$CMC_ATOMIC" = "1" ]; then
  pass "Connector Stage C: authenticated enrollment atomically writes legacy and canonical models"
else
  fail "Connector Stage C: atomic enrollment mapping missing"
fi

CMC_LEGACY_ACCOUNT="00000000-0000-4000-8000-000000000103"
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  insert into public.accounts
    (id, workspace_id, name, provider, currency)
  values ('$CMC_LEGACY_ACCOUNT', '$WORKSPACE_A', 'C source-less account', 'bank', 'RWF');
" >/dev/null
CMC_LEGACY_CONNECTION="$(as_user "$USER_A" "select public.create_ingestion_connection_dual_write('$WORKSPACE_A', '$CMC_LEGACY_ACCOUNT', 'C legacy bank', 'bank', 'cmc-hash-legacy', 'cmc_old');")"
CMC_LEGACY_SOURCE="$(psql -d pfe_rls -t -A -c "select a.financial_source_id from public.accounts a where a.id = '$CMC_LEGACY_ACCOUNT';")"
CMC_LEGACY_COMPAT="$(psql -d pfe_rls -t -A -c "select count(*) from public.financial_sources fs join public.accounts a on a.financial_source_id = fs.id join public.ingestion_connections ic on ic.account_id = a.id join public.connector_installations ci on ci.id = ic.connector_installation_id join public.device_credentials dc on dc.id = ic.device_credential_id where a.id = '$CMC_LEGACY_ACCOUNT' and ic.id = '$CMC_LEGACY_CONNECTION' and fs.id = '$CMC_LEGACY_SOURCE' and fs.owner_user_id = '$USER_A' and fs.provider = 'bank' and fs.source_type = 'bank_account';")"
if [ "$CMC_LEGACY_COMPAT" = "1" ]; then
  pass "Connector Stage C: enrollment deterministically canonicalizes an owned account without a source"
else
  fail "Connector Stage C: source-less account compatibility enrollment failed"
fi

if as_user "$USER_A" "insert into public.ingestion_connections (workspace_id, account_id, label, provider, credential_hash, credential_prefix) values ('$WORKSPACE_A', '$CMC_ACCOUNT', 'bypass', 'mtn_momo', 'cmc-bypass-hash', 'cmc_bad');" >/dev/null 2>$ARTIFACT_DIR/pfe_cmc_direct.log; then
  fail "Connector Stage C: owner bypassed atomic enrollment with a direct legacy insert"
else
  pass "Connector Stage C: direct authenticated legacy inserts are revoked"
fi
rm -f $ARTIFACT_DIR/pfe_cmc_direct.log

CMC_SHADOW="$(psql -d pfe_rls -t -A -c "set role service_role; select matches_legacy || '|' || coalesce(mismatch_code, 'none') from public.resolve_canonical_ingestion_shadow('$CMC_CONNECTION');" | tail -1)"
if [ "$CMC_SHADOW" = "true|none" ] || [ "$CMC_SHADOW" = "t|none" ]; then
  pass "Connector Stage C: canonical shadow resolves to the exact legacy route"
else
  fail "Connector Stage C: fresh dual-write shadow mismatch ($CMC_SHADOW)"
fi

psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; update public.ingestion_connections set label = 'C phone rotated', credential_hash = 'cmc-hash-2', credential_prefix = 'cmc_new', status = 'paused', paused_at = now() where id = '$CMC_CONNECTION';" >/dev/null
CMC_SYNC="$(psql -d pfe_rls -t -A -c "select count(*) from public.ingestion_connections ic join public.connector_installations ci on ci.id = ic.connector_installation_id join public.device_credentials dc on dc.id = ic.device_credential_id where ic.id = '$CMC_CONNECTION' and ci.display_name = ic.label and ci.status = 'paused' and dc.label = ic.label and dc.credential_hash = ic.credential_hash and dc.credential_prefix = ic.credential_prefix and dc.status = ic.status and dc.paused_at is not null;")"
if [ "$CMC_SYNC" = "1" ]; then
  pass "Connector Stage C: legacy rotation/lifecycle updates mirror to canonical rows in the same transaction"
else
  fail "Connector Stage C: compatibility trigger failed to mirror lifecycle/credential state"
fi

CMC_INSTALL="$(psql -d pfe_rls -t -A -c "select connector_installation_id from public.ingestion_connections where id = '$CMC_CONNECTION';")"
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; update public.connector_installations set status = 'error' where id = '$CMC_INSTALL';" >/dev/null
CMC_MISMATCH="$(psql -d pfe_rls -t -A -c "set role service_role; select matches_legacy || '|' || mismatch_code from public.resolve_canonical_ingestion_shadow('$CMC_CONNECTION');" | tail -1)"
if [ "$CMC_MISMATCH" = "false|installation_status_mismatch" ] || [ "$CMC_MISMATCH" = "f|installation_status_mismatch" ]; then
  pass "Connector Stage C: shadow comparison identifies canonical route/lifecycle drift"
else
  fail "Connector Stage C: canonical drift was not surfaced ($CMC_MISMATCH)"
fi
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; update public.connector_installations set status = 'paused' where id = '$CMC_INSTALL';" >/dev/null

psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  select public.record_connector_shadow_observation('$CMC_CONNECTION', 'match');
  select public.record_connector_shadow_observation('$CMC_CONNECTION', 'match');
  select public.record_connector_shadow_observation('$CMC_CONNECTION', 'mismatch', 'installation_status_mismatch');
  select public.record_connector_shadow_observation('$CMC_CONNECTION', 'resolver_error', 'shadow_resolver_error');
" >/dev/null
CMC_HEALTH="$(psql -d pfe_rls -t -A -c "set role service_role; select observation_count || '|' || match_count || '|' || mismatch_count || '|' || resolver_error_count || '|' || last_mismatch_code || '|' || (last_match_at is not null) || '|' || (last_mismatch_at is not null) from public.connector_shadow_health where ingestion_connection_id = '$CMC_CONNECTION';" | tail -1)"
if [ "$CMC_HEALTH" = "4|2|1|1|shadow_resolver_error|true|true" ] || [ "$CMC_HEALTH" = "4|2|1|1|shadow_resolver_error|t|t" ]; then
  pass "Connector Stage C: durable shadow health aggregates match, mismatch, and resolver-error outcomes"
else
  fail "Connector Stage C: shadow health counters/timestamps drifted ($CMC_HEALTH)"
fi

if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; select public.record_connector_shadow_observation('$CMC_CONNECTION', 'mismatch', 'unsafe code');" >/dev/null 2>$ARTIFACT_DIR/pfe_cmc_health_validation.log; then
  fail "Connector Stage C: shadow health accepted an unsafe mismatch code"
else
  pass "Connector Stage C: shadow health only accepts redacted machine-readable mismatch codes"
fi
rm -f $ARTIFACT_DIR/pfe_cmc_health_validation.log

if as_user "$USER_A" "select public.resolve_canonical_ingestion_shadow('$CMC_CONNECTION');" >/dev/null 2>$ARTIFACT_DIR/pfe_cmc_acl.log; then
  fail "Connector Stage C: authenticated user called the service-only shadow resolver"
else
  pass "Connector Stage C: canonical shadow resolver is service-role-only"
fi
rm -f $ARTIFACT_DIR/pfe_cmc_acl.log

if as_user "$USER_A" "select public.record_connector_shadow_observation('$CMC_CONNECTION', 'match');" >/dev/null 2>$ARTIFACT_DIR/pfe_cmc_health_acl.log; then
  fail "Connector Stage C: authenticated user recorded a shadow-health observation"
else
  pass "Connector Stage C: shadow-health recording is service-role-only"
fi
rm -f $ARTIFACT_DIR/pfe_cmc_health_acl.log

if as_user "$USER_A" "select count(*) from public.connector_shadow_health;" >/dev/null 2>$ARTIFACT_DIR/pfe_cmc_health_read_acl.log; then
  fail "Connector Stage C: authenticated user read connector shadow health"
else
  pass "Connector Stage C: authenticated users cannot read operational shadow-health aggregates"
fi
rm -f $ARTIFACT_DIR/pfe_cmc_health_read_acl.log

# ===========================================================================
# Connector model Stage D: canonical-authoritative reversible lifecycle and
# rename, with atomic legacy compatibility and tenant isolation.
# ===========================================================================
echo "=== Connector model Stage D lifecycle ==="

# Stage C left this compatibility-backed installation paused. Resume through
# the canonical boundary, add an independently paused sibling credential, then
# prove an installation pause/resume does not reactivate that sibling.
as_user "$USER_A" "select public.set_connector_installation_paused('$CMC_INSTALL', false);" >/dev/null
CMD_INDEPENDENT_CREDENTIAL="00000000-0000-4000-8000-000000000111"
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  insert into public.device_credentials
    (id, connector_installation_id, label, credential_hash,
     credential_prefix, status, paused_at)
  values
    ('$CMD_INDEPENDENT_CREDENTIAL', '$CMC_INSTALL', 'independent device',
     'cmd-independent-hash', 'cmd_ind', 'paused', now());
" >/dev/null

as_user "$USER_A" "select public.set_connector_installation_paused('$CMC_INSTALL', true);" >/dev/null
as_user "$USER_A" "select public.set_connector_installation_paused('$CMC_INSTALL', true);" >/dev/null
CMD_PAUSED="$(psql -d pfe_rls -t -A -c "select ci.status || '|' || ic.status || '|' || dc.status || '|' || dc.paused_by_installation || '|' || sibling.status || '|' || sibling.paused_by_installation from public.connector_installations ci join public.ingestion_connections ic on ic.connector_installation_id = ci.id join public.device_credentials dc on dc.id = ic.device_credential_id join public.device_credentials sibling on sibling.id = '$CMD_INDEPENDENT_CREDENTIAL' where ci.id = '$CMC_INSTALL';")"
if [ "$CMD_PAUSED" = "paused|paused|paused|true|paused|false" ] || [ "$CMD_PAUSED" = "paused|paused|paused|t|paused|f" ]; then
  pass "Connector Stage D: canonical pause atomically pauses compatibility state and marks only active credentials"
else
  fail "Connector Stage D: canonical pause drifted across installation/legacy/credentials ($CMD_PAUSED)"
fi

as_user "$USER_A" "select public.set_connector_installation_paused('$CMC_INSTALL', false);" >/dev/null
CMD_RESUMED="$(psql -d pfe_rls -t -A -c "select ci.status || '|' || coalesce(ci.pre_pause_status, 'none') || '|' || ic.status || '|' || dc.status || '|' || dc.paused_by_installation || '|' || sibling.status || '|' || sibling.paused_by_installation from public.connector_installations ci join public.ingestion_connections ic on ic.connector_installation_id = ci.id join public.device_credentials dc on dc.id = ic.device_credential_id join public.device_credentials sibling on sibling.id = '$CMD_INDEPENDENT_CREDENTIAL' where ci.id = '$CMC_INSTALL';")"
if [ "$CMD_RESUMED" = "healthy|none|active|active|false|paused|false" ] || [ "$CMD_RESUMED" = "healthy|none|active|active|f|paused|f" ]; then
  pass "Connector Stage D: canonical resume preserves independently paused credentials and legacy shadow compatibility"
else
  fail "Connector Stage D: canonical resume changed independent credential state ($CMD_RESUMED)"
fi

CMD_SHADOW="$(psql -d pfe_rls -t -A -c "set role service_role; select matches_legacy || '|' || coalesce(mismatch_code, 'none') from public.resolve_canonical_ingestion_shadow('$CMC_CONNECTION');" | tail -1)"
if [ "$CMD_SHADOW" = "true|none" ] || [ "$CMD_SHADOW" = "t|none" ]; then
  pass "Connector Stage D: canonical lifecycle leaves the Stage C shadow resolver matched"
else
  fail "Connector Stage D: canonical lifecycle created shadow drift ($CMD_SHADOW)"
fi

as_user "$USER_A" "select public.rename_connector_installation('$CMC_INSTALL', '  Canonical phone  ');" >/dev/null
CMD_RENAMED="$(psql -d pfe_rls -t -A -c "select ci.display_name || '|' || ic.label || '|' || dc.label from public.connector_installations ci join public.ingestion_connections ic on ic.connector_installation_id = ci.id join public.device_credentials dc on dc.id = ic.device_credential_id where ci.id = '$CMC_INSTALL';")"
if [ "$CMD_RENAMED" = "Canonical phone|Canonical phone|Canonical phone" ]; then
  pass "Connector Stage D: canonical rename atomically maintains the mapped legacy display name"
else
  fail "Connector Stage D: canonical rename compatibility drifted ($CMD_RENAMED)"
fi

# A canonical-only installation restores its exact pre-pause health state and
# does not conflate the installation display name with an independent device
# label.
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; update public.connector_installations set status = 'error' where id = '$CMA_INSTALL_A';" >/dev/null
as_user "$USER_A" "select public.set_connector_installation_paused('$CMA_INSTALL_A', true); select public.set_connector_installation_paused('$CMA_INSTALL_A', false); select public.rename_connector_installation('$CMA_INSTALL_A', 'Canonical-only source');" >/dev/null
CMD_CANONICAL_ONLY="$(psql -d pfe_rls -t -A -c "select ci.status || '|' || coalesce(ci.pre_pause_status, 'none') || '|' || ci.display_name || '|' || dc.status || '|' || dc.label from public.connector_installations ci join public.device_credentials dc on dc.connector_installation_id = ci.id where ci.id = '$CMA_INSTALL_A';")"
if [ "$CMD_CANONICAL_ONLY" = "error|none|Canonical-only source|active|A device" ]; then
  pass "Connector Stage D: canonical-only resume restores health and rename keeps device labels independent"
else
  fail "Connector Stage D: canonical-only lifecycle/rename semantics drifted ($CMD_CANONICAL_ONLY)"
fi

if as_user "$USER_B" "select public.set_connector_installation_paused('$CMC_INSTALL', true);" >/dev/null 2>$ARTIFACT_DIR/pfe_cmd_tenant.log; then
  fail "Connector Stage D: another tenant paused an installation"
else
  pass "Connector Stage D: canonical lifecycle is owner-scoped"
fi
if as_user "$USER_B" "select public.rename_connector_installation('$CMC_INSTALL', 'tenant takeover');" >/dev/null 2>>$ARTIFACT_DIR/pfe_cmd_tenant.log; then
  fail "Connector Stage D: another tenant renamed an installation"
else
  pass "Connector Stage D: canonical rename is owner-scoped"
fi
if as_user "$USER_A" "select public.rename_connector_installation('$CMC_INSTALL', '   ');" >/dev/null 2>>$ARTIFACT_DIR/pfe_cmd_tenant.log; then
  fail "Connector Stage D: canonical rename accepted an empty display name"
else
  pass "Connector Stage D: canonical rename rejects empty display names"
fi
if as_user "$USER_A" "select public.set_connector_installation_paused('$CMC_INSTALL', null);" >/dev/null 2>>$ARTIFACT_DIR/pfe_cmd_tenant.log; then
  fail "Connector Stage D: canonical lifecycle accepted an unspecified pause state"
else
  pass "Connector Stage D: canonical lifecycle rejects an unspecified pause state"
fi
rm -f $ARTIFACT_DIR/pfe_cmd_tenant.log

CMD_ACL="$(psql -d pfe_rls -t -A -c "select has_function_privilege('authenticated', 'public.set_connector_installation_paused(uuid, boolean)', 'execute') || '|' || has_function_privilege('anon', 'public.set_connector_installation_paused(uuid, boolean)', 'execute') || '|' || has_function_privilege('authenticated', 'public.rename_connector_installation(uuid, text)', 'execute') || '|' || has_function_privilege('anon', 'public.rename_connector_installation(uuid, text)', 'execute');")"
if [ "$CMD_ACL" = "true|false|true|false" ] || [ "$CMD_ACL" = "t|f|t|f" ]; then
  pass "Connector Stage D: lifecycle RPC execution is authenticated-only"
else
  fail "Connector Stage D: lifecycle RPC grants are incorrect ($CMD_ACL)"
fi

# The canonical authentication resolver is deployed before cutover but is
# callable only by the Edge Function's service role. It returns the canonical
# route plus the compatibility ID needed by the rest of the reversible path.
CMD_CANONICAL_AUTH="$(psql -d pfe_rls -t -A -c "set role service_role; select id || '|' || workspace_id || '|' || account_id || '|' || status || '|' || connector_installation_id || '|' || device_credential_id from public.resolve_canonical_ingestion_credential('cmc-hash-2');" | tail -1)"
CMD_EXPECTED_AUTH="$CMC_CONNECTION|$WORKSPACE_A|$CMC_ACCOUNT|active|$CMC_INSTALL|$(psql -d pfe_rls -t -A -c "select device_credential_id from public.ingestion_connections where id = '$CMC_CONNECTION';")"
if [ "$CMD_CANONICAL_AUTH" = "$CMD_EXPECTED_AUTH" ]; then
  pass "Connector Stage D: canonical credential auth resolves the exact compatibility route"
else
  fail "Connector Stage D: canonical credential auth route drifted ($CMD_CANONICAL_AUTH)"
fi

CMD_AUTH_CREDENTIAL="$(psql -d pfe_rls -t -A -c "select device_credential_id from public.ingestion_connections where id = '$CMC_CONNECTION';")"
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; update public.device_credentials set expires_at = now() - interval '1 minute' where id = '$CMD_AUTH_CREDENTIAL';" >/dev/null
CMD_EXPIRED_AUTH="$(psql -d pfe_rls -t -A -c "set role service_role; select count(*) from public.resolve_canonical_ingestion_credential('cmc-hash-2');" | tail -1)"
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; update public.device_credentials set expires_at = null where id = '$CMD_AUTH_CREDENTIAL';" >/dev/null
if [ "$CMD_EXPIRED_AUTH" = "0" ]; then
  pass "Connector Stage D: canonical credential auth rejects expired credentials"
else
  fail "Connector Stage D: canonical credential auth accepted an expired credential"
fi

CMD_CANONICAL_AUTH_ACL="$(psql -d pfe_rls -t -A -c "select has_function_privilege('service_role', 'public.resolve_canonical_ingestion_credential(text)', 'execute') || '|' || has_function_privilege('authenticated', 'public.resolve_canonical_ingestion_credential(text)', 'execute') || '|' || has_function_privilege('anon', 'public.resolve_canonical_ingestion_credential(text)', 'execute');")"
if [ "$CMD_CANONICAL_AUTH_ACL" = "true|false|false" ] || [ "$CMD_CANONICAL_AUTH_ACL" = "t|f|f" ]; then
  pass "Connector Stage D: canonical credential resolver is service-role-only"
else
  fail "Connector Stage D: canonical credential resolver grants are incorrect ($CMD_CANONICAL_AUTH_ACL)"
fi

# The installation rollout control plane is deployed empty/default-legacy.
# An explicit service-only row can select canonical for one installation and
# roll it back without changing any other installation.
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; insert into public.connector_ingestion_rollouts (connector_installation_id, credential_auth_mode) values ('$CMC_INSTALL', 'canonical');" >/dev/null
CMD_SCOPED_CANONICAL="$(psql -d pfe_rls -t -A -c "set role service_role; select credential_auth_mode || '|' || id || '|' || connector_installation_id || '|' || device_credential_id from public.resolve_ingestion_credential_rollout('cmc-hash-2');" | tail -1)"
CMD_EXPECTED_SCOPED_CANONICAL="canonical|$CMC_CONNECTION|$CMC_INSTALL|$CMD_AUTH_CREDENTIAL"
if [ "$CMD_SCOPED_CANONICAL" = "$CMD_EXPECTED_SCOPED_CANONICAL" ]; then
  pass "Connector Stage D: one explicit installation can select canonical credential authentication"
else
  fail "Connector Stage D: installation-scoped canonical auth resolved incorrectly ($CMD_SCOPED_CANONICAL)"
fi

psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; update public.connector_ingestion_rollouts set credential_auth_mode = 'legacy' where connector_installation_id = '$CMC_INSTALL';" >/dev/null
CMD_SCOPED_LEGACY="$(psql -d pfe_rls -t -A -c "set role service_role; select credential_auth_mode || '|' || id || '|' || connector_installation_id || '|' || device_credential_id from public.resolve_ingestion_credential_rollout('cmc-hash-2');" | tail -1)"
CMD_UNCONFIGURED_LEGACY="$(psql -d pfe_rls -t -A -c "set role service_role; select credential_auth_mode || '|' || id || '|' || connector_installation_id || '|' || device_credential_id from public.resolve_ingestion_credential_rollout('cmb-legacy-hash');" | tail -1)"
if [ "$CMD_SCOPED_LEGACY" = "legacy|$CMC_CONNECTION|$CMC_INSTALL|$CMD_AUTH_CREDENTIAL" ] && [ "$CMD_UNCONFIGURED_LEGACY" = "legacy|$CMB_LEGACY|$CMB_INSTALL|$CMB_CREDENTIAL" ]; then
  pass "Connector Stage D: rollout rollback and every unconfigured installation deterministically remain legacy"
else
  fail "Connector Stage D: installation rollout did not default/roll back to legacy (configured=$CMD_SCOPED_LEGACY unconfigured=$CMD_UNCONFIGURED_LEGACY)"
fi

CMD_SCOPED_ROLLOUT_ACL="$(psql -d pfe_rls -t -A -c "select has_table_privilege('service_role', 'public.connector_ingestion_rollouts', 'select') || '|' || has_table_privilege('authenticated', 'public.connector_ingestion_rollouts', 'select') || '|' || has_table_privilege('anon', 'public.connector_ingestion_rollouts', 'select') || '|' || has_function_privilege('service_role', 'public.resolve_ingestion_credential_rollout(text)', 'execute') || '|' || has_function_privilege('authenticated', 'public.resolve_ingestion_credential_rollout(text)', 'execute') || '|' || has_function_privilege('anon', 'public.resolve_ingestion_credential_rollout(text)', 'execute');")"
if [ "$CMD_SCOPED_ROLLOUT_ACL" = "true|false|false|true|false|false" ] || [ "$CMD_SCOPED_ROLLOUT_ACL" = "t|f|f|t|f|f" ]; then
  pass "Connector Stage D: installation rollout state and resolver are service-role-only"
else
  fail "Connector Stage D: installation rollout privileges are incorrect ($CMD_SCOPED_ROLLOUT_ACL)"
fi

# ===========================================================================
# Connector model Stage D: immutable credential rotation and one-way revoke.
# ===========================================================================
echo "=== Connector model Stage D credential history ==="

CMD_ROTATE_HASH_A="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
CMD_ROTATE_HASH_B="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
CMD_ROTATE_HASH_C="cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
CMD_OLD_CREDENTIAL="$(psql -d pfe_rls -t -A -c "select device_credential_id from public.ingestion_connections where id = '$CMC_CONNECTION';")"

# Opted-in users must have an aal2 JWT at the database boundary, even if a
# caller bypasses the server action and invokes PostgREST directly.
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "insert into auth.mfa_factors (user_id, status) values ('$USER_A', 'verified');" >/dev/null
if as_user_aal "$USER_A" "aal1" "select public.rotate_device_credential('$CMD_OLD_CREDENTIAL', '$CMD_ROTATE_HASH_A', 'pfe_aa11');" >/dev/null 2>$ARTIFACT_DIR/pfe_cmd_credential.log; then
  fail "Connector Stage D: AAL1 rotated a credential after MFA enrollment"
else
  pass "Connector Stage D: database rotation requires AAL2 after MFA enrollment"
fi

CMD_NEW_CREDENTIAL="$(as_user_aal "$USER_A" "aal2" "select public.rotate_device_credential('$CMD_OLD_CREDENTIAL', '$CMD_ROTATE_HASH_A', 'pfe_aa11');")"
CMD_ROTATION_SHAPE="$(psql -d pfe_rls -t -A -c "select old.status || '|' || (old.revoked_at is not null) || '|' || coalesce(old.legacy_ingestion_connection_id::text, 'none') || '|' || fresh.status || '|' || (fresh.rotated_from_id = old.id) || '|' || (fresh.legacy_ingestion_connection_id = ic.id) || '|' || (ic.device_credential_id = fresh.id) || '|' || (ic.credential_hash = fresh.credential_hash) from public.device_credentials old join public.device_credentials fresh on fresh.id = '$CMD_NEW_CREDENTIAL' join public.ingestion_connections ic on ic.id = '$CMC_CONNECTION' where old.id = '$CMD_OLD_CREDENTIAL';")"
if [ "$CMD_ROTATION_SHAPE" = "revoked|true|none|active|true|true|true|true" ] || [ "$CMD_ROTATION_SHAPE" = "revoked|t|none|active|t|t|t|t" ]; then
  pass "Connector Stage D: rotation retains the revoked predecessor and atomically advances the legacy mapping"
else
  fail "Connector Stage D: immutable rotation shape is wrong ($CMD_ROTATION_SHAPE)"
fi

CMD_ROTATE_SHADOW="$(psql -d pfe_rls -t -A -c "set role service_role; select matches_legacy || '|' || coalesce(mismatch_code, 'none') from public.resolve_canonical_ingestion_shadow('$CMC_CONNECTION');" | tail -1)"
if [ "$CMD_ROTATE_SHADOW" = "true|none" ] || [ "$CMD_ROTATE_SHADOW" = "t|none" ]; then
  pass "Connector Stage D: rotated credential preserves Stage C shadow parity"
else
  fail "Connector Stage D: rotation created shadow drift ($CMD_ROTATE_SHADOW)"
fi

if as_user_aal "$USER_A" "aal2" "select public.rotate_device_credential('$CMD_OLD_CREDENTIAL', '$CMD_ROTATE_HASH_B', 'pfe_bb22');" >/dev/null 2>>$ARTIFACT_DIR/pfe_cmd_credential.log; then
  fail "Connector Stage D: an already-revoked predecessor rotated twice"
else
  pass "Connector Stage D: a revoked predecessor cannot be replayed for rotation"
fi
if as_user "$USER_B" "select public.rotate_device_credential('$CMD_NEW_CREDENTIAL', '$CMD_ROTATE_HASH_B', 'pfe_bb22');" >/dev/null 2>>$ARTIFACT_DIR/pfe_cmd_credential.log; then
  fail "Connector Stage D: another tenant rotated an owned credential"
else
  pass "Connector Stage D: credential rotation is owner-scoped"
fi
if as_user_aal "$USER_A" "aal2" "select public.rotate_device_credential('$CMD_NEW_CREDENTIAL', 'not-a-digest', 'pfe_bad1');" >/dev/null 2>>$ARTIFACT_DIR/pfe_cmd_credential.log; then
  fail "Connector Stage D: rotation accepted a non-SHA-256 credential digest"
else
  pass "Connector Stage D: rotation validates hash-only credential input"
fi

# With no verified factor, the progressive policy still permits AAL1. This
# canonical-only credential also supplies a valid collision target to prove a
# failed rotation rolls back revocation of the current credential.
CMD_B_CREDENTIAL="00000000-0000-4000-8000-000000000112"
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  insert into public.device_credentials
    (id, connector_installation_id, account_id, label, credential_hash,
     credential_prefix)
  values
    ('$CMD_B_CREDENTIAL', '$CMA_INSTALL_B', '$CMA_ACCOUNT_B', 'B device',
     '$CMD_ROTATE_HASH_B', 'pfe_bb22');
" >/dev/null
CMD_B_SUCCESSOR="$(as_user_aal "$USER_B" "aal1" "select public.rotate_device_credential('$CMD_B_CREDENTIAL', '$CMD_ROTATE_HASH_C', 'pfe_cc33');")"
if [ -n "$CMD_B_SUCCESSOR" ]; then
  pass "Connector Stage D: progressive MFA permits AAL1 when no factor is enrolled"
else
  fail "Connector Stage D: progressive MFA blocked a user without an enrolled factor"
fi

if as_user_aal "$USER_A" "aal2" "select public.rotate_device_credential('$CMD_NEW_CREDENTIAL', '$CMD_ROTATE_HASH_C', 'pfe_cc33');" >/dev/null 2>>$ARTIFACT_DIR/pfe_cmd_credential.log; then
  fail "Connector Stage D: rotation accepted a credential-hash collision"
else
  pass "Connector Stage D: credential-hash collision aborts rotation"
fi
CMD_ROLLBACK_SAFE="$(psql -d pfe_rls -t -A -c "select status || '|' || (legacy_ingestion_connection_id = '$CMC_CONNECTION') from public.device_credentials where id = '$CMD_NEW_CREDENTIAL';")"
if [ "$CMD_ROLLBACK_SAFE" = "active|true" ] || [ "$CMD_ROLLBACK_SAFE" = "active|t" ]; then
  pass "Connector Stage D: failed rotation rolls predecessor/backlink changes back atomically"
else
  fail "Connector Stage D: failed rotation left partial state ($CMD_ROLLBACK_SAFE)"
fi

if as_user_aal "$USER_A" "aal1" "select public.revoke_connector_installation('$CMC_INSTALL');" >/dev/null 2>>$ARTIFACT_DIR/pfe_cmd_credential.log; then
  fail "Connector Stage D: AAL1 revoked an installation after MFA enrollment"
else
  pass "Connector Stage D: database revocation requires AAL2 after MFA enrollment"
fi
as_user_aal "$USER_A" "aal2" "select public.revoke_connector_installation('$CMC_INSTALL');" >/dev/null
as_user_aal "$USER_A" "aal2" "select public.revoke_connector_installation('$CMC_INSTALL');" >/dev/null
CMD_REVOKED="$(psql -d pfe_rls -t -A -c "select ci.status || '|' || (ci.revoked_at is not null) || '|' || ic.status || '|' || (ic.revoked_at is not null) || '|' || count(dc.id) || '|' || count(dc.id) filter (where dc.status = 'revoked') from public.connector_installations ci join public.ingestion_connections ic on ic.connector_installation_id = ci.id join public.device_credentials dc on dc.connector_installation_id = ci.id where ci.id = '$CMC_INSTALL' group by ci.status, ci.revoked_at, ic.status, ic.revoked_at;")"
if [ "$CMD_REVOKED" = "revoked|true|revoked|true|3|3" ] || [ "$CMD_REVOKED" = "revoked|t|revoked|t|3|3" ]; then
  pass "Connector Stage D: installation revoke is idempotent and disables every credential plus legacy auth"
else
  fail "Connector Stage D: installation revoke left active authentication state ($CMD_REVOKED)"
fi

CMD_REVOKE_SHADOW="$(psql -d pfe_rls -t -A -c "set role service_role; select matches_legacy || '|' || coalesce(mismatch_code, 'none') from public.resolve_canonical_ingestion_shadow('$CMC_CONNECTION');" | tail -1)"
if [ "$CMD_REVOKE_SHADOW" = "true|none" ] || [ "$CMD_REVOKE_SHADOW" = "t|none" ]; then
  pass "Connector Stage D: permanent revoke preserves Stage C shadow parity"
else
  fail "Connector Stage D: revoke created shadow drift ($CMD_REVOKE_SHADOW)"
fi

CMD_CREDENTIAL_ACL="$(psql -d pfe_rls -t -A -c "select has_function_privilege('authenticated', 'public.rotate_device_credential(uuid, text, text)', 'execute') || '|' || has_function_privilege('anon', 'public.rotate_device_credential(uuid, text, text)', 'execute') || '|' || has_function_privilege('authenticated', 'public.revoke_connector_installation(uuid)', 'execute') || '|' || has_function_privilege('anon', 'public.revoke_connector_installation(uuid)', 'execute') || '|' || has_function_privilege('authenticated', 'public.require_progressive_mfa()', 'execute');")"
if [ "$CMD_CREDENTIAL_ACL" = "true|false|true|false|false" ] || [ "$CMD_CREDENTIAL_ACL" = "t|f|t|f|f" ]; then
  pass "Connector Stage D: credential RPCs are authenticated-only and their MFA helper is internal"
else
  fail "Connector Stage D: credential RPC grants are incorrect ($CMD_CREDENTIAL_ACL)"
fi
rm -f $ARTIFACT_DIR/pfe_cmd_credential.log

# ===========================================================================
# Connector model Stage D: multi-source discovery + deterministic routing.
# ===========================================================================
echo "=== Connector model Stage D multi-source routing ==="

CMS_PROVIDER_VOCAB="$(psql -d pfe_rls -t -A -c "select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.accounts'::regclass and conname = 'accounts_provider_check';")"
if [[ "$CMS_PROVIDER_VOCAB" == *"airtel_money"* ]] && [[ "$CMS_PROVIDER_VOCAB" == *"statement"* ]]; then
  pass "Connector Stage D: account projections accept the canonical provider vocabulary"
else
  fail "Connector Stage D: account/source provider vocabularies remain inconsistent ($CMS_PROVIDER_VOCAB)"
fi

CMS_INSTALL="00000000-0000-4000-8000-000000000121"
CMS_CREDENTIAL="00000000-0000-4000-8000-000000000122"
CMS_SCOPED_CREDENTIAL="00000000-0000-4000-8000-000000000123"
CMS_SOURCE_A="$(printf '1%.0s' {1..64})"
CMS_SOURCE_B="$(printf '2%.0s' {1..64})"
CMS_ACCOUNT_CURRENT="$(printf '3%.0s' {1..64})"
CMS_ACCOUNT_SAVINGS="$(printf '4%.0s' {1..64})"
CMS_ACCOUNT_BUSINESS="$(printf '5%.0s' {1..64})"
CMS_DISCOVERY="[{\"source_ref_hash\":\"$CMS_SOURCE_A\",\"provider_key\":\"example_bank_rw\",\"provider\":\"bank\",\"source_type\":\"bank_account\",\"display_name\":\"Personal banking\",\"masked_identifier\":\"•••• 1001\",\"currency\":\"RWF\",\"accounts\":[{\"account_ref_hash\":\"$CMS_ACCOUNT_CURRENT\",\"display_name\":\"Current\",\"provider\":\"bank\",\"currency\":\"RWF\"},{\"account_ref_hash\":\"$CMS_ACCOUNT_SAVINGS\",\"display_name\":\"Savings\",\"provider\":\"bank\",\"currency\":\"RWF\"}]},{\"source_ref_hash\":\"$CMS_SOURCE_B\",\"provider_key\":\"example_bank_rw\",\"provider\":\"bank\",\"source_type\":\"bank_account\",\"display_name\":\"Business banking\",\"masked_identifier\":\"•••• 2002\",\"currency\":\"RWF\",\"accounts\":[{\"account_ref_hash\":\"$CMS_ACCOUNT_BUSINESS\",\"display_name\":\"Business current\",\"provider\":\"bank\",\"currency\":\"RWF\"}]}]"

psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  insert into public.connector_installations
    (id, owner_user_id, home_workspace_id, connector_key, display_name,
     status, auth_mode)
  values
    ('$CMS_INSTALL', '$USER_A', '$WORKSPACE_A', 'bank_open_api_v1',
     'Multi-source bank', 'healthy', 'device_secret');
  insert into public.device_credentials
    (id, connector_installation_id, label, credential_hash, credential_prefix)
  values
    ('$CMS_CREDENTIAL', '$CMS_INSTALL', 'Bank event agent',
     'cms-credential-hash', 'cms_cred');
" >/dev/null

CMS_FIRST="$(psql -d pfe_rls -t -A -c "set role service_role; select count(*) from public.apply_connector_discovery('$CMS_INSTALL', '$CMS_DISCOVERY'::jsonb);" | tail -1)"
CMS_IDS_BEFORE="$(psql -d pfe_rls -t -A -c "select string_agg(fs.id || ':' || a.id, ',' order by fs.external_source_ref_hash, a.external_account_ref_hash) from public.financial_sources fs join public.accounts a on a.financial_source_id = fs.id where fs.connector_installation_id = '$CMS_INSTALL';")"
CMS_SECOND="$(psql -d pfe_rls -t -A -c "set role service_role; select count(*) from public.apply_connector_discovery('$CMS_INSTALL', '$CMS_DISCOVERY'::jsonb);" | tail -1)"
CMS_IDS_AFTER="$(psql -d pfe_rls -t -A -c "select string_agg(fs.id || ':' || a.id, ',' order by fs.external_source_ref_hash, a.external_account_ref_hash) from public.financial_sources fs join public.accounts a on a.financial_source_id = fs.id where fs.connector_installation_id = '$CMS_INSTALL';")"
CMS_COUNTS="$(psql -d pfe_rls -t -A -c "select count(distinct fs.id) || '|' || count(a.id) from public.financial_sources fs join public.accounts a on a.financial_source_id = fs.id where fs.connector_installation_id = '$CMS_INSTALL';")"
if [ "$CMS_FIRST" = "3" ] && [ "$CMS_SECOND" = "3" ] && [ "$CMS_COUNTS" = "2|3" ] && [ "$CMS_IDS_BEFORE" = "$CMS_IDS_AFTER" ]; then
  pass "Connector Stage D: discovery idempotently materializes two sources and three stable accounts"
else
  fail "Connector Stage D: discovery identity/idempotence drifted (first=$CMS_FIRST second=$CMS_SECOND counts=$CMS_COUNTS)"
fi

if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; select public.resolve_connector_event_route('$CMS_CREDENTIAL');" >/dev/null 2>$ARTIFACT_DIR/pfe_cms_route.log; then
  fail "Connector Stage D: unscoped credential guessed between multiple sources"
else
  pass "Connector Stage D: multiple sources require a stable source discriminator"
fi
if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; select public.resolve_connector_event_route('$CMS_CREDENTIAL', '$CMS_SOURCE_A');" >/dev/null 2>>$ARTIFACT_DIR/pfe_cms_route.log; then
  fail "Connector Stage D: source discriminator guessed between multiple accounts"
else
  pass "Connector Stage D: multiple accounts require a stable account discriminator"
fi

CMS_BUSINESS_ROUTE="$(psql -d pfe_rls -t -A -c "set role service_role; select financial_source_id || '|' || account_id || '|' || workspace_id from public.resolve_connector_event_route('$CMS_CREDENTIAL', '$CMS_SOURCE_B');" | tail -1)"
CMS_BUSINESS_EXPECTED="$(psql -d pfe_rls -t -A -c "select fs.id || '|' || a.id || '|' || a.workspace_id from public.financial_sources fs join public.accounts a on a.financial_source_id = fs.id where fs.connector_installation_id = '$CMS_INSTALL' and fs.external_source_ref_hash = '$CMS_SOURCE_B' and a.external_account_ref_hash = '$CMS_ACCOUNT_BUSINESS';")"
CMS_SAVINGS_ROUTE="$(psql -d pfe_rls -t -A -c "set role service_role; select financial_source_id || '|' || account_id || '|' || workspace_id from public.resolve_connector_event_route('$CMS_CREDENTIAL', '$CMS_SOURCE_A', '$CMS_ACCOUNT_SAVINGS');" | tail -1)"
CMS_SAVINGS_EXPECTED="$(psql -d pfe_rls -t -A -c "select fs.id || '|' || a.id || '|' || a.workspace_id from public.financial_sources fs join public.accounts a on a.financial_source_id = fs.id where fs.connector_installation_id = '$CMS_INSTALL' and fs.external_source_ref_hash = '$CMS_SOURCE_A' and a.external_account_ref_hash = '$CMS_ACCOUNT_SAVINGS';")"
if [ "$CMS_BUSINESS_ROUTE" = "$CMS_BUSINESS_EXPECTED" ] && [ "$CMS_SAVINGS_ROUTE" = "$CMS_SAVINGS_EXPECTED" ]; then
  pass "Connector Stage D: unique and explicitly discriminated routes resolve deterministically"
else
  fail "Connector Stage D: deterministic routes drifted (business=$CMS_BUSINESS_ROUTE savings=$CMS_SAVINGS_ROUTE)"
fi

CMS_CURRENT_ID="$(psql -d pfe_rls -t -A -c "select a.id from public.accounts a join public.financial_sources fs on fs.id = a.financial_source_id where fs.connector_installation_id = '$CMS_INSTALL' and fs.external_source_ref_hash = '$CMS_SOURCE_A' and a.external_account_ref_hash = '$CMS_ACCOUNT_CURRENT';")"
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; insert into public.device_credentials (id, connector_installation_id, account_id, label, credential_hash, credential_prefix) values ('$CMS_SCOPED_CREDENTIAL', '$CMS_INSTALL', '$CMS_CURRENT_ID', 'Current-only agent', 'cms-scoped-hash', 'cms_scope');" >/dev/null
CMS_SCOPED_ROUTE="$(psql -d pfe_rls -t -A -c "set role service_role; select account_id from public.resolve_connector_event_route('$CMS_SCOPED_CREDENTIAL');" | tail -1)"
if [ "$CMS_SCOPED_ROUTE" = "$CMS_CURRENT_ID" ]; then
  pass "Connector Stage D: least-privilege credential scope resolves without client routing input"
else
  fail "Connector Stage D: scoped credential did not resolve its bound account"
fi
if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; select public.resolve_connector_event_route('$CMS_SCOPED_CREDENTIAL', '$CMS_SOURCE_B', '$CMS_ACCOUNT_BUSINESS');" >/dev/null 2>>$ARTIFACT_DIR/pfe_cms_route.log; then
  fail "Connector Stage D: scoped credential accepted a conflicting discriminator"
else
  pass "Connector Stage D: scoped credentials reject conflicting source/account discriminators"
fi

CMS_UNSAFE="[{\"source_ref_hash\":\"$CMS_SOURCE_A\",\"provider_key\":\"example_bank_rw\",\"provider\":\"bank\",\"source_type\":\"bank_account\",\"display_name\":\"Unsafe\",\"currency\":\"RWF\",\"access_token\":\"secret\",\"accounts\":[]}]"
if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; select public.apply_connector_discovery('$CMS_INSTALL', '$CMS_UNSAFE'::jsonb);" >/dev/null 2>>$ARTIFACT_DIR/pfe_cms_route.log; then
  fail "Connector Stage D: discovery accepted an unknown secret-bearing field"
else
  pass "Connector Stage D: discovery rejects unknown fields instead of storing provider secrets"
fi

CMS_CROSS_INSTALL="[{\"source_ref_hash\":\"$CMS_SOURCE_A\",\"provider_key\":\"example_bank_rw\",\"provider\":\"bank\",\"source_type\":\"bank_account\",\"display_name\":\"Tenant B banking\",\"masked_identifier\":\"•••• 1001\",\"currency\":\"RWF\",\"accounts\":[{\"account_ref_hash\":\"$CMS_ACCOUNT_CURRENT\",\"display_name\":\"Tenant B current\",\"provider\":\"bank\",\"currency\":\"RWF\"}]}]"
CMS_CROSS_APPLIED="$(psql -d pfe_rls -t -A -c "set role service_role; select count(*) from public.apply_connector_discovery('$CMA_INSTALL_B', '$CMS_CROSS_INSTALL'::jsonb);" | tail -1)"
CMS_CROSS_COUNT="$(psql -d pfe_rls -t -A -c "select count(*) from public.financial_sources where external_source_ref_hash = '$CMS_SOURCE_A' and connector_installation_id in ('$CMS_INSTALL', '$CMA_INSTALL_B');")"
if [ "$CMS_CROSS_APPLIED" = "1" ] && [ "$CMS_CROSS_COUNT" = "2" ]; then
  pass "Connector Stage D: identical provider references coexist in separate installations"
else
  fail "Connector Stage D: installation-scoped provider identity collapsed across tenants"
fi
rm -f $ARTIFACT_DIR/pfe_cms_route.log

CMS_ACL="$(psql -d pfe_rls -t -A -c "select has_function_privilege('service_role', 'public.apply_connector_discovery(uuid,jsonb)', 'execute') || '|' || has_function_privilege('authenticated', 'public.apply_connector_discovery(uuid,jsonb)', 'execute') || '|' || has_function_privilege('anon', 'public.apply_connector_discovery(uuid,jsonb)', 'execute') || '|' || has_function_privilege('service_role', 'public.resolve_connector_event_route(uuid,text,text)', 'execute') || '|' || has_function_privilege('authenticated', 'public.resolve_connector_event_route(uuid,text,text)', 'execute') || '|' || has_function_privilege('anon', 'public.resolve_connector_event_route(uuid,text,text)', 'execute');")"
if [ "$CMS_ACL" = "true|false|false|true|false|false" ] || [ "$CMS_ACL" = "t|f|f|t|f|f" ]; then
  pass "Connector Stage D: discovery and routing RPCs are service-role-only"
else
  fail "Connector Stage D: discovery/routing RPC grants are incorrect ($CMS_ACL)"
fi

# Provider adapter route-health rollout evidence: aggregate and service-only.
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  select public.record_connector_adapter_route_observation('$CMS_CREDENTIAL', 'match');
  select public.record_connector_adapter_route_observation('$CMS_CREDENTIAL', 'mismatch', 'adapter_account_mismatch');
  select public.record_connector_adapter_route_observation('$CMS_CREDENTIAL', 'resolver_error', 'adapter_route_resolver_error');
  select public.record_connector_adapter_route_observation('$CMS_CREDENTIAL', 'envelope_error', 'route_discriminator_invalid');
" >/dev/null
CMS_ADAPTER_HEALTH="$(psql -d pfe_rls -t -A -c "select observation_count || '|' || match_count || '|' || mismatch_count || '|' || resolver_error_count || '|' || envelope_error_count || '|' || last_failure_code from public.connector_adapter_route_health where connector_installation_id = '$CMS_INSTALL';")"
if [ "$CMS_ADAPTER_HEALTH" = "4|1|1|1|1|route_discriminator_invalid" ]; then
  pass "Connector adapter: rollout health records redacted aggregate outcomes"
else
  fail "Connector adapter: rollout health counters drifted ($CMS_ADAPTER_HEALTH)"
fi

CMS_ADAPTER_ACL="$(psql -d pfe_rls -t -A -c "select has_table_privilege('service_role', 'public.connector_adapter_route_health', 'select') || '|' || has_table_privilege('authenticated', 'public.connector_adapter_route_health', 'select') || '|' || has_table_privilege('anon', 'public.connector_adapter_route_health', 'select') || '|' || has_function_privilege('service_role', 'public.record_connector_adapter_route_observation(uuid,text,text)', 'execute') || '|' || has_function_privilege('authenticated', 'public.record_connector_adapter_route_observation(uuid,text,text)', 'execute') || '|' || has_function_privilege('anon', 'public.record_connector_adapter_route_observation(uuid,text,text)', 'execute');")"
if [ "$CMS_ADAPTER_ACL" = "true|false|false|true|false|false" ] || [ "$CMS_ADAPTER_ACL" = "t|f|f|t|f|f" ]; then
  pass "Connector adapter: rollout health table and recorder are service-role-only"
else
  fail "Connector adapter: rollout health privileges are incorrect ($CMS_ADAPTER_ACL)"
fi

# Installation-scoped MTN canary: pair hashes onto the existing dual-write
# route, prove deterministic resolution, then evaluate only post-enable health.
CANARY_SOURCE="00000000-0000-4000-8000-000000000131"
CANARY_ACCOUNT="00000000-0000-4000-8000-000000000132"
CANARY_SOURCE_HASH="$(printf '6%.0s' {1..64})"
CANARY_ACCOUNT_HASH="$(printf '7%.0s' {1..64})"
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  insert into public.financial_sources
    (id, owner_user_id, provider, source_type, display_name, currency)
  values ('$CANARY_SOURCE', '$USER_A', 'mtn_momo', 'mobile_money',
    'Canary MTN source', 'RWF');
  insert into public.accounts
    (id, workspace_id, financial_source_id, name, provider, currency)
  values ('$CANARY_ACCOUNT', '$WORKSPACE_A', '$CANARY_SOURCE',
    'Canary MTN account', 'mtn_momo', 'RWF');
" >/dev/null
CANARY_CONNECTION="$(as_user "$USER_A" "select public.create_ingestion_connection_dual_write('$WORKSPACE_A', '$CANARY_ACCOUNT', 'Canary phone', 'mtn_momo', 'canary-credential-hash', 'canary_p');")"
if as_user_aal "$USER_A" "aal2" "select public.pair_mtn_momo_adapter_canary('$CANARY_CONNECTION', '$CANARY_SOURCE_HASH', '$CANARY_ACCOUNT_HASH', 'MTN MoMo •••• 0001');" >/dev/null 2>$ARTIFACT_DIR/pfe_canary_admin.log; then
  fail "Connector adapter canary: a non-platform-admin owner occupied the controlled canary slot"
else
  pass "Connector adapter canary: pairing is restricted to the platform admin who owns the controlled installation"
fi
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; update public.profiles set is_platform_admin = true where id = '$USER_A';" >/dev/null
CANARY_INSTALL="$(as_user_aal "$USER_A" "aal2" "select public.pair_mtn_momo_adapter_canary('$CANARY_CONNECTION', '$CANARY_SOURCE_HASH', '$CANARY_ACCOUNT_HASH', 'MTN MoMo •••• 0001');")"
CANARY_INSTALL_CANONICAL="$(as_user_aal "$USER_A" "aal2" "select public.pair_mtn_momo_adapter_canary_by_installation('$CANARY_INSTALL', '$CANARY_SOURCE_HASH', '$CANARY_ACCOUNT_HASH', 'MTN MoMo •••• 0001');")"
if [ "$CANARY_INSTALL_CANONICAL" = "$CANARY_INSTALL" ]; then
  pass "Connector Stage D: canonical UI pairs the canary without exposing a legacy connection ID"
else
  fail "Connector Stage D: canonical installation pairing resolved the wrong route ($CANARY_INSTALL_CANONICAL)"
fi
CANARY_BOUND="$(psql -d pfe_rls -t -A -c "select (fs.external_source_ref_hash = '$CANARY_SOURCE_HASH') || '|' || (a.external_account_ref_hash = '$CANARY_ACCOUNT_HASH') || '|' || canary.enabled from public.financial_sources fs join public.accounts a on a.financial_source_id = fs.id join public.connector_adapter_canaries canary on canary.connector_installation_id = fs.connector_installation_id where fs.id = '$CANARY_SOURCE';")"
if [ "$CANARY_BOUND" = "true|true|true" ] || [ "$CANARY_BOUND" = "t|t|t" ]; then
  pass "Connector adapter canary: owner pairing binds hashes onto the existing route and enables only its installation"
else
  fail "Connector adapter canary: pairing did not bind the existing route ($CANARY_BOUND)"
fi

CANARY_CREDENTIAL="$(psql -d pfe_rls -t -A -c "select device_credential_id from public.ingestion_connections where id = '$CANARY_CONNECTION';")"
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  select public.record_connector_adapter_route_observation('$CANARY_CREDENTIAL', 'match');
  select public.record_connector_adapter_route_observation('$CANARY_CREDENTIAL', 'match');
  select public.record_connector_adapter_route_observation('$CANARY_CREDENTIAL', 'match');
  select public.record_connector_adapter_route_observation('$CANARY_CREDENTIAL', 'match');
  select public.record_connector_adapter_route_observation('$CANARY_CREDENTIAL', 'match');
" >/dev/null
CANARY_STATUS="$(as_user "$USER_A" "select observation_count || '|' || match_count || '|' || mismatch_count || '|' || ready_for_broader_rollout from public.get_connector_adapter_canary_status() where connector_installation_id = '$CANARY_INSTALL';")"
if [ "$CANARY_STATUS" = "5|5|0|true" ] || [ "$CANARY_STATUS" = "5|5|0|t" ]; then
  pass "Connector adapter canary: five clean post-enable matches satisfy the broader-rollout evidence gate"
else
  fail "Connector adapter canary: health evaluation drifted ($CANARY_STATUS)"
fi

as_user_aal "$USER_A" "aal2" "select public.set_connector_adapter_canary_enabled('$CANARY_INSTALL', false);" >/dev/null
CANARY_DISABLED="$(psql -d pfe_rls -t -A -c "select not enabled and disabled_at is not null from public.connector_adapter_canaries where connector_installation_id = '$CANARY_INSTALL';")"
if [ "$CANARY_DISABLED" = "true" ] || [ "$CANARY_DISABLED" = "t" ]; then
  pass "Connector adapter canary: owner kill switch disables routing without removing paired identity"
else
  fail "Connector adapter canary: kill switch failed ($CANARY_DISABLED)"
fi

CANARY_ACL="$(psql -d pfe_rls -t -A -c "select has_table_privilege('service_role', 'public.connector_adapter_canaries', 'select') || '|' || has_table_privilege('authenticated', 'public.connector_adapter_canaries', 'select') || '|' || has_table_privilege('anon', 'public.connector_adapter_canaries', 'select') || '|' || has_function_privilege('authenticated', 'public.pair_mtn_momo_adapter_canary(uuid,text,text,text)', 'execute') || '|' || has_function_privilege('anon', 'public.pair_mtn_momo_adapter_canary(uuid,text,text,text)', 'execute') || '|' || has_function_privilege('authenticated', 'public.get_connector_adapter_canary_status()', 'execute') || '|' || has_function_privilege('authenticated', 'public.pair_mtn_momo_adapter_canary_by_installation(uuid,text,text,text)', 'execute') || '|' || has_function_privilege('anon', 'public.pair_mtn_momo_adapter_canary_by_installation(uuid,text,text,text)', 'execute') || '|' || has_function_privilege('authenticated', 'public.get_connector_canonical_read_cutover_status()', 'execute') || '|' || has_function_privilege('anon', 'public.get_connector_canonical_read_cutover_status()', 'execute');")"
if [ "$CANARY_ACL" = "true|false|false|true|false|true|true|false|true|false" ] || [ "$CANARY_ACL" = "t|f|f|t|f|t|t|f|t|f" ]; then
  pass "Connector adapter canary: allowlist is service-only while owner workflows use narrow authenticated RPCs"
else
  fail "Connector adapter canary: privileges are incorrect ($CANARY_ACL)"
fi

# Shared-workspace canonical visibility. Use isolated users so readiness is
# evaluated only against the fixture under test, independent of earlier rows.
CUTOVER_SHARED_OWNER="$(psql -d pfe_rls -t -A -c "insert into auth.users (email) values ('connector-shared-owner@example.com') returning id;" | head -1)"
CUTOVER_SHARED_MEMBER="$(psql -d pfe_rls -t -A -c "insert into auth.users (email) values ('connector-shared-member@example.com') returning id;" | head -1)"
CUTOVER_SHARED_WS="$(as_user "$CUTOVER_SHARED_OWNER" "select public.create_household_workspace('Connector shared household');")"
CUTOVER_SHARED_SOURCE="$(psql -d pfe_rls -t -A -c "set role service_role; insert into public.financial_sources (owner_user_id, provider, source_type, display_name, currency) values ('$CUTOVER_SHARED_OWNER', 'mtn_momo', 'mobile_money', 'Shared connector source', 'RWF') returning id;" | grep -Eo '[0-9a-f-]{36}' | head -1)"
CUTOVER_SHARED_ACCOUNT="$(psql -d pfe_rls -t -A -c "set role service_role; insert into public.accounts (workspace_id, financial_source_id, name, provider, currency) values ('$CUTOVER_SHARED_WS', '$CUTOVER_SHARED_SOURCE', 'Shared connector account', 'mtn_momo', 'RWF') returning id;" | grep -Eo '[0-9a-f-]{36}' | head -1)"
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  insert into public.workspace_memberships
    (workspace_id, user_id, role, status, joined_at)
  values
    ('$CUTOVER_SHARED_WS', '$CUTOVER_SHARED_MEMBER', 'member', 'active', now());
  insert into public.source_space_links
    (financial_source_id, workspace_id, visibility_mode, status, created_by)
  values
    ('$CUTOVER_SHARED_SOURCE', '$CUTOVER_SHARED_WS', 'share_transactions', 'active', '$CUTOVER_SHARED_OWNER');
" >/dev/null
CUTOVER_SHARED_CONNECTION="$(as_user "$CUTOVER_SHARED_OWNER" "select public.create_ingestion_connection_dual_write('$CUTOVER_SHARED_WS', '$CUTOVER_SHARED_ACCOUNT', 'Shared phone', 'mtn_momo', 'cutover-shared-hash', 'cut_shr');")"
CUTOVER_SHARED_INSTALL="$(psql -d pfe_rls -t -A -c "select connector_installation_id from public.ingestion_connections where id = '$CUTOVER_SHARED_CONNECTION';")"
CUTOVER_SHARED_CREDENTIAL="$(psql -d pfe_rls -t -A -c "select device_credential_id from public.ingestion_connections where id = '$CUTOVER_SHARED_CONNECTION';")"
CUTOVER_SHARED_UNSCOPED="$(psql -d pfe_rls -t -A -c "set role service_role; insert into public.device_credentials (connector_installation_id, label, credential_hash, credential_prefix) values ('$CUTOVER_SHARED_INSTALL', 'Owner-wide agent', 'cutover-shared-unscoped-hash', 'cut_wide') returning id;" | grep -Eo '[0-9a-f-]{36}' | head -1)"
CUTOVER_SHARED_READ="$(as_user "$CUTOVER_SHARED_MEMBER" "select (select count(*) from public.connector_installations where id = '$CUTOVER_SHARED_INSTALL') || '|' || (select count(*) from public.device_credentials where id = '$CUTOVER_SHARED_CREDENTIAL') || '|' || (select count(*) from public.device_credentials where id = '$CUTOVER_SHARED_UNSCOPED') || '|' || blocking_count || '|' || ready from public.get_connector_canonical_read_cutover_status();")"
if [ "$CUTOVER_SHARED_READ" = "1|1|0|0|true" ] || [ "$CUTOVER_SHARED_READ" = "1|1|0|0|t" ]; then
  pass "Connector Stage D: a member reads shared account-scoped metadata, not owner-wide credentials, and exact mappings open canonical cutover"
else
  fail "Connector Stage D: shared canonical visibility or readiness is wrong ($CUTOVER_SHARED_READ)"
fi
if as_user "$CUTOVER_SHARED_MEMBER" "select credential_hash from public.device_credentials where id = '$CUTOVER_SHARED_CREDENTIAL';" >/dev/null 2>$ARTIFACT_DIR/pfe_cutover_shared_secret.log; then
  fail "Connector Stage D: a shared-workspace member could read a credential hash"
else
  pass "Connector Stage D: shared credential metadata never exposes credential hashes"
fi
if as_user_aal "$CUTOVER_SHARED_MEMBER" "aal2" "select public.rename_connector_installation('$CUTOVER_SHARED_INSTALL', 'Member rename');" >/dev/null 2>$ARTIFACT_DIR/pfe_cutover_shared_manage.log; then
  fail "Connector Stage D: a shared-workspace member managed another user's installation"
else
  pass "Connector Stage D: shared canonical visibility remains read-only for non-owners"
fi
rm -f $ARTIFACT_DIR/pfe_cutover_shared_secret.log $ARTIFACT_DIR/pfe_cutover_shared_manage.log

# An installation itself is safe workspace metadata, but an account-scoped
# credential and cutover mapping remain hidden while its household source is
# private. This is the no-implicit-sharing privacy boundary.
CUTOVER_PRIVATE_OWNER="$(psql -d pfe_rls -t -A -c "insert into auth.users (email) values ('connector-private-owner@example.com') returning id;" | head -1)"
CUTOVER_PRIVATE_MEMBER="$(psql -d pfe_rls -t -A -c "insert into auth.users (email) values ('connector-private-member@example.com') returning id;" | head -1)"
CUTOVER_PRIVATE_WS="$(as_user "$CUTOVER_PRIVATE_OWNER" "select public.create_household_workspace('Connector private household');")"
CUTOVER_PRIVATE_SOURCE="$(psql -d pfe_rls -t -A -c "set role service_role; insert into public.financial_sources (owner_user_id, provider, source_type, display_name, currency) values ('$CUTOVER_PRIVATE_OWNER', 'mtn_momo', 'mobile_money', 'Private connector source', 'RWF') returning id;" | grep -Eo '[0-9a-f-]{36}' | head -1)"
CUTOVER_PRIVATE_ACCOUNT="$(psql -d pfe_rls -t -A -c "set role service_role; insert into public.accounts (workspace_id, financial_source_id, name, provider, currency) values ('$CUTOVER_PRIVATE_WS', '$CUTOVER_PRIVATE_SOURCE', 'Private connector account', 'mtn_momo', 'RWF') returning id;" | grep -Eo '[0-9a-f-]{36}' | head -1)"
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  insert into public.workspace_memberships
    (workspace_id, user_id, role, status, joined_at)
  values
    ('$CUTOVER_PRIVATE_WS', '$CUTOVER_PRIVATE_MEMBER', 'member', 'active', now());
" >/dev/null
CUTOVER_PRIVATE_CONNECTION="$(as_user "$CUTOVER_PRIVATE_OWNER" "select public.create_ingestion_connection_dual_write('$CUTOVER_PRIVATE_WS', '$CUTOVER_PRIVATE_ACCOUNT', 'Private phone', 'mtn_momo', 'cutover-private-hash', 'cut_prv');")"
CUTOVER_PRIVATE_INSTALL="$(psql -d pfe_rls -t -A -c "select connector_installation_id from public.ingestion_connections where id = '$CUTOVER_PRIVATE_CONNECTION';")"
CUTOVER_PRIVATE_CREDENTIAL="$(psql -d pfe_rls -t -A -c "select device_credential_id from public.ingestion_connections where id = '$CUTOVER_PRIVATE_CONNECTION';")"
CUTOVER_PRIVATE_READ="$(as_user "$CUTOVER_PRIVATE_MEMBER" "select (select count(*) from public.connector_installations where id = '$CUTOVER_PRIVATE_INSTALL') || '|' || (select count(*) from public.device_credentials where id = '$CUTOVER_PRIVATE_CREDENTIAL') || '|' || (blocking_count > 0) || '|' || (not ready) from public.get_connector_canonical_read_cutover_status();")"
if [ "$CUTOVER_PRIVATE_READ" = "1|0|true|true" ] || [ "$CUTOVER_PRIVATE_READ" = "1|0|t|t" ]; then
  pass "Connector Stage D: private household sources hide scoped credentials and keep canonical cutover fail-closed"
else
  fail "Connector Stage D: private household source visibility leaked or failed open ($CUTOVER_PRIVATE_READ)"
fi

CUTOVER_EMPTY_USER="$(psql -d pfe_rls -t -A -c "insert into auth.users (email) values ('connector-cutover-empty@example.com') returning id;" | head -1)"
CUTOVER_READY="$(as_user "$CUTOVER_EMPTY_USER" "select (blocking_count = 0) || '|' || ready from public.get_connector_canonical_read_cutover_status();")"
if [ "$CUTOVER_READY" = "true|true" ] || [ "$CUTOVER_READY" = "t|t" ]; then
  pass "Connector Stage D: users with no visible legacy rows satisfy the canonical settings cutover gate"
else
  fail "Connector Stage D: an empty canonical visibility set did not open read cutover ($CUTOVER_READY)"
fi
rm -f $ARTIFACT_DIR/pfe_canary_admin.log

# Phase V PR4b: visible_source_ids_for_user - the auth.uid()-free source
# visibility the scheduled-report generator uses for household members.
# Fresh household V4_HH: USER_A owner, USER_R member; V4_SRC_A (USER_A's,
# shared in) and V4_SRC_R (USER_R's, not shared).
# ===========================================================================
echo "=== Phase V PR4b: report source visibility ==="

V4_HH="$(as_user "$USER_A" "select public.create_household_workspace('V4 Household');")"
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; insert into public.workspace_invites (workspace_id, email, role, token_hash, token_prefix, invited_by) values ('$V4_HH', 'r-invitee@example.com', 'member', 'v4-token-1', 'v4-pref-1', '$USER_A');" >/dev/null
as_user "$USER_R" "select public.accept_workspace_invite('v4-token-1');" >/dev/null

V4_SRC_A="$(psql -d pfe_rls -t -A -c "set role service_role; insert into public.financial_sources (owner_user_id, provider, source_type, display_name, currency) values ('$USER_A', 'mtn_momo', 'mobile_money', 'A shared src (V4)', 'RWF') returning id;" | grep -Eo '[0-9a-f-]{36}' | head -1)"
V4_SRC_R="$(psql -d pfe_rls -t -A -c "set role service_role; insert into public.financial_sources (owner_user_id, provider, source_type, display_name, currency) values ('$USER_R', 'mtn_momo', 'mobile_money', 'R private src (V4)', 'RWF') returning id;" | grep -Eo '[0-9a-f-]{36}' | head -1)"
as_user "$USER_A" "select public.allocate_source_to_space('$V4_SRC_A', '$V4_HH', 'share_transactions', false, now());" >/dev/null

V4_A_SEES_SHARED="$(psql -d pfe_rls -t -A -c "set role service_role; select count(*) from public.visible_source_ids_for_user('$V4_HH', '$USER_A') s(id) where s.id = '$V4_SRC_A';" | tail -1)"
V4_A_SEES_PRIVATE="$(psql -d pfe_rls -t -A -c "set role service_role; select count(*) from public.visible_source_ids_for_user('$V4_HH', '$USER_A') s(id) where s.id = '$V4_SRC_R';" | tail -1)"
V4_R_SEES_OWN="$(psql -d pfe_rls -t -A -c "set role service_role; select count(*) from public.visible_source_ids_for_user('$V4_HH', '$USER_R') s(id) where s.id = '$V4_SRC_R';" | tail -1)"
V4_R_SEES_SHARED="$(psql -d pfe_rls -t -A -c "set role service_role; select count(*) from public.visible_source_ids_for_user('$V4_HH', '$USER_R') s(id) where s.id = '$V4_SRC_A';" | tail -1)"
if [ "$V4_A_SEES_SHARED" = "1" ] && [ "$V4_A_SEES_PRIVATE" = "0" ] && [ "$V4_R_SEES_OWN" = "1" ] && [ "$V4_R_SEES_SHARED" = "1" ]; then
  pass "Phase V PR4b: visible_source_ids_for_user returns owned + shared-in sources per user, and hides another member's unshared source"
else
  fail "Phase V PR4b: visibility wrong (A shared=$V4_A_SEES_SHARED A private=$V4_A_SEES_PRIVATE R own=$V4_R_SEES_OWN R shared=$V4_R_SEES_SHARED)"
fi

# service-role-only.
if as_user "$USER_A" "select public.visible_source_ids_for_user('$V4_HH', '$USER_A');" >/dev/null 2>$ARTIFACT_DIR/pfe_v_pr4b.log; then
  fail "Phase V PR4b: visible_source_ids_for_user was callable by an authenticated user"
else
  pass "Phase V PR4b: visible_source_ids_for_user is service-role-only"
fi
rm -f $ARTIFACT_DIR/pfe_v_pr4b.log

# ===========================================================================
# Phase W PR6: production-readiness invariants for the Spaces program.
#   1. The Spaces migrations never mutate an existing ledger row's money
#      fields (a Phase G transaction is byte-identical after the full
#      Q->W chain has applied).
#   2. anon has zero privilege on every table the Spaces program added.
# ===========================================================================
echo "=== Phase W PR6: production-readiness invariants ==="

W6_LEDGER="$(psql -d pfe_rls -t -A -c "select amount_rwf || '/' || fee_rwf || '/' || net_effect_rwf from public.transactions where id = '$GTXN1';")"
if [ "$W6_LEDGER" = "1200/0/-1200" ]; then
  pass "Phase W PR6: a pre-Spaces transaction's amount / fee / net_effect are unchanged after the full Q->W migration chain"
else
  fail "Phase W PR6: a pre-Spaces transaction's money fields drifted (got '$W6_LEDGER', expected '1200/0/-1200')"
fi

W6_ANON="$(psql -d pfe_rls -t -A -c "select count(*) from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public' and table_name in ('financial_sources', 'source_space_links', 'raw_financial_events', 'notifications', 'budget_threshold_state', 'transaction_member_attributions', 'goal_participants', 'space_activity', 'space_audit_events', 'space_member_notification_prefs', 'space_member_capability_grants', 'workspace_categories');")"
if [ "$W6_ANON" = "0" ]; then
  pass "Phase W PR6: anon holds no privilege on any table the Spaces program added"
else
  fail "Phase W PR6: anon holds $W6_ANON grant(s) on a Spaces table - lockdown regression"
fi

# ===========================================================================
# Operational health: aggregate-only service snapshot across ingestion,
# duplicate review, scheduled reports, email, and reconciliation.
# ===========================================================================
echo "=== operational health snapshot ==="

OPS_HEALTH_SHAPE="$(psql -d pfe_rls -t -A -c "set role service_role; with snapshot as (select public.get_operational_health_snapshot(60) as s) select (s ? 'captured_at') || '|' || (s ? 'window_minutes') || '|' || (s ? 'ingestion') || '|' || (s ? 'duplicates') || '|' || (s ? 'jobs') || '|' || (s ? 'email') || '|' || (s ? 'reconciliation') || '|' || (s ? 'integrations') || '|' || (jsonb_typeof(s->'ingestion'->'received') = 'number') || '|' || (jsonb_typeof(s->'integrations'->'export_jobs_stuck') = 'number') from snapshot;" | tail -1)"
if [ "$OPS_HEALTH_SHAPE" = "true|true|true|true|true|true|true|true|true|true" ] || [ "$OPS_HEALTH_SHAPE" = "t|t|t|t|t|t|t|t|t|t" ]; then
  pass "operational health returns aggregate metrics for all six monitored domains (incl. integrations)"
else
  fail "operational health snapshot shape drifted ($OPS_HEALTH_SHAPE)"
fi

OPS_HEALTH_CLAMP="$(psql -d pfe_rls -t -A -c "set role service_role; select (public.get_operational_health_snapshot(1)->>'window_minutes') || '|' || (public.get_operational_health_snapshot(999999)->>'window_minutes');" | tail -1)"
if [ "$OPS_HEALTH_CLAMP" = "5|10080" ]; then
  pass "operational health clamps observation windows to 5 minutes through 7 days"
else
  fail "operational health window bounds drifted ($OPS_HEALTH_CLAMP)"
fi

OPS_HEALTH_ACL="$(psql -d pfe_rls -t -A -c "select has_function_privilege('service_role', 'public.get_operational_health_snapshot(integer)', 'execute') || '|' || has_function_privilege('authenticated', 'public.get_operational_health_snapshot(integer)', 'execute') || '|' || has_function_privilege('anon', 'public.get_operational_health_snapshot(integer)', 'execute');")"
if [ "$OPS_HEALTH_ACL" = "true|false|false" ] || [ "$OPS_HEALTH_ACL" = "t|f|f" ]; then
  pass "operational health snapshot is service-role-only"
else
  fail "operational health snapshot privileges are incorrect ($OPS_HEALTH_ACL)"
fi

# ===========================================================================
# Profile/preferences onboarding: a new user starts at profile, each RPC
# advances exactly one resumable stage, and financial preferences update the
# personal workspace in the same transaction. anon cannot call the RPCs.
# ===========================================================================
echo "=== profile/preferences onboarding ==="

ONBOARDING_USER="$(psql -d pfe_rls -t -A -c "insert into auth.users (email) values ('onboarding@example.com') returning id;" | head -1)"
ONBOARDING_INITIAL="$(psql -d pfe_rls -t -A -c "select onboarding_step || '|' || (onboarding_completed_at is null) from public.profiles where id = '$ONBOARDING_USER';")"
if [ "$ONBOARDING_INITIAL" = "profile|true" ] || [ "$ONBOARDING_INITIAL" = "profile|t" ]; then
  pass "new users start at the profile onboarding stage"
else
  fail "new user onboarding state was $ONBOARDING_INITIAL"
fi

as_user "$ONBOARDING_USER" "select public.save_onboarding_profile('Aline', 'Uwase', 'rw', 'en');" >/dev/null
ONBOARDING_PROFILE="$(psql -d pfe_rls -t -A -c "select first_name || '|' || last_name || '|' || display_name || '|' || country_code || '|' || onboarding_step from public.profiles where id = '$ONBOARDING_USER';")"
if [ "$ONBOARDING_PROFILE" = "Aline|Uwase|Aline Uwase|RW|preferences" ]; then
  pass "profile onboarding persists normalized identity and advances to preferences"
else
  fail "profile onboarding persisted unexpected state ($ONBOARDING_PROFILE)"
fi

as_user "$ONBOARDING_USER" "select public.save_onboarding_preferences('usd', 'Africa/Kigali', 'fr');" >/dev/null
ONBOARDING_PREFS="$(psql -d pfe_rls -t -A -c "select p.preferred_currency || '|' || p.timezone || '|' || p.locale || '|' || p.onboarding_step || '|' || w.default_currency || '|' || w.timezone from public.profiles p join public.workspaces w on w.created_by = p.id and w.kind = 'personal' where p.id = '$ONBOARDING_USER';")"
if [ "$ONBOARDING_PREFS" = "USD|Africa/Kigali|fr|setup|USD|Africa/Kigali" ]; then
  pass "financial preferences and personal workspace advance atomically to setup"
else
  fail "financial preference onboarding drifted ($ONBOARDING_PREFS)"
fi

as_user "$ONBOARDING_USER" "select public.complete_profile_onboarding();" >/dev/null
ONBOARDING_DONE="$(psql -d pfe_rls -t -A -c "select onboarding_step || '|' || (onboarding_completed_at is not null) from public.profiles where id = '$ONBOARDING_USER';")"
if [ "$ONBOARDING_DONE" = "completed|true" ] || [ "$ONBOARDING_DONE" = "completed|t" ]; then
  pass "optional setup can complete onboarding with a durable timestamp"
else
  fail "onboarding completion state was $ONBOARDING_DONE"
fi

ONBOARDING_ACL="$(psql -d pfe_rls -t -A -c "select has_function_privilege('authenticated', 'public.save_onboarding_profile(text,text,text,text)', 'execute') || '|' || has_function_privilege('anon', 'public.save_onboarding_profile(text,text,text,text)', 'execute') || '|' || has_function_privilege('authenticated', 'public.save_onboarding_preferences(text,text,text)', 'execute') || '|' || has_function_privilege('anon', 'public.complete_profile_onboarding()', 'execute');")"
if [ "$ONBOARDING_ACL" = "true|false|true|false" ] || [ "$ONBOARDING_ACL" = "t|f|t|f" ]; then
  pass "onboarding RPCs are authenticated-only"
else
  fail "onboarding RPC privileges are incorrect ($ONBOARDING_ACL)"
fi

# ===========================================================================
# Integrations Phase 1 (20261026000000): the closed Spaces capability
# catalog is extended with 8 integration.* capabilities. This verifies the
# closed matrix for the new names (owner/admin all, member integration.view
# only, viewer none, unknown integration.* fails closed) and that the
# space_member_capability_grants CHECK moves in lockstep with the function.
# Self-contained: its own household + member so it never depends on the
# late state of earlier fixtures.
# ===========================================================================
echo "=== Integrations: integration.* capability catalog ==="

INT_HH="$(as_user "$USER_A" "select public.create_household_workspace('Integrations Catalog HH');")"
INT_MEMBER_USER="$(psql -d pfe_rls -t -A -c "insert into auth.users (email) values ('int-catalog-member@example.com') returning id;" | head -1)"
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; insert into public.workspace_memberships (workspace_id, user_id, role, status, joined_at) values ('$INT_HH', '$INT_MEMBER_USER', 'member', 'active', now());" >/dev/null

INT_MATRIX_MISMATCHES="$(psql -d pfe_rls -t -A -c "
  with capabilities(capability) as (values
    ('integration.view'), ('integration.import'),
    ('integration.import_approve'), ('integration.export'),
    ('integration.configure'), ('integration.connection_manage'),
    ('integration.sync_manage'), ('integration.logs_view')
  ),
  cells(kind, role) as (values
    ('household','owner'), ('household','admin'),
    ('household','member'), ('household','viewer'),
    ('personal','owner'), ('personal','member')
  ),
  expected as (
    select c.kind, c.role, cap.capability,
      case
        when c.kind = 'personal' then c.role = 'owner'
        when c.role in ('owner', 'admin') then true
        when c.role = 'member' then cap.capability = 'integration.view'
        else false
      end as allowed
    from cells c cross join capabilities cap
  )
  select count(*) from expected
  where public.space_role_has_capability(kind, role, capability) is distinct from allowed;")"
INT_UNKNOWN_OWNER="$(psql -d pfe_rls -t -A -c "select public.space_role_has_capability('household', 'owner', 'integration.bogus');")"
INT_MEMBER_VIEW="$(as_user "$INT_MEMBER_USER" "select public.has_space_capability('$INT_HH', 'integration.view');")"
INT_MEMBER_IMPORT="$(as_user "$INT_MEMBER_USER" "select public.has_space_capability('$INT_HH', 'integration.import');")"
if [ "$INT_MATRIX_MISMATCHES" = "0" ] && [ "$INT_UNKNOWN_OWNER" = "f" ] && [ "$INT_MEMBER_VIEW" = "t" ] && [ "$INT_MEMBER_IMPORT" = "f" ]; then
  pass "Integrations: 48 integration.* role/capability cells match (owner/admin all, member view-only, viewer none, unknown fails closed)"
else
  fail "Integrations: integration.* matrix mismatch (cells=$INT_MATRIX_MISMATCHES unknown_owner=$INT_UNKNOWN_OWNER member_view=$INT_MEMBER_VIEW member_import=$INT_MEMBER_IMPORT)"
fi

if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; insert into public.space_member_capability_grants (workspace_id, user_id, capability) values ('$INT_HH', '$INT_MEMBER_USER', 'integration.export');" >/dev/null 2>$ARTIFACT_DIR/pfe_int_grant.log; then
  psql -d pfe_rls -c "set role service_role; delete from public.space_member_capability_grants where workspace_id = '$INT_HH' and user_id = '$INT_MEMBER_USER' and capability = 'integration.export';" >/dev/null
  pass "Integrations: the grants CHECK accepts a known integration.* capability"
else
  fail "Integrations: the grants CHECK rejected integration.export"
fi
rm -f $ARTIFACT_DIR/pfe_int_grant.log

if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; insert into public.space_member_capability_grants (workspace_id, user_id, capability) values ('$INT_HH', '$INT_MEMBER_USER', 'integration.bogus');" >/dev/null 2>$ARTIFACT_DIR/pfe_int_bogus.log; then
  fail "Integrations: the grants CHECK accepted an unknown integration.* capability"
else
  pass "Integrations: the grants CHECK rejects a capability outside the extended catalog"
fi
rm -f $ARTIFACT_DIR/pfe_int_bogus.log

# ===========================================================================
# Integrations Phase 1 (20261027000000): the import/export data model.
# RLS is SELECT-only for authenticated and gated on integration.view, so a
# Space viewer sees nothing and another tenant sees nothing. Also proves
# transactions accepts source='import' with import_batch_id lineage and
# rejects import_batch_id on a non-import row. Reuses INT_HH (USER_A owner,
# INT_MEMBER_USER member) plus USER_A's personal WORKSPACE_A / U_SRC / U_ACCT.
# ===========================================================================
echo "=== Integrations: import/export model + RLS ==="

INT_VIEWER_USER="$(psql -d pfe_rls -t -A -c "insert into auth.users (email) values ('int-catalog-viewer@example.com') returning id;" | head -1)"
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; insert into public.workspace_memberships (workspace_id, user_id, role, status, joined_at) values ('$INT_HH', '$INT_VIEWER_USER', 'viewer', 'active', now());" >/dev/null

INT_BATCH="$(psql -d pfe_rls -t -A -c "insert into public.import_batches (workspace_id, created_by, source_kind, original_filename, status) values ('$INT_HH', '$USER_A', 'csv', 'august.csv', 'uploaded') returning id;" | head -1)"
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; insert into public.import_records (import_batch_id, workspace_id, row_index, status) values ('$INT_BATCH', '$INT_HH', 0, 'needs_mapping');" >/dev/null
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "set role service_role; insert into public.integration_events (workspace_id, kind, summary) values ('$INT_HH', 'import.uploaded', 'august.csv uploaded');" >/dev/null

INT_MEMBER_SEES_BATCH="$(as_user "$INT_MEMBER_USER" "select count(*) from public.import_batches where id = '$INT_BATCH';")"
INT_MEMBER_SEES_RECORD="$(as_user "$INT_MEMBER_USER" "select count(*) from public.import_records where import_batch_id = '$INT_BATCH';")"
INT_MEMBER_SEES_EVENT="$(as_user "$INT_MEMBER_USER" "select count(*) from public.integration_events where workspace_id = '$INT_HH';")"
INT_VIEWER_SEES="$(as_user "$INT_VIEWER_USER" "select count(*) from public.import_batches where id = '$INT_BATCH';")"
INT_OUTSIDER_SEES="$(as_user "$USER_B" "select count(*) from public.import_batches where id = '$INT_BATCH';")"
if [ "$INT_MEMBER_SEES_BATCH" = "1" ] && [ "$INT_MEMBER_SEES_RECORD" = "1" ] && [ "$INT_MEMBER_SEES_EVENT" = "1" ] && [ "$INT_VIEWER_SEES" = "0" ] && [ "$INT_OUTSIDER_SEES" = "0" ]; then
  pass "Integrations: import_batches/records/events are readable by a member with integration.view, hidden from a Space viewer and from another tenant"
else
  fail "Integrations: import model RLS wrong (member b/r/e=$INT_MEMBER_SEES_BATCH/$INT_MEMBER_SEES_RECORD/$INT_MEMBER_SEES_EVENT viewer=$INT_VIEWER_SEES outsider=$INT_OUTSIDER_SEES)"
fi

# a member cannot write directly - every write is a service-role / RPC path.
if as_user "$INT_MEMBER_USER" "insert into public.import_batches (workspace_id, created_by, source_kind, original_filename) values ('$INT_HH', '$INT_MEMBER_USER', 'csv', 'sneaky.csv');" >/dev/null 2>$ARTIFACT_DIR/pfe_int_write.log; then
  fail "Integrations: a member inserted directly into import_batches (should be RPC/service-role only)"
else
  pass "Integrations: import_batches has no authenticated INSERT path"
fi
rm -f $ARTIFACT_DIR/pfe_int_write.log

# transactions carries import lineage.
INT_LEDGER_BATCH="$(psql -d pfe_rls -t -A -c "insert into public.import_batches (workspace_id, created_by, source_kind, original_filename, status) values ('$WORKSPACE_A', '$USER_A', 'csv', 'ledger.csv', 'imported') returning id;" | head -1)"
if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  insert into public.transactions (source, import_batch_id, financial_source_id, account_id, workspace_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version)
  values ('import', '$INT_LEDGER_BATCH', '$U_SRC', '$U_ACCT', '$WORKSPACE_A', 'merchant_payment', 'out', 'success', 4200, 0, '2026-08-23T10:00:00Z', 'import-v1');" >/dev/null 2>$ARTIFACT_DIR/pfe_int_txn.log; then
  pass "Integrations: transactions accepts source='import' with import_batch_id and no momo_message_id"
else
  fail "Integrations: a valid source='import' transaction was rejected ($(cat $ARTIFACT_DIR/pfe_int_txn.log))"
fi
rm -f $ARTIFACT_DIR/pfe_int_txn.log

if psql -d pfe_rls -v ON_ERROR_STOP=1 -c "
  set role service_role;
  insert into public.transactions (source, import_batch_id, financial_source_id, account_id, workspace_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version)
  values ('manual', '$INT_LEDGER_BATCH', '$U_SRC', '$U_ACCT', '$WORKSPACE_A', 'merchant_payment', 'out', 'success', 100, 0, '2026-08-23T11:00:00Z', 'import-v1');" >/dev/null 2>$ARTIFACT_DIR/pfe_int_txn2.log; then
  fail "Integrations: import_batch_id was accepted on a source='manual' row (transactions_import_batch_only_for_import missing)"
else
  pass "Integrations: import_batch_id is rejected on a non-import transaction"
fi
rm -f $ARTIFACT_DIR/pfe_int_txn2.log

# 20261028000000: the private import-source bucket exists and is not public.
INT_BUCKET="$(psql -d pfe_rls -t -A -c "select count(*) from storage.buckets where id = 'integration-imports' and public = false;")"
if [ "$INT_BUCKET" = "1" ]; then
  pass "Integrations: the private integration-imports storage bucket is registered (public = false)"
else
  fail "Integrations: integration-imports bucket missing or public (got $INT_BUCKET)"
fi

# ===========================================================================
# Integrations Phase 1 (20261029000000): commit_import_batch /
# rollback_import_batch. Uses WORKSPACE_A (USER_A personal owner) and
# USER_A's U_SRC -> U_ACCT from the Phase U PR7 fixture.
# ===========================================================================
echo "=== Integrations: commit / rollback import batch ==="

INT_CB="$(psql -d pfe_rls -t -A -c "insert into public.import_batches (workspace_id, financial_source_id, created_by, source_kind, original_filename, status) values ('$WORKSPACE_A', '$U_SRC', '$USER_A', 'csv', 'commit.csv', 'validated') returning id;" | grep -Eo '[0-9a-f-]{36}' | head -1)"
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "insert into public.import_records (import_batch_id, workspace_id, row_index, status, normalized) values ('$INT_CB', '$WORKSPACE_A', 0, 'ready', '{\"occurred_at\":\"2026-08-09T09:00:00Z\",\"amount_minor\":1500,\"direction\":\"out\",\"merchant\":\"UNIQUE MERCHANT\"}'::jsonb), ('$INT_CB', '$WORKSPACE_A', 1, 'ready', '{\"occurred_at\":\"2026-08-10T09:00:00Z\",\"amount_minor\":4200,\"direction\":\"out\",\"merchant\":\"DUP MERCHANT\"}'::jsonb), ('$INT_CB', '$WORKSPACE_A', 2, 'invalid', '{}'::jsonb);" >/dev/null

INT_DUP_FP="$(psql -d pfe_rls -t -A -c "set role service_role; select public.compute_transaction_fingerprint('mtn_momo','',4200,'RWF','out','DUP MERCHANT','2026-08-10T09:00:00Z'::timestamptz);" | tail -1)"
psql -d pfe_rls -v ON_ERROR_STOP=1 -c "insert into public.transactions (source, financial_source_id, account_id, workspace_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version, counterparty_name, dedupe_fingerprint) values ('manual', '$U_SRC', '$U_ACCT', '$WORKSPACE_A', 'other', 'out', 'success', 4200, 0, '2026-08-10T09:00:00Z', 'test', 'DUP MERCHANT', '$INT_DUP_FP');" >/dev/null

INT_COMMIT="$(as_user "$USER_A" "select (j->>'created')||','||(j->>'flagged_possible_duplicate')||','||(j->>'skipped') from (select public.commit_import_batch('$INT_CB') as j) s;")"
INT_TXN_COUNT="$(psql -d pfe_rls -t -A -c "select count(*) from public.transactions where import_batch_id = '$INT_CB' and source = 'import';")"
INT_DUP_STATE="$(psql -d pfe_rls -t -A -c "select count(*) from public.transactions where import_batch_id = '$INT_CB' and dedupe_state = 'possible_duplicate';")"
INT_BATCH_STATUS="$(psql -d pfe_rls -t -A -c "select status from public.import_batches where id = '$INT_CB';")"
INT_COMMIT_AUDIT="$(psql -d pfe_rls -t -A -c "select count(*) from public.space_audit_events where workspace_id = '$WORKSPACE_A' and event_type = 'import.committed' and resource_id = '$INT_CB';")"
if [ "$INT_COMMIT" = "2,1,0" ] && [ "$INT_TXN_COUNT" = "2" ] && [ "$INT_DUP_STATE" = "1" ] && [ "$INT_BATCH_STATUS" = "imported" ] && [ "$INT_COMMIT_AUDIT" = "1" ]; then
  pass "Integrations: commit_import_batch creates one transaction per ready row, flags the Space fingerprint match, sets the batch imported, audits import.committed"
else
  fail "Integrations: commit wrong (result=$INT_COMMIT txns=$INT_TXN_COUNT dup=$INT_DUP_STATE status=$INT_BATCH_STATUS audit=$INT_COMMIT_AUDIT)"
fi

INT_RECOMMIT="$(as_user "$USER_A" "select (j->>'created') from (select public.commit_import_batch('$INT_CB') as j) s;")"
INT_TXN_COUNT2="$(psql -d pfe_rls -t -A -c "select count(*) from public.transactions where import_batch_id = '$INT_CB';")"
if [ "$INT_RECOMMIT" = "0" ] && [ "$INT_TXN_COUNT2" = "2" ]; then
  pass "Integrations: re-committing the same batch is a no-op (payload_hash idempotency)"
else
  fail "Integrations: re-commit not idempotent (created=$INT_RECOMMIT txns=$INT_TXN_COUNT2)"
fi

if as_user "$USER_B" "select public.commit_import_batch('$INT_CB');" >/dev/null 2>$ARTIFACT_DIR/pfe_int_commit.log; then
  fail "Integrations: a non-member committed an import batch"
else
  pass "Integrations: commit_import_batch refuses a caller without integration.import_approve"
fi
rm -f $ARTIFACT_DIR/pfe_int_commit.log

psql -d pfe_rls -v ON_ERROR_STOP=1 -c "update public.transactions set category = 'Coffee', category_source = 'manual' where import_batch_id = '$INT_CB' and dedupe_state = 'unique';" >/dev/null
INT_ROLLBACK="$(as_user "$USER_A" "select (j->>'removed')||','||(j->>'retained')||','||(j->>'complete') from (select public.rollback_import_batch('$INT_CB') as j) s;")"
INT_LEFT="$(psql -d pfe_rls -t -A -c "select count(*) from public.transactions where import_batch_id = '$INT_CB';")"
INT_RB_STATUS="$(psql -d pfe_rls -t -A -c "select status from public.import_batches where id = '$INT_CB';")"
INT_RB_AUDIT="$(psql -d pfe_rls -t -A -c "select count(*) from public.space_audit_events where workspace_id = '$WORKSPACE_A' and event_type = 'import.rolled_back' and resource_id = '$INT_CB';")"
if [ "$INT_ROLLBACK" = "1,1,false" ] && [ "$INT_LEFT" = "1" ] && [ "$INT_RB_STATUS" = "imported" ] && [ "$INT_RB_AUDIT" = "1" ]; then
  pass "Integrations: rollback_import_batch removes untouched rows, retains the hand-edited one, keeps the batch imported, audits import.rolled_back"
else
  fail "Integrations: rollback wrong (result=$INT_ROLLBACK left=$INT_LEFT status=$INT_RB_STATUS audit=$INT_RB_AUDIT)"
fi

# 20261030000000: the private export bucket exists and is not public.
INT_EXP_BUCKET="$(psql -d pfe_rls -t -A -c "select count(*) from storage.buckets where id = 'integration-exports' and public = false;")"
if [ "$INT_EXP_BUCKET" = "1" ]; then
  pass "Integrations: the private integration-exports storage bucket is registered (public = false)"
else
  fail "Integrations: integration-exports bucket missing or public (got $INT_EXP_BUCKET)"
fi

# 20261031000000: export_schedules RLS mirrors the rest of the model.
INT_SCHED="$(psql -d pfe_rls -t -A -c "insert into public.export_schedules (workspace_id, created_by, name, cadence, hour, next_run_at) values ('$INT_HH', '$USER_A', 'Monthly', 'monthly', 6, now() + interval '1 day') returning id;" | grep -Eo '[0-9a-f-]{36}' | head -1)"
INT_SCHED_MEMBER="$(as_user "$INT_MEMBER_USER" "select count(*) from public.export_schedules where id = '$INT_SCHED';")"
INT_SCHED_VIEWER="$(as_user "$INT_VIEWER_USER" "select count(*) from public.export_schedules where id = '$INT_SCHED';")"
INT_SCHED_OUTSIDER="$(as_user "$USER_B" "select count(*) from public.export_schedules where id = '$INT_SCHED';")"
if [ "$INT_SCHED_MEMBER" = "1" ] && [ "$INT_SCHED_VIEWER" = "0" ] && [ "$INT_SCHED_OUTSIDER" = "0" ]; then
  pass "Integrations: export_schedules is readable by a member with integration.view, hidden from a Space viewer and another tenant"
else
  fail "Integrations: export_schedules RLS wrong (member=$INT_SCHED_MEMBER viewer=$INT_SCHED_VIEWER outsider=$INT_SCHED_OUTSIDER)"
fi

echo ""
echo "=== summary: $PASS_COUNT passed, $FAIL_COUNT failed ==="
if [ "$FAIL_COUNT" -ne 0 ]; then
  exit 1
fi
