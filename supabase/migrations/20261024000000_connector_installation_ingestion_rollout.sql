-- Connector Stage D: installation-scoped credential-authentication rollout.
--
-- The existing ONELEDGER_CANONICAL_INGESTION switch is intentionally coarse:
-- it moves every request at once. This service-only control plane allows the
-- Edge Function to select legacy or canonical credential authentication per
-- installation after one default-off runtime gate is enabled. The table starts
-- empty, and an absent row always means legacy, so applying this migration
-- cannot change ingestion behavior.

create table public.connector_ingestion_rollouts (
  connector_installation_id uuid primary key
    references public.connector_installations(id) on delete cascade,
  credential_auth_mode text not null default 'legacy'
    check (credential_auth_mode in ('legacy', 'canonical')),
  changed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_connector_ingestion_rollouts_updated_at
  before update on public.connector_ingestion_rollouts
  for each row execute function public.set_updated_at();

comment on table public.connector_ingestion_rollouts is
  'Service-only installation rollout control. Empty/absent means legacy credential authentication; canonical is selected only for an explicitly configured installation and only when the Edge runtime gate is also enabled.';

alter table public.connector_ingestion_rollouts enable row level security;
revoke all on table public.connector_ingestion_rollouts
  from public, anon, authenticated;
grant select, insert, update, delete on public.connector_ingestion_rollouts
  to service_role;

create or replace function public.resolve_ingestion_credential_rollout(
  p_credential_hash text
)
returns table (
  id uuid,
  workspace_id uuid,
  account_id uuid,
  status text,
  connector_installation_id uuid,
  device_credential_id uuid,
  credential_auth_mode text
)
language sql
security definer
set search_path = public
stable
as $$
  with legacy_match as (
    select
      ic.id,
      ic.workspace_id,
      ic.account_id,
      ic.status,
      ic.connector_installation_id,
      ic.device_credential_id
    from public.ingestion_connections ic
    where ic.credential_hash = p_credential_hash
      and ic.status = 'active'
  ), canonical_match as (
    select
      dc.legacy_ingestion_connection_id as id,
      ci.home_workspace_id as workspace_id,
      dc.account_id,
      dc.status,
      dc.connector_installation_id,
      dc.id as device_credential_id
    from public.device_credentials dc
    join public.connector_installations ci
      on ci.id = dc.connector_installation_id
    where dc.credential_hash = p_credential_hash
      and dc.status = 'active'
      and (dc.expires_at is null or dc.expires_at > statement_timestamp())
      and ci.status not in ('paused', 'revoked')
      and dc.legacy_ingestion_connection_id is not null
  ), resolved as (
    select
      l.id as legacy_id,
      l.workspace_id as legacy_workspace_id,
      l.account_id as legacy_account_id,
      l.status as legacy_status,
      l.connector_installation_id as legacy_installation_id,
      l.device_credential_id as legacy_credential_id,
      c.id as canonical_legacy_id,
      c.workspace_id as canonical_workspace_id,
      c.account_id as canonical_account_id,
      c.status as canonical_status,
      c.connector_installation_id as canonical_installation_id,
      c.device_credential_id as canonical_credential_id,
      coalesce(r.credential_auth_mode, 'legacy') as selected_mode
    from legacy_match l
    full join canonical_match c on true
    left join public.connector_ingestion_rollouts r
      on r.connector_installation_id = coalesce(
        c.connector_installation_id,
        l.connector_installation_id
      )
    where l.connector_installation_id is null
      or c.connector_installation_id is null
      or l.connector_installation_id = c.connector_installation_id
  )
  select
    case when selected_mode = 'canonical' then canonical_legacy_id else legacy_id end,
    case when selected_mode = 'canonical' then canonical_workspace_id else legacy_workspace_id end,
    case when selected_mode = 'canonical' then canonical_account_id else legacy_account_id end,
    case when selected_mode = 'canonical' then canonical_status else legacy_status end,
    case when selected_mode = 'canonical' then canonical_installation_id else legacy_installation_id end,
    case when selected_mode = 'canonical' then canonical_credential_id else legacy_credential_id end,
    selected_mode
  from resolved
  where (selected_mode = 'legacy' and legacy_id is not null)
    or (selected_mode = 'canonical' and canonical_legacy_id is not null);
$$;

comment on function public.resolve_ingestion_credential_rollout(text) is
  'Service-only, fail-closed credential resolver. Selects legacy by default and canonical only for an explicitly configured installation, while returning the compatibility route required during reversible cutover.';
revoke all on function public.resolve_ingestion_credential_rollout(text)
  from public;
grant execute on function public.resolve_ingestion_credential_rollout(text)
  to service_role;

