#!/usr/bin/env bash
# Isolated-PostgreSQL integration tests for the Phase 4.1 accounting
# backfill tool (scripts/phase-4-1-accounting-backfill.ts).
#
# WHAT THIS PROVES: against a disposable, version-matched (PostgreSQL 17)
# cluster with the full migration chain applied and seeded with
# representative transaction shapes, the backfill tool's plan/execute/
# rollback pipeline computes correct accounting effects (via the same
# canonical computeAccountingEffect() used everywhere else), writes only
# the rows it should, leaves already-processed rows untouched, safely
# excludes the unsupported incoming-with-fee case, detects and refuses a
# row that changed between plan and execute (compare-and-set), is
# idempotent on rerun, and can be rolled back precisely.
#
# WHAT THIS NEVER DOES: touch the linked Supabase project. This spawns and
# tears down its own throwaway PostgreSQL cluster, exactly like
# supabase/migrations/tests/run_migration_tests.sh's default "spawn" mode
# (this script is intentionally a focused sibling of that harness, not a
# generalization of it - one-off test infrastructure, not shared code).
#
# USAGE:
#   scripts/tests/run_backfill_tests.sh
#
# Requires PostgreSQL 17 pg_ctl/initdb/psql on PATH (or set PG_BIN_DIR),
# and Deno on PATH.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$(cd "$SCRIPT_DIR/../" && pwd)"
REPO_ROOT="$(cd "$SCRIPTS_DIR/../" && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"

PG_BIN_DIR="${PG_BIN_DIR:-/opt/homebrew/opt/postgresql@17/bin}"
if [ ! -x "$PG_BIN_DIR/pg_ctl" ]; then
  if command -v pg_ctl >/dev/null 2>&1; then
    PG_BIN_DIR="$(dirname "$(command -v pg_ctl)")"
  else
    echo "FAIL: no PostgreSQL 17 pg_ctl found. Set PG_BIN_DIR or install postgresql@17." >&2
    exit 1
  fi
fi
export PATH="$PG_BIN_DIR:$PATH"

PG_VERSION_MAJOR="$("$PG_BIN_DIR/postgres" --version | grep -oE '[0-9]+' | head -1)"
if [ "$PG_VERSION_MAJOR" != "17" ]; then
  echo "FAIL: found PostgreSQL major version $PG_VERSION_MAJOR at $PG_BIN_DIR, need 17." >&2
  exit 1
fi

WORKDIR="$(mktemp -d /tmp/pfe_backfill_tests.XXXXXX)"
SOCK_DIR="$(mktemp -d /tmp/pfe_backfill_tests_sock.XXXXXX)"
PGPORT_TEST=55700
export PGHOST="$SOCK_DIR"
export PGPORT="$PGPORT_TEST"
export PGUSER=postgres
export PGDATABASE=pfe_backfill_test

cleanup() {
  pg_ctl -D "$WORKDIR/pgdata" stop -m fast >/dev/null 2>&1 || true
  rm -rf "$WORKDIR" "$SOCK_DIR"
}
trap cleanup EXIT

echo "=== bootstrapping disposable PostgreSQL 17 cluster ==="
initdb -D "$WORKDIR/pgdata" -U postgres --auth=trust --locale=C -E UTF8 >/dev/null
pg_ctl -D "$WORKDIR/pgdata" -o "-p $PGPORT_TEST -c listen_addresses='' -k $SOCK_DIR" -l "$WORKDIR/pg.log" start >/dev/null

for i in $(seq 1 30); do
  if psql -d postgres -h "$SOCK_DIR" -p "$PGPORT_TEST" -U postgres -c "select 1" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

createdb -h "$SOCK_DIR" -p "$PGPORT_TEST" -U postgres "$PGDATABASE"

# Mirrors supabase/migrations/tests/run_migration_tests.sh's bootstrap_db:
# the migration chain assumes the Supabase-platform-managed anon/
# authenticated/service_role roles and their default privileges already
# exist (they do on the linked production project, created by the
# platform, not by any migration in this repo) - a disposable cluster
# needs the same seeding or the chain fails on the first grant statement.
psql -d postgres -h "$SOCK_DIR" -p "$PGPORT_TEST" -U postgres -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
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
psql -d "$PGDATABASE" -h "$SOCK_DIR" -p "$PGPORT_TEST" -U postgres -v ON_ERROR_STOP=1 >/dev/null <<SQL
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
alter database "$PGDATABASE" set search_path to public, extensions;
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
SQL

echo "=== applying migration chain ==="
for f in "$MIGRATIONS_DIR"/*.sql; do
  psql -v ON_ERROR_STOP=1 -h "$SOCK_DIR" -p "$PGPORT_TEST" -U postgres -d "$PGDATABASE" -f "$f" >/dev/null
done

echo "=== seeding representative transaction shapes ==="
psql -v ON_ERROR_STOP=1 -h "$SOCK_DIR" -p "$PGPORT_TEST" -U postgres -d "$PGDATABASE" <<'SQL' >/dev/null
insert into momo_messages (id, raw_message, server_received_at, processing_status)
values
  (gen_random_uuid(), 'seed message A', now(), 'processed'),
  (gen_random_uuid(), 'seed message B', now(), 'processed'),
  (gen_random_uuid(), 'seed message C', now(), 'processed'),
  (gen_random_uuid(), 'seed message D', now(), 'processed'),
  (gen_random_uuid(), 'seed message E', now(), 'processed'),
  (gen_random_uuid(), 'seed message F', now(), 'processed'),
  (gen_random_uuid(), 'seed message G', now(), 'processed'),
  (gen_random_uuid(), 'seed message H', now(), 'processed');

-- A. unprocessed, settled-outgoing-with-fee (eligible)
insert into transactions (id, momo_message_id, external_transaction_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version)
select '00000000-0000-0000-0000-00000000000a', id, 'TXA', 'send_money', 'out', 'success', 5000, 100, now(), 'test'
from momo_messages where raw_message = 'seed message A';

-- B. unprocessed, settled-incoming-no-fee (eligible)
insert into transactions (id, momo_message_id, external_transaction_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version)
select '00000000-0000-0000-0000-00000000000b', id, 'TXB', 'money_received', 'in', 'success', 10000, 0, now(), 'test'
from momo_messages where raw_message = 'seed message B';

-- C. unprocessed, failed (eligible, zero effect)
insert into transactions (id, momo_message_id, external_transaction_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version)
select '00000000-0000-0000-0000-00000000000c', id, 'TXC', 'send_money', 'out', 'failed', 2000, 0, now(), 'test'
from momo_messages where raw_message = 'seed message C';

-- D. already fully processed (must be skipped)
insert into transactions (id, momo_message_id, external_transaction_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version, principal_effect_rwf, fee_effect_rwf, settlement_state, affects_balance, effect_reason)
select '00000000-0000-0000-0000-00000000000d', id, 'TXD', 'send_money', 'out', 'success', 3000, 0, now(), 'test', -3000, 0, 'settled', true, 'settled_outgoing_no_fee'
from momo_messages where raw_message = 'seed message D';

-- E. unsupported: incoming with nonzero fee (must be excluded, never written)
insert into transactions (id, momo_message_id, external_transaction_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version)
select '00000000-0000-0000-0000-00000000000e', id, 'TXE', 'money_received', 'in', 'success', 7000, 50, now(), 'test'
from momo_messages where raw_message = 'seed message E';

-- F. neutral direction, zero amount (eligible - deterministic no-effect)
insert into transactions (id, momo_message_id, external_transaction_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version)
select '00000000-0000-0000-0000-00000000000f', id, 'TXF', 'other', 'neutral', 'unknown', 0, 0, now(), 'test'
from momo_messages where raw_message = 'seed message F';

-- G. will be mutated between plan and execute to simulate a concurrent
-- state change (CAS conflict target)
insert into transactions (id, momo_message_id, external_transaction_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version)
select '00000000-0000-0000-0000-000000000010', id, 'TXG', 'send_money', 'out', 'success', 1000, 0, now(), 'test'
from momo_messages where raw_message = 'seed message G';

-- H. simulates a row already updated by a prior partial execution (used to
-- prove idempotent rerun treats it as a benign no-op, not an error)
insert into transactions (id, momo_message_id, external_transaction_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version)
select '00000000-0000-0000-0000-000000000011', id, 'TXH', 'send_money', 'out', 'success', 4000, 0, now(), 'test'
from momo_messages where raw_message = 'seed message H';
SQL

echo "=== running backfill tool integration tests (deno test) ==="
cd "$REPO_ROOT"
deno test --allow-net --allow-env --allow-read --allow-write --allow-sys \
  "$SCRIPTS_DIR/tests/phase_4_1_backfill_test.ts"

echo "=== all backfill integration tests passed ==="
