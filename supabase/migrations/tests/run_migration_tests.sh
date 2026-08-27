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
create or replace function auth.uid()
returns uuid
language sql
stable
as \$\$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
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
-- 20260903000000_phase_k_report_artifacts.sql's
-- `insert into storage.buckets (...)`) - just enough columns to satisfy
-- that one insert. Real Supabase provisions the full Storage API schema;
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
if [ "$TABLE_COUNT" = "60" ] && [ "$TABLES_WITHOUT_RLS" = "auth_login_attempts" ]; then
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
AUTHENTICATED_GRANT_COUNT="$(psql -d pfe_h -t -A -c "select count(*) from information_schema.role_table_grants where table_schema='public' and grantee = 'authenticated';")"
if [ "$AUTHENTICATED_GRANT_COUNT" = "99" ]; then
  pass "authenticated holds exactly the 99 table grants expected, no more"
else
  fail "authenticated holds $AUTHENTICATED_GRANT_COUNT table grant(s), expected exactly 99 - review for unintended privilege expansion"
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
AUTHENTICATED_FN_EXEC_COUNT="$(psql -d pfe_h -t -A -c "select count(*) from pg_proc p join pg_roles r on r.rolname = 'authenticated' where p.pronamespace='public'::regnamespace and has_function_privilege(r.oid, p.oid, 'EXECUTE');")"
if [ "$AUTHENTICATED_FN_EXEC_COUNT" = "48" ]; then
  pass "authenticated holds EXECUTE on exactly the 48 functions expected, no more"
else
  fail "authenticated holds EXECUTE on $AUTHENTICATED_FN_EXEC_COUNT function(s), expected exactly 48 - review for unintended privilege expansion"
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
  psql -d pfe_rls -t -A -c "set role authenticated; select set_config('request.jwt.claim.sub', '$user_id', false); $sql" \
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
" >/dev/null

CONN_A="$(as_user "$USER_A" "insert into public.ingestion_connections (workspace_id, account_id, label, credential_hash, credential_prefix, created_by) values ('$WORKSPACE_A', '00000000-0000-0000-0000-0000000000d1', 'A''s Phone', 'hash-a-conn-1', 'pfe_aaaa', '$USER_A') returning id;" | tail -1)"
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

# A plain user sees the published eKash network but not the draft participation.
P_NET="$(as_user "$USER_A" "select count(*) from public.payment_networks where slug = 'ekash';")"
P_PART="$(as_user "$USER_A" "select count(*) from public.institution_network_participation where payment_network_id = '$P_EKASH';")"
if [ "$P_NET" = "1" ] && [ "$P_PART" = "0" ]; then
  pass "Phase P: a non-admin sees the published eKash network but not its draft participation rows (RLS)"
else
  fail "Phase P: non-admin network visibility wrong (network=$P_NET participation=$P_PART, expected 1/0)"
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

echo ""
echo "=== summary: $PASS_COUNT passed, $FAIL_COUNT failed ==="
if [ "$FAIL_COUNT" -ne 0 ]; then
  exit 1
fi
