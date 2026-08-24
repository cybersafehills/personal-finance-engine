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
if [ "$RLS_COUNT" = "$TABLE_COUNT" ] && [ "$TABLE_COUNT" = "17" ]; then
  pass "RLS enabled on all 17 tables after the full chain (6 Phase 3 + 3 Phase B + 1 Phase C + 7 Phase D: budget_templates, budget_template_allocations, budgets, budget_allocations, budget_category_mappings, financial_goals, goal_contributions)"
else
  fail "RLS not enabled on all tables: $RLS_COUNT of $TABLE_COUNT public tables have RLS enabled (expected 17 of 17)"
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
# = 18 more, for 34 total. Asserting the exact count (not just "some")
# forces this test to be updated - a deliberate review point - if any
# future migration ever widens authenticated's table-level access.
AUTHENTICATED_GRANT_COUNT="$(psql -d pfe_h -t -A -c "select count(*) from information_schema.role_table_grants where table_schema='public' and grantee = 'authenticated';")"
if [ "$AUTHENTICATED_GRANT_COUNT" = "34" ]; then
  pass "authenticated holds exactly the 34 Phase B + Phase C + Phase D table grants expected, no more"
else
  fail "authenticated holds $AUTHENTICATED_GRANT_COUNT table grant(s), expected exactly 34 - review for unintended privilege expansion"
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

ANON_FN_EXEC_COUNT="$(psql -d pfe_h -t -A -c "select count(*) from pg_proc p join pg_roles r on r.rolname = 'anon' where p.pronamespace='public'::regnamespace and has_function_privilege(r.oid, p.oid, 'EXECUTE');")"
if [ "$ANON_FN_EXEC_COUNT" = "0" ]; then
  pass "anon holds no EXECUTE on any public-schema function after the full chain"
else
  fail "anon still holds EXECUTE on $ANON_FN_EXEC_COUNT function grant(s) after the full chain"
fi

# authenticated legitimately gains EXECUTE on exactly one function in
# Phase B - is_workspace_member(), the RLS policies' own authorization
# primitive (every policy above calls it, so authenticated must be able
# to execute it). Every other existing function (set_updated_at,
# handle_new_user) remains authenticated-inaccessible.
AUTHENTICATED_FN_EXEC_COUNT="$(psql -d pfe_h -t -A -c "select count(*) from pg_proc p join pg_roles r on r.rolname = 'authenticated' where p.pronamespace='public'::regnamespace and has_function_privilege(r.oid, p.oid, 'EXECUTE');")"
if [ "$AUTHENTICATED_FN_EXEC_COUNT" = "1" ]; then
  pass "authenticated holds EXECUTE on exactly one function (is_workspace_member) after the full chain"
else
  fail "authenticated holds EXECUTE on $AUTHENTICATED_FN_EXEC_COUNT function(s), expected exactly 1 (is_workspace_member) - review for unintended privilege expansion"
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

echo ""
echo "=== summary: $PASS_COUNT passed, $FAIL_COUNT failed ==="
if [ "$FAIL_COUNT" -ne 0 ]; then
  exit 1
fi
