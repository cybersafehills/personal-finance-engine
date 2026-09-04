-- Integrations Phase 4, P4-PR1: developer API keys.
--
-- The first non-session, third-party-facing surface in the codebase. An
-- api_keys row carries a workspace_id and a scopes[] array; the /api/v1
-- route handlers authenticate a `Authorization: Bearer olk_...` token by
-- SHA-256 hash against api_keys.key_hash (web/lib/api/authenticate.ts) and
-- then read with a SERVICE-ROLE client pinned to that workspace_id - there
-- is no auth.uid(), so has_space_capability is not usable here; the key's
-- scopes are the authorization primitive. Managing keys (create / revoke)
-- still happens through session-authenticated server actions gated on the
-- new integration.developer_manage capability.

-- ===========================================================================
-- 1. Capability catalog: +1 integration.developer_manage (owner/admin).
--    Forward-only replace; the list is the UNION of every phase's set - the
--    Phase 3 lesson: a re-declare that drops a concurrently-merged phase's
--    capabilities breaks that phase.
-- ===========================================================================
create or replace function public.space_role_has_capability(
  p_kind text,
  p_role text,
  p_capability text
)
returns boolean
language sql
immutable
as $$
  select coalesce(
    p_capability in (
      'space.manage_settings', 'space.delete', 'space.transfer_ownership',
      'members.manage', 'budget.manage', 'goal.manage', 'rule.manage',
      'report.config', 'category.manage', 'transaction.create',
      'transaction.categorize', 'audit.view',
      'integration.view', 'integration.import', 'integration.import_approve',
      'integration.export', 'integration.configure',
      'integration.connection_manage', 'integration.sync_manage',
      'integration.logs_view',
      'integration.destination_manage', 'integration.workbook_manage',
      'integration.conflict_resolve',
      'bill.upload', 'bill.review', 'bill.approve', 'bill.post',
      'bill.manage', 'bill.download_original', 'bill.audit.view',
      'bill.configure',
      'integration.accountant_package',
      'integration.ledger_manage', 'integration.ledger_sync',
      'integration.developer_manage'
    )
    and case
      when p_kind = 'personal' then p_role = 'owner'
      when p_role = 'owner' then true
      when p_role = 'admin'
        then p_capability not in ('space.delete', 'space.transfer_ownership')
      when p_role = 'member'
        then p_capability in (
          'transaction.create', 'transaction.categorize', 'integration.view',
          'bill.upload', 'bill.review'
        )
      else false
    end,
    false
  );
$$;

comment on function public.space_role_has_capability is
  'Closed Spaces capability matrix. Unknown and null capabilities always fail closed. Owner: all 35 known capabilities. Admin: all except space.delete / space.transfer_ownership. Member: transaction.create / transaction.categorize / integration.view / bill.upload / bill.review. Viewer: none.';

alter table public.space_member_capability_grants
  drop constraint if exists space_member_capability_grants_known_capability;

alter table public.space_member_capability_grants
  add constraint space_member_capability_grants_known_capability
  check (capability in (
    'space.manage_settings', 'space.delete', 'space.transfer_ownership',
    'members.manage', 'budget.manage', 'goal.manage', 'rule.manage',
    'report.config', 'category.manage', 'transaction.create',
    'transaction.categorize', 'audit.view',
    'integration.view', 'integration.import', 'integration.import_approve',
    'integration.export', 'integration.configure',
    'integration.connection_manage', 'integration.sync_manage',
    'integration.logs_view',
    'integration.destination_manage', 'integration.workbook_manage',
    'integration.conflict_resolve',
    'bill.upload', 'bill.review', 'bill.approve', 'bill.post',
    'bill.manage', 'bill.download_original', 'bill.audit.view',
    'bill.configure',
    'integration.accountant_package',
    'integration.ledger_manage', 'integration.ledger_sync',
    'integration.developer_manage'
  )) not valid;

alter table public.space_member_capability_grants
  validate constraint space_member_capability_grants_known_capability;

-- ===========================================================================
-- 2. api_keys: one reveal-once bearer credential per workspace, scoped to a
--    subset of the read-only scope set. key_hash is SHA-256 hex of the
--    plaintext `olk_...` token; the plaintext is never stored.
-- ===========================================================================
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid references auth.users (id),
  name text not null check (length(trim(both from name)) > 0 and length(name) <= 80),
  -- first 8 chars of the token, e.g. 'olk_AbC1' - shown in the UI to
  -- identify a key without revealing it.
  key_prefix text not null,
  key_hash text not null unique,
  -- every entry must be one of the known read-only scopes; enforced in
  -- code (web/lib/api/keys.ts) and re-checked here.
  scopes text[] not null default '{}'::text[]
    check (scopes <@ array[
      'transactions:read', 'accounts:read', 'categories:read',
      'exports:read', 'sync:read', 'events:read'
    ]::text[]),
  status text not null default 'active' check (status in ('active', 'revoked')),
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

comment on table public.api_keys is
  'Reveal-once developer API bearer credential. key_hash = SHA-256 hex of the plaintext olk_ token (never stored). scopes is a subset of the read-only scope set. Managed by integration.developer_manage holders; the token itself authenticates /api/v1 requests with no Supabase session.';

create index idx_api_keys_workspace_status
  on public.api_keys (workspace_id, status);
create unique index idx_api_keys_hash on public.api_keys (key_hash);

alter table public.api_keys enable row level security;

create policy api_keys_select_member on public.api_keys
  for select to authenticated
  using (public.has_space_capability(workspace_id, 'integration.view'));

revoke all on public.api_keys from anon;
grant select on public.api_keys to authenticated;
grant select, insert, update, delete on public.api_keys to service_role;

-- ===========================================================================
-- 3. api_request_log: one row per /api/v1 request. Service-role only, no
--    PII - ip is stored only as a truncated SHA-256 hash. Retention-purged
--    by the P4-PR2 purge-api-logs cron.
-- ===========================================================================
create table public.api_request_log (
  id uuid primary key default gen_random_uuid(),
  api_key_id uuid references public.api_keys (id) on delete set null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  method text not null,
  path text not null,
  status integer not null,
  ip_hash text,
  response_ms integer,
  created_at timestamptz not null default now()
);

comment on table public.api_request_log is
  'One row per /api/v1 request. Service-role only; no bodies, no query values, no raw IPs (ip_hash is a truncated SHA-256). Purged on a retention window by the purge-api-logs cron.';

create index idx_api_request_log_key_created
  on public.api_request_log (api_key_id, created_at desc);
create index idx_api_request_log_workspace_created
  on public.api_request_log (workspace_id, created_at desc);

alter table public.api_request_log enable row level security;

revoke all on public.api_request_log from anon, authenticated;
grant select, insert, update, delete on public.api_request_log to service_role;
