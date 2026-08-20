-- Security hardening: remove unnecessary anon/authenticated table-level
-- privileges on every financial table in this schema.
--
-- BACKGROUND
--
-- Introspection of the linked project (pg_default_acl) showed a
-- platform-wide `ALTER DEFAULT PRIVILEGES ... IN SCHEMA public GRANT ALL ON
-- TABLES TO anon, authenticated, service_role` already in effect - meaning
-- every table created in `public` (by the role migrations run as)
-- automatically receives full CRUD grants for `anon` and `authenticated`
-- unless explicitly revoked. This is why momo_messages, transactions,
-- merchant_rules, and processing_errors currently show `anon`/
-- `authenticated` holding SELECT/INSERT/UPDATE/DELETE/TRUNCATE at the
-- GRANT level (confirmed via information_schema.role_table_grants), even
-- though nobody explicitly asked for that.
--
-- Today this is not actively exploitable: Row Level Security is enabled on
-- all four tables with zero permissive policies, so PostgREST requests
-- from `anon`/`authenticated` are denied by RLS regardless of the
-- underlying GRANT. But defense in depth means a financial system should
-- not rely on a single control (RLS policy absence) to be the only thing
-- standing between anonymous/authenticated API callers and raw
-- transaction/message data - a future accidental `CREATE POLICY ... USING
-- (true)` on any of these tables would otherwise immediately expose full
-- CRUD to anyone with the public anon key.
--
-- INTENDED ARCHITECTURE
--
--   iPhone Shortcut
--       -> ingest-momo Edge Function (validates x-ingest-key)
--       -> service-role Supabase client (bypasses RLS by design)
--       -> momo_messages / transactions / processing_errors / merchant_rules
--
-- There is no legitimate path today where `anon` or `authenticated` should
-- read or write these tables directly - all access goes through the
-- Edge Function's service-role client. accounts and balance_reconciliations
-- (introduced in 20260818130000 / 20260818130100) already follow this
-- least-privilege pattern from creation; this migration brings the four
-- pre-existing tables in line with it.
--
-- This does NOT touch RLS (still enabled, still zero permissive policies)
-- and does NOT affect service_role, which retains full access and
-- continues to bypass RLS as before - the Edge Function's behavior is
-- unchanged.
--
-- STATUS: applied to the linked production project via `supabase db push`
-- on 2026-08-19 - see PHASE_3_MIGRATION_REPORT.md. Confirmed
-- post-migration: zero anon/authenticated grants remain on any table in
-- this schema, service_role access is unaffected, and a table created
-- after this migration does not automatically regain anon/authenticated
-- grants (the ALTER DEFAULT PRIVILEGES fix is effective for the
-- postgres-owned default-privilege entry - a separate, pre-existing
-- supabase_admin-owned entry still auto-grants those roles and was not in
-- scope here; see the migration report for detail).

revoke all on public.momo_messages from anon, authenticated;
revoke all on public.transactions from anon, authenticated;
revoke all on public.merchant_rules from anon, authenticated;
revoke all on public.processing_errors from anon, authenticated;

-- Belt and suspenders, matching the four REVOKEs above: any table created
-- in `public` going forward (by whichever role owns this default privilege
-- entry - currently `postgres`, confirmed via pg_default_acl) no longer
-- automatically grants anon/authenticated anything. New tables must opt in
-- explicitly if a future feature genuinely needs direct client access
-- (none does today). This does not retroactively change grants already
-- issued to other roles, and does not affect service_role.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
