-- Connector model Stage A: additive canonical installation + credential
-- foundation. Existing ingestion_connections remains the live auth/routing
-- path; no row is backfilled and no ingestion behavior changes here.

create table public.connector_installations (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  home_workspace_id uuid not null references public.workspaces (id) on delete restrict,
  connector_key text not null
    check (connector_key ~ '^[a-z][a-z0-9_]{2,63}$'),
  external_installation_id text,
  display_name text not null check (length(trim(display_name)) > 0),
  status text not null default 'setup'
    check (status in ('setup', 'testing', 'healthy', 'stale', 'paused', 'error', 'revoked')),
  auth_mode text not null
    check (auth_mode in ('device_secret', 'oauth', 'api_key', 'mailbox', 'none')),
  -- Server-only encrypted/opaque connector state. Never granted to a user role.
  sync_cursor_encrypted text,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  revoked_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connector_installations_id_owner_unique unique (id, owner_user_id),
  constraint connector_installations_revoked_consistent check (
    (status = 'revoked') = (revoked_at is not null)
  )
);

comment on table public.connector_installations is
  'One configured provider-neutral ingestion relationship. May discover multiple financial sources/accounts. Stage A is additive: ingestion_connections remains live until dual-write cutover.';
comment on column public.connector_installations.sync_cursor_encrypted is
  'Server-only encrypted or opaque pull cursor/reference. Excluded from every authenticated column grant.';

create index idx_connector_installations_owner_status
  on public.connector_installations (owner_user_id, status);
create index idx_connector_installations_workspace_status
  on public.connector_installations (home_workspace_id, status);
create unique index connector_installations_external_unique
  on public.connector_installations
    (owner_user_id, connector_key, external_installation_id)
  where external_installation_id is not null;

create trigger set_connector_installations_updated_at
  before update on public.connector_installations
  for each row execute function public.set_updated_at();

alter table public.connector_installations enable row level security;

create policy connector_installations_select_owner
  on public.connector_installations for select to authenticated
  using (owner_user_id = auth.uid());

-- Stage A exposes non-secret metadata only. Mutation moves through an
-- MFA-gated RPC/server path in the later enrollment stage.
revoke all on public.connector_installations from anon, authenticated;
grant select (
  id, owner_user_id, home_workspace_id, connector_key,
  external_installation_id, display_name, status, auth_mode,
  last_attempt_at, last_success_at, last_error_code, revoked_at,
  created_by, created_at, updated_at
) on public.connector_installations to authenticated;
grant select, insert, update, delete on public.connector_installations to service_role;

alter table public.financial_sources
  add column connector_installation_id uuid,
  add column provider_key text,
  add column external_source_ref_hash text;

alter table public.financial_sources
  add constraint financial_sources_installation_owner_fk
  foreign key (connector_installation_id, owner_user_id)
  references public.connector_installations (id, owner_user_id)
  on delete restrict;

alter table public.financial_sources
  add constraint financial_sources_installation_id_id_unique
  unique (connector_installation_id, id);

create unique index financial_sources_installation_external_ref_unique
  on public.financial_sources (connector_installation_id, external_source_ref_hash)
  where connector_installation_id is not null
    and external_source_ref_hash is not null;
create index idx_financial_sources_connector_installation
  on public.financial_sources (connector_installation_id)
  where connector_installation_id is not null;

comment on column public.financial_sources.connector_installation_id is
  'Canonical connector that currently discovers this source. Nullable for manual/cash sources and until the staged legacy backfill.';
comment on column public.financial_sources.external_source_ref_hash is
  'Non-display hash of a provider-stable source reference, unique only inside its connector installation.';

create table public.device_credentials (
  id uuid primary key default gen_random_uuid(),
  connector_installation_id uuid not null
    references public.connector_installations (id) on delete restrict,
  account_id uuid references public.accounts (id) on delete restrict,
  label text not null check (length(trim(label)) > 0),
  credential_hash text not null unique,
  credential_prefix text not null check (length(trim(credential_prefix)) > 0),
  status text not null default 'active'
    check (status in ('active', 'paused', 'revoked')),
  last_used_at timestamptz,
  expires_at timestamptz,
  rotated_from_id uuid references public.device_credentials (id) on delete restrict,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  paused_at timestamptz,
  revoked_at timestamptz,
  constraint device_credentials_id_installation_unique
    unique (id, connector_installation_id),
  constraint device_credentials_status_timestamps check (
    (status = 'active' and paused_at is null and revoked_at is null)
    or (status = 'paused' and paused_at is not null and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
  ),
  constraint device_credentials_not_self_rotated check (rotated_from_id is distinct from id)
);

comment on table public.device_credentials is
  'Reveal-once, hash-only credentials for push agents. A credential belongs to one connector installation and may be least-privilege scoped to one of that installation''s accounts.';
comment on column public.device_credentials.credential_hash is
  'SHA-256 credential digest. Never readable by authenticated users; service-role authentication only.';

create index idx_device_credentials_installation_status
  on public.device_credentials (connector_installation_id, status);
create index idx_device_credentials_account
  on public.device_credentials (account_id)
  where account_id is not null;

create or replace function public.validate_device_credential_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_installation_id uuid;
begin
  if new.account_id is null then
    return new;
  end if;

  select fs.connector_installation_id
    into v_account_installation_id
  from public.accounts a
  join public.financial_sources fs on fs.id = a.financial_source_id
  where a.id = new.account_id;

  if v_account_installation_id is null
     or v_account_installation_id <> new.connector_installation_id then
    raise exception 'Device credential account scope must belong to its connector installation.';
  end if;

  return new;
end;
$$;

comment on function public.validate_device_credential_scope is
  'Internal trigger: rejects an optional device account scope outside its connector installation.';
revoke all on function public.validate_device_credential_scope() from public;

create trigger validate_device_credential_scope
  before insert or update of connector_installation_id, account_id
  on public.device_credentials
  for each row execute function public.validate_device_credential_scope();

alter table public.device_credentials enable row level security;

create policy device_credentials_select_owner
  on public.device_credentials for select to authenticated
  using (exists (
    select 1 from public.connector_installations ci
    where ci.id = connector_installation_id
      and ci.owner_user_id = auth.uid()
  ));

revoke all on public.device_credentials from anon, authenticated;
grant select (
  id, connector_installation_id, account_id, label, credential_prefix,
  status, last_used_at, expires_at, rotated_from_id, created_by,
  created_at, paused_at, revoked_at
) on public.device_credentials to authenticated;
grant select, insert, update, delete on public.device_credentials to service_role;

alter table public.raw_financial_events
  add column connector_installation_id uuid
    references public.connector_installations (id) on delete restrict,
  add column device_credential_id uuid
    references public.device_credentials (id) on delete restrict;

alter table public.raw_financial_events
  add constraint raw_events_device_requires_installation check (
    device_credential_id is null or connector_installation_id is not null
  ),
  add constraint raw_events_device_installation_fk
    foreign key (device_credential_id, connector_installation_id)
    references public.device_credentials (id, connector_installation_id)
    on delete restrict,
  add constraint raw_events_source_installation_fk
    foreign key (connector_installation_id, financial_source_id)
    references public.financial_sources (connector_installation_id, id)
    on delete restrict;

create index idx_raw_financial_events_installation_received
  on public.raw_financial_events (connector_installation_id, received_at desc)
  where connector_installation_id is not null;
create index idx_raw_financial_events_device_credential
  on public.raw_financial_events (device_credential_id)
  where device_credential_id is not null;

comment on column public.raw_financial_events.connector_installation_id is
  'Canonical installation provenance. Nullable until Stage C dual write; legacy ingestion_connection_id remains live.';
comment on column public.raw_financial_events.device_credential_id is
  'Canonical push credential provenance. Nullable for pull/manual channels and until Stage C dual write.';
