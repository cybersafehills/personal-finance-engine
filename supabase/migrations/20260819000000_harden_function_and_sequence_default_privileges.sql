-- Closes a residual gap discovered while investigating the Phase 3
-- default-privilege finding: 20260818130200_revoke_anon_authenticated_
-- privileges.sql only reset the postgres-owned default privilege for
-- TABLES (`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
-- REVOKE ALL ON TABLES FROM anon, authenticated`). Read-only introspection
-- of the linked production project (pg_default_acl) found the SAME
-- postgres-owned entry still auto-grants anon/authenticated on FUNCTIONS
-- (EXECUTE) and SEQUENCES (USAGE/SELECT/UPDATE) created in schema public -
-- confirmed live: both existing functions (set_updated_at,
-- rls_auto_enable) currently show anon/authenticated holding EXECUTE,
-- inherited entirely from this default, not from any explicit GRANT
-- anyone wrote.
--
-- Neither function is exploitable via that grant today - both are
-- trigger/event-trigger functions that Postgres only ever invokes through
-- the trigger/event-trigger mechanism, never via a normal role-issued
-- function call (`SELECT set_updated_at()` errors outside trigger
-- context; the same applies to event-trigger functions). Revoking direct
-- EXECUTE here does not affect the `set_updated_at` BEFORE UPDATE
-- triggers or the `ensure_rls` event trigger - trigger invocation does
-- not go through an EXECUTE privilege check on the invoking role. But any
-- FUTURE ordinary callable function added to `public` (e.g. an RPC-style
-- helper) would otherwise inherit the same unwanted EXECUTE grant by
-- default. Closing this now, rather than after such a function exists,
-- means it is never exposed even briefly.
--
-- No sequences exist in this schema today - every primary key uses
-- gen_random_uuid(), not serial/bigserial - so the sequence-scoped
-- default is currently inert. Reset here too for the same
-- future-proofing reason; it costs nothing to do now. Unlike functions
-- (see below), sequences have no PUBLIC-by-default quirk to work around -
-- the schema-scoped REVOKE alone is sufficient, confirmed by local
-- testing (create a sequence after the full chain; anon/authenticated
-- hold no USAGE on it).
--
-- IMPORTANT DISCOVERY, EMPIRICALLY VERIFIED LOCALLY (not merely read from
-- documentation) before writing this migration: PostgreSQL grants EXECUTE
-- on every newly created function to the PUBLIC pseudo-role
-- UNCONDITIONALLY, and a SCHEMA-SCOPED
-- `ALTER DEFAULT PRIVILEGES ... IN SCHEMA public REVOKE ... FROM PUBLIC`
-- does NOT suppress this - verified by creating functions after such a
-- revoke and finding PUBLIC still present in their ACL every time. The
-- only way found to suppress it is a GLOBAL (no `IN SCHEMA` clause)
-- default-privilege revoke for the role, which composes correctly
-- alongside the schema-scoped grants used everywhere else in this
-- project. Because `anon` and `authenticated` are ordinary roles with no
-- special exemption from PUBLIC-inherited privileges, they would
-- otherwise regain EXECUTE on every future public-schema function via
-- PUBLIC alone, even with the anon/authenticated-specific schema-scoped
-- revoke below correctly in place - this statement is not redundant with
-- that one, it closes a genuinely separate hole.
alter default privileges for role postgres
  revoke execute on functions from public;

alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

-- Also revoke on the two functions that already exist today, closing the
-- currently-live (if not currently exploitable) grant, not just future
-- ones. Both are owned by `postgres`, so this is within this project's
-- own authority - unlike the supabase_admin-owned entries documented in
-- supabase/migrations/README.md. PUBLIC must be revoked explicitly here
-- too, for the same reason as above - an object-level REVOKE naming only
-- anon/authenticated would leave PUBLIC's own grant (and therefore
-- anon/authenticated's inherited access through it) untouched.
revoke all on function public.set_updated_at() from anon, authenticated, public;

-- rls_auto_enable() is provisioned by the Supabase platform itself (see
-- 20260818000000_baseline_existing_schema.sql, item 3) and deliberately
-- not recreated by this repository's own baseline migration, so it may
-- not exist in every environment this chain runs against (e.g. a fresh
-- local/disposable database used for testing). Guard the revoke so this
-- migration remains valid whether or not the platform has provisioned it
-- here - on the linked production project it exists and this executes;
-- in a fresh test database without it, this is a safe no-op rather than
-- an error.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from anon, authenticated, public;
  end if;
end
$$;

-- OUT OF SCOPE, DELIBERATELY: a SEPARATE default-privilege entry owned by
-- `supabase_admin` (not `postgres`) also still auto-grants
-- anon/authenticated on tables/functions/sequences it might create in
-- `public`. This migration does NOT touch it - see
-- supabase/migrations/README.md ("supabase_admin default-privilege
-- finding") for the full investigation. In short: the role this migration
-- runs as (`postgres`) is not a superuser and is not a member of
-- `supabase_admin`, so `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin`
-- would fail outright with a permission error if attempted here - fixing
-- that entry is structurally outside this project's own migration
-- authority, not merely a design choice deferred for convenience.
--
-- STATUS: not yet applied to the linked production project - see
-- supabase/migrations/README.md and PHASE_3_MIGRATION_REPORT.md for the
-- application record once it is.
