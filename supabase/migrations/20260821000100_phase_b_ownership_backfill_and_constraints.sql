-- Phase B: existing-data ownership backfill and constraint tightening.
--
-- Deliberately a separate migration from 20260821000000, applied only
-- after the current sole owner's auth.users row exists (created by real
-- signup or an explicitly-approved admin-created user) - which is itself
-- part of the production-application approval gate, not this file. Until
-- that owner exists, this migration is a safe no-op (see the guard below).
--
-- This migration does NOT know or hardcode any specific user/workspace ID.
-- It backfills deterministically by structural shape: at the moment this
-- runs against THIS database, there must be exactly one workspace of
-- kind='personal' and exactly one account with a NULL workspace_id (the
-- pre-Phase-B single MTN MoMo account). If that shape does not hold - a
-- second personal workspace already exists, or the account is already
-- linked, or there is more than one unlinked account - the migration
-- raises and refuses to guess, exactly like this project's standing rule
-- against inferring ownership from unstable values.
--
-- UPDATE (post-production-application, purely additive for future fresh
-- applies - a no-op against the already-migrated production database,
-- which never re-runs this file): a genuinely fresh, non-interactive
-- chain application (`supabase start`, this project's CI, a new
-- developer's local environment) has no way to interpose a real signup
-- between this migration and the previous one - there is no "production-
-- application approval gate" pausing anything, the whole chain just
-- runs straight through. That left `supabase start` permanently unable
-- to succeed from an empty database, which nothing had ever actually
-- exercised until an e2e/visual-regression suite tried to boot one from
-- scratch. The zero-workspace branch below (previously an unconditional
-- exception) now self-heals that one specific case by creating its own
-- placeholder personal workspace - workspaces.created_by is nullable
-- (20260821000000) and nothing in this schema requires a workspace to
-- have an owning membership row, so an ownerless workspace is a fully
-- valid, inert row: is_workspace_member() never grants any real user
-- access to it, so it's invisible to every RLS policy and every
-- application query. It exists solely so this migration has a link
-- target. The >1 branch is untouched - a genuinely ambiguous state still
-- refuses to guess, exactly as before.

do $$
declare
  v_account_id uuid;
  v_workspace_id uuid;
  v_unlinked_account_count int;
  v_personal_workspace_count int;
begin
  select count(*) into v_unlinked_account_count
    from public.accounts where workspace_id is null;

  -- Nothing to backfill (fresh/CI database with no pre-Phase-B account, or
  -- this migration already ran) - safe no-op, not an error.
  if v_unlinked_account_count = 0 then
    raise notice 'Phase B backfill: no unlinked accounts found, nothing to backfill.';
  else
    if v_unlinked_account_count <> 1 then
      raise exception
        'Phase B backfill expects exactly one unlinked account, found %. Refusing to guess which one is the pre-Phase-B owner''s account.',
        v_unlinked_account_count;
    end if;

    select count(*) into v_personal_workspace_count
      from public.workspaces where kind = 'personal';

    if v_personal_workspace_count = 0 then
      insert into public.workspaces (kind, name)
      values ('personal', 'Bootstrap (fresh-environment placeholder)');

      raise notice 'Phase B backfill: no personal workspace exists yet (a genuinely fresh chain application, not production) - created a placeholder to link the legacy account to.';
    elsif v_personal_workspace_count <> 1 then
      raise exception
        'Phase B backfill expects exactly one personal workspace to exist (the migrated owner''s), found %. Create the owner''s auth.users row first (via signup or an approved admin-created user) so handle_new_user() provisions it, then re-run this migration.',
        v_personal_workspace_count;
    end if;

    select id into v_account_id from public.accounts where workspace_id is null;
    select id into v_workspace_id from public.workspaces where kind = 'personal';

    update public.accounts
      set workspace_id = v_workspace_id
      where id = v_account_id;

    update public.transactions
      set account_id = v_account_id,
          workspace_id = v_workspace_id
      where account_id is null;

    update public.merchant_rules
      set workspace_id = v_workspace_id
      where workspace_id is null;

    raise notice 'Phase B backfill: linked account % and its transactions/merchant_rules to workspace %.',
      v_account_id, v_workspace_id;
  end if;
end $$;

-- Tighten to NOT NULL only after the backfill above (or a genuinely empty
-- table, e.g. a fresh CI database) guarantees no NULL survives.
alter table public.accounts
  alter column workspace_id set not null;

alter table public.transactions
  alter column account_id set not null,
  alter column workspace_id set not null;

alter table public.merchant_rules
  alter column workspace_id set not null;
