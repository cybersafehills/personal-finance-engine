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
# created here is a disposable, local, throwaway cluster torn down at the
# end of the script (or on any failure, via the trap below).
#
# PREREQUISITES: PostgreSQL 17.x client+server binaries on PATH (or set
# PG_BIN_DIR to their directory - e.g. Homebrew's
# /opt/homebrew/opt/postgresql@17/bin). Version 17 is required to match
# the linked project's Postgres engine (see supabase/config.toml
# major_version). If unavailable, this script exits with a clear message
# rather than silently testing against a mismatched version - it does not
# fall back to Docker (also not required/used here).
#
# USAGE:
#   supabase/migrations/tests/run_migration_tests.sh
#
# Exit code 0 = every lettered test (A-I) passed. Nonzero = see output for
# which test failed; no cleanup is skipped either way.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$(cd "$SCRIPT_DIR/../" && pwd)"
REPO_ROOT="$(cd "$MIGRATIONS_DIR/../.." && pwd)"

PG_BIN_DIR="${PG_BIN_DIR:-/opt/homebrew/opt/postgresql@17/bin}"

if [ ! -x "$PG_BIN_DIR/pg_ctl" ]; then
  # Fall back to whatever is on PATH, but require it to report major
  # version 17 - a mismatched pg_dump/pg_ctl against this schema is not a
  # meaningful test of production compatibility.
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

PASS_COUNT=0
FAIL_COUNT=0

pass() { echo "PASS: $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo "FAIL: $1" >&2; FAIL_COUNT=$((FAIL_COUNT + 1)); }

cleanup() {
  pg_ctl -D "$WORKDIR/pgdata" stop -m fast >/dev/null 2>&1 || true
  rm -rf "$WORKDIR" "$SOCK_DIR"
}
trap cleanup EXIT

echo "=== bootstrapping disposable PostgreSQL 17 cluster ==="
initdb -D "$WORKDIR/pgdata" -U postgres --auth=trust --locale=C -E UTF8 >/dev/null
pg_ctl -D "$WORKDIR/pgdata" -o "-p $PGPORT_TEST -c listen_addresses='' -k $SOCK_DIR" -l "$WORKDIR/pg.log" start >/dev/null

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
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
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
DUMP1="$WORKDIR/i1.sql"
pg_dump -d pfe_i1 --schema-only --no-owner -n public > "$DUMP1"

bootstrap_db "pfe_i2"
apply_chain "pfe_i2"
DUMP2="$WORKDIR/i2.sql"
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

echo ""
echo "=== summary: $PASS_COUNT passed, $FAIL_COUNT failed ==="
if [ "$FAIL_COUNT" -ne 0 ]; then
  exit 1
fi
