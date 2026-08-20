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
    for db in pfe_h pfe_g pfe_ade pfe_i1 pfe_i2; do
      psql -d postgres -c "drop database if exists \"$db\";" >/dev/null 2>&1 || true
    done
    rm -rf "$ARTIFACT_DIR"
  }
  trap cleanup EXIT
fi

apply_chain() {
  local dbname="$1"
  for f in "$MIGRATIONS_DIR"/*.sql; do
    psql -d "$dbname" -v ON_ERROR_STOP=1 -f "$f" >/dev/null
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
RLS_COUNT="$(psql -d pfe_h -t -A -c "select count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r' and relrowsecurity;")"
TABLE_COUNT="$(psql -d pfe_h -t -A -c "select count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r';")"
if [ "$RLS_COUNT" = "$TABLE_COUNT" ] && [ "$TABLE_COUNT" = "6" ]; then
  pass "RLS enabled on all 6 tables after the full chain"
else
  fail "RLS not enabled on all tables: $RLS_COUNT of $TABLE_COUNT public tables have RLS enabled (expected 6 of 6)"
fi

ANON_GRANT_COUNT="$(psql -d pfe_h -t -A -c "select count(*) from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated');")"
if [ "$ANON_GRANT_COUNT" = "0" ]; then
  pass "no anon/authenticated grants remain on any public table after the full chain"
else
  fail "anon/authenticated still hold $ANON_GRANT_COUNT grant(s) after the full chain - hardening regression"
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

EXISTING_FN_EXEC_COUNT="$(psql -d pfe_h -t -A -c "select count(*) from pg_proc p join pg_roles r on r.rolname in ('anon','authenticated') where p.pronamespace='public'::regnamespace and has_function_privilege(r.oid, p.oid, 'EXECUTE');")"
if [ "$EXISTING_FN_EXEC_COUNT" = "0" ]; then
  pass "anon/authenticated hold no EXECUTE on any existing public-schema function after the full chain"
else
  fail "anon/authenticated still hold EXECUTE on $EXISTING_FN_EXEC_COUNT existing function grant(s) after the full chain"
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

echo ""
echo "=== summary: $PASS_COUNT passed, $FAIL_COUNT failed ==="
if [ "$FAIL_COUNT" -ne 0 ]; then
  exit 1
fi
