-- Phase P: OneLedger Pay & Services - payment networks, access routes,
-- verification evidence, and a granular directory.* permission system.
--
-- Extends the Phase M USSD directory (20260906000000) to represent an
-- interoperable national payment network (eKash) and everything the
-- supplied RSwitch brief requires that a bare service_codes row cannot:
--
--   * payment_networks           - the network itself (eKash)
--   * regulatory_authorities     - "regulated by" (National Bank of Rwanda)
--   * service_operators          - "operated by" (RSwitch Ltd)
--   * payment_network_operators  - versioned network<->operator link
--   * institution_network_participation - versioned, per-institution,
--                                  independently verified participation
--   * access_routes              - institution-specific, channel-typed
--                                  routes that MAY reference a service_code
--   * route_supported_flows / route_menu_steps / route_fees / route_limits
--   * directory_sources / directory_evidence  - verification citations +
--                                  private uploaded artefacts
--   * directory_aliases          - search-normalised alternate spellings
--   * directory_versions         - append-only history for the new entities
--   * directory_role_grants + has_directory_permission() - 14 granular
--                                  permissions replacing the binary
--                                  is_platform_admin gate for the directory
--
-- NON-CUSTODIAL (ADR 0001) is preserved: no table stores, and no RPC
-- parameter accepts, a PIN/OTP/password/secret/credential/security answer
-- /card CVV. admin_upsert_access_route rejects those parameter kinds
-- in-function. eKash is modelled as a network with a regulator and an
-- operator - never as something OneLedger operates, never as a universal
-- USSD code (none is created here; the brief forbids inventing bank USSD
-- strings or menu option numbers).
--
-- Conventions follow Phase M/N/O exactly: text + CHECK enum-likes (never
-- Postgres enums), RLS on every table, `anon` fully revoked,
-- `authenticated` granted only the verbs it uses (directory-content
-- tables: SELECT only - writes go through SECURITY DEFINER RPCs), every
-- new authenticated-callable function gets its OWN explicit
-- `grant execute ... to authenticated` (see the Phase L is_valid_nav_order
-- incident in supabase/migrations/README.md), application-owned objects
-- stay postgres-owned, set_updated_at() trigger on mutable rows.
--
-- See docs/pay-services-phase-p-design.md and
-- docs/adr/0004-payment-networks-and-directory-permissions.md.

-- ===========================================================================
-- 1. Granular directory.* permission system (brief section 9)
-- ===========================================================================

-- The 14 permission slugs, used as a text + CHECK domain everywhere.
create table public.directory_role_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  permission text not null check (permission in (
    'directory.view_admin',
    'directory.create',
    'directory.edit_draft',
    'directory.submit_review',
    'directory.review',
    'directory.publish',
    'directory.suspend',
    'directory.deprecate',
    'directory.archive',
    'directory.restore',
    'directory.view_evidence',
    'directory.manage_evidence',
    'directory.view_audit',
    'directory.resolve_reports'
  )),
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  note text,
  constraint directory_role_grants_unique unique (user_id, permission)
);

comment on table public.directory_role_grants is
  'Maps a user to one of the 14 directory.* permission slugs. Platform-level and GLOBAL - orthogonal to workspace_memberships.role (an org admin gains nothing here automatically). Populated only by admin_grant_directory_permission / admin_revoke_directory_permission (is_platform_admin-gated). is_platform_admin() implies EVERY permission (Platform Owner fallback, ADR 0004).';

create index idx_directory_role_grants_user on public.directory_role_grants (user_id);

-- The single authorization primitive for every directory RLS policy and
-- admin RPC below. Mirrors is_workspace_member()'s shape: SECURITY
-- DEFINER so it reads directory_role_grants regardless of the caller's
-- own RLS view, STABLE so the planner calls it once per statement.
create function public.has_directory_permission(perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin()
      or exists (
        select 1 from public.directory_role_grants
        where user_id = auth.uid() and permission = perm
      );
$$;

comment on function public.has_directory_permission(text) is
  'True iff the current auth.uid() holds directory permission `perm`, OR is a platform admin (is_platform_admin implies all directory.* permissions). SECURITY DEFINER + STABLE. The authorization primitive for the Pay & Services directory surface (ADR 0004).';

revoke all on function public.has_directory_permission(text) from public;
grant execute on function public.has_directory_permission(text) to authenticated;
grant execute on function public.has_directory_permission(text) to service_role;

-- Bootstrap grant/revoke. Guarded by is_platform_admin() - only a
-- Platform Owner hands out directory.* permissions. Audited.
create function public.admin_grant_directory_permission(p_user uuid, p_permission text, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'not_authorized: platform admin required' using errcode = 'insufficient_privilege';
  end if;

  insert into public.directory_role_grants (user_id, permission, granted_by, note)
  values (p_user, p_permission, auth.uid(), nullif(p_note, ''))
  on conflict (user_id, permission) do update set note = coalesce(excluded.note, public.directory_role_grants.note)
  returning id into v_id;

  insert into public.service_directory_audit_events (actor_user_id, action, subject_type, subject_id, after_state, reason)
  values (auth.uid(), 'directory_permission.grant', 'directory_role_grant', v_id,
          jsonb_build_object('user_id', p_user, 'permission', p_permission), nullif(p_note, ''));

  return v_id;
end;
$$;

revoke all on function public.admin_grant_directory_permission(uuid, text, text) from public;
grant execute on function public.admin_grant_directory_permission(uuid, text, text) to authenticated;

create function public.admin_revoke_directory_permission(p_user uuid, p_permission text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not_authorized: platform admin required' using errcode = 'insufficient_privilege';
  end if;

  delete from public.directory_role_grants where user_id = p_user and permission = p_permission;

  insert into public.service_directory_audit_events (actor_user_id, action, subject_type, after_state)
  values (auth.uid(), 'directory_permission.revoke', 'directory_role_grant',
          jsonb_build_object('user_id', p_user, 'permission', p_permission));
end;
$$;

revoke all on function public.admin_revoke_directory_permission(uuid, text) from public;
grant execute on function public.admin_revoke_directory_permission(uuid, text) to authenticated;

-- ===========================================================================
-- 2. Widen the Phase M audit trail to cover every directory entity type.
-- The existing service_code_id column stays for back-compat; new actions
-- record subject_type + subject_id instead.
-- ===========================================================================
alter table public.service_directory_audit_events
  add column if not exists subject_type text,
  add column if not exists subject_id uuid;

comment on column public.service_directory_audit_events.subject_type is
  'For Phase P entities: payment_network | network_operator | institution_participation | access_route | regulatory_authority | service_operator | directory_source | directory_evidence | directory_role_grant. NULL for legacy service_code rows (which use service_code_id).';

create index if not exists idx_service_directory_audit_subject
  on public.service_directory_audit_events (subject_type, subject_id, created_at desc);

-- ===========================================================================
-- 3. Shared helpers: alias normalisation + the publication state machine.
-- ===========================================================================

-- lower-case, strip every non-alphanumeric. eKash / e-Kash / eCash /
-- e-Cash all collapse to 'ekash' / 'ecash'. IMMUTABLE so it can be used
-- in indexes and by P3 search to normalise the query the same way.
create function public.normalize_directory_alias(p_alias text)
returns text
language sql
immutable
as $$
  select regexp_replace(lower(coalesce(p_alias, '')), '[^a-z0-9]', '', 'g');
$$;

comment on function public.normalize_directory_alias(text) is
  'Search-normalises a directory alias: lower-case + strip non-alphanumerics. IMMUTABLE. Used by the directory_aliases normalise trigger and (later) P3 search.';

revoke all on function public.normalize_directory_alias(text) from public;
grant execute on function public.normalize_directory_alias(text) to authenticated;
grant execute on function public.normalize_directory_alias(text) to service_role;

-- Permitted publication-lifecycle transitions - identical matrix to
-- Phase M's admin_set_service_code_state, factored out so the three new
-- state RPCs share one source of truth.
create function public.directory_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select case
    when p_to = p_from then false
    when p_to = 'archived' then true
    when p_from = 'draft' and p_to = 'pending_review' then true
    when p_from = 'pending_review' and p_to in ('draft', 'published') then true
    when p_from = 'published' and p_to in ('temporarily_unavailable', 'deprecated') then true
    when p_from = 'temporarily_unavailable' and p_to in ('published', 'deprecated') then true
    when p_from = 'deprecated' and p_to = 'published' then true
    else false
  end;
$$;

revoke all on function public.directory_transition_allowed(text, text) from public;

-- The primary directory.* permission a transition needs. pending_review
-- -> published additionally requires directory.publish, checked in each
-- state RPC (maker-checker: review and publish can be different people).
create function public.directory_transition_permission(p_from text, p_to text)
returns text
language sql
immutable
as $$
  select case
    when p_to = 'archived' then 'directory.archive'
    when p_to = 'pending_review' then 'directory.submit_review'
    when p_from = 'pending_review' and p_to = 'draft' then 'directory.review'
    when p_from = 'pending_review' and p_to = 'published' then 'directory.review'
    when p_to = 'temporarily_unavailable' then 'directory.suspend'
    when p_to = 'deprecated' then 'directory.deprecate'
    when p_to = 'published' then 'directory.restore'
    else 'directory.publish'
  end;
$$;

revoke all on function public.directory_transition_permission(text, text) from public;

-- ===========================================================================
-- 4. Reference entities: regulatory authorities + system operators.
-- ===========================================================================
create table public.regulatory_authorities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  country char(2) not null default 'RW' check (country = upper(country)),
  website_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.regulatory_authorities is
  'Financial-sector regulators referenced by payment_networks.regulatory_authority_id ("regulated by" - NOT "operated by"). Reference data, readable by any authenticated user.';

create trigger set_regulatory_authorities_updated_at
  before update on public.regulatory_authorities
  for each row execute function public.set_updated_at();

create table public.service_operators (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  country char(2) not null default 'RW' check (country = upper(country)),
  website_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.service_operators is
  'Network / system operators (e.g. RSwitch Ltd) linked to payment_networks through the versioned payment_network_operators table ("operated by").';

create trigger set_service_operators_updated_at
  before update on public.service_operators
  for each row execute function public.set_updated_at();

-- service_providers gains a regulator link + an e-money-issuer flag so it
-- can double as "financial institutions and providers" (brief section 6)
-- without a redundant table.
alter table public.service_providers
  add column if not exists regulatory_authority_id uuid references public.regulatory_authorities (id) on delete set null,
  add column if not exists emoney_issuer boolean not null default false;

-- ===========================================================================
-- 5. payment_networks (brief section 5)
-- ===========================================================================
create table public.payment_networks (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  canonical_name text not null,
  display_name_en text not null,
  display_name_rw text,
  description_en text,
  description_rw text,
  entity_type text not null check (entity_type in (
    'interoperable_network', 'card_scheme', 'mobile_money_scheme', 'other'
  )),
  country char(2) not null default 'RW' check (country = upper(country)),
  regulatory_authority_id uuid references public.regulatory_authorities (id) on delete set null,

  full_interoperability_effective_date date,
  -- nullable: NULL = unknown, distinct from an explicit false.
  separate_registration_required boolean,
  separate_app_required boolean,
  access_channel_summary_en text,
  access_channel_summary_rw text,
  custody_note_en text,
  custody_note_rw text,

  -- provenance / verification (same semantics as service_codes)
  official_source_url text,
  official_source_label text,
  verified_at timestamptz,
  verified_by uuid references auth.users (id) on delete set null,
  review_due_at timestamptz,

  -- publication lifecycle (same 6-state machine as service_codes)
  state text not null default 'draft' check (state in (
    'draft', 'pending_review', 'published',
    'temporarily_unavailable', 'deprecated', 'archived'
  )),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  constraint payment_networks_effective_window
    check (effective_to is null or effective_to > effective_from),

  version integer not null default 1 check (version >= 1),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.payment_networks is
  'An interoperable payment network (e.g. eKash). regulatory_authority_id = "regulated by"; operators are the versioned payment_network_operators rows = "operated by". Network-level fee/capacity live in route_fees/route_limits with scope=''network''. Non-admins see only state=''published'' rows in their effective window (RLS).';

create trigger set_payment_networks_updated_at
  before update on public.payment_networks
  for each row execute function public.set_updated_at();

create index idx_payment_networks_state on public.payment_networks (state);
create index idx_payment_networks_review_due on public.payment_networks (review_due_at)
  where state = 'published';

-- ===========================================================================
-- 6. payment_network_operators - versioned network<->operator link.
--    A network can have one or more operators over time (brief section 13).
-- ===========================================================================
create table public.payment_network_operators (
  id uuid primary key default gen_random_uuid(),
  payment_network_id uuid not null references public.payment_networks (id) on delete cascade,
  service_operator_id uuid not null references public.service_operators (id) on delete restrict,
  operator_role text not null default 'system_operator' check (operator_role in (
    'system_operator', 'processor', 'switch', 'other'
  )),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  is_current boolean not null default true,
  official_source_url text,
  official_source_label text,
  verified_at timestamptz,
  verified_by uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_network_operators_window
    check (effective_to is null or effective_to > effective_from)
);

comment on table public.payment_network_operators is
  'Versioned "operated by" relationship. At most one is_current row per (network, operator_role); admin_upsert_network_operator closes the prior current row when a new one is added.';

create trigger set_payment_network_operators_updated_at
  before update on public.payment_network_operators
  for each row execute function public.set_updated_at();

create unique index payment_network_operators_one_current
  on public.payment_network_operators (payment_network_id, operator_role)
  where is_current;

-- ===========================================================================
-- 7. institution_network_participation - versioned, per-institution,
--    independently verified (brief section 5: existing in the directory
--    does NOT imply participation).
-- ===========================================================================
create table public.institution_network_participation (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.service_providers (id) on delete restrict,
  payment_network_id uuid not null references public.payment_networks (id) on delete restrict,
  participant_role text not null check (participant_role in (
    'bank', 'emi', 'both', 'other'
  )),

  official_source_url text,
  official_source_label text,
  verified_at timestamptz,
  verified_by uuid references auth.users (id) on delete set null,
  review_due_at timestamptz,

  state text not null default 'draft' check (state in (
    'draft', 'pending_review', 'published',
    'temporarily_unavailable', 'deprecated', 'archived'
  )),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  constraint institution_network_participation_window
    check (effective_to is null or effective_to > effective_from),

  version integer not null default 1 check (version >= 1),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.institution_network_participation is
  'An explicit, versioned record that a provider participates in a payment network. Own verification state + evidence - never auto-derived from the provider merely existing (brief section 5).';

create trigger set_institution_network_participation_updated_at
  before update on public.institution_network_participation
  for each row execute function public.set_updated_at();

-- One non-archived, open-ended participation per (provider, network).
create unique index institution_network_participation_one_active
  on public.institution_network_participation (provider_id, payment_network_id)
  where effective_to is null and state <> 'archived';

-- ===========================================================================
-- 8. access_routes - institution-specific, channel-typed. MAY reference a
--    service_codes USSD entry (brief section 5 hierarchy, section 11).
-- ===========================================================================
create table public.access_routes (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  provider_id uuid not null references public.service_providers (id) on delete restrict,
  payment_network_id uuid references public.payment_networks (id) on delete set null,
  participation_id uuid references public.institution_network_participation (id) on delete set null,
  channel text not null check (channel in (
    'ussd', 'mobile_app', 'internet_banking', 'provider_website', 'qr', 'other'
  )),
  service_code_id uuid references public.service_codes (id) on delete set null,
  approved_entry_point_en text,
  internet_required boolean not null default false,
  device_compat text[] not null default '{}'::text[],

  display_name_en text not null,
  display_name_rw text,
  description_en text,
  description_rw text,
  risk_text text,
  caution_text text,
  replacement_route_id uuid references public.access_routes (id) on delete set null,

  official_source_url text,
  official_source_label text,
  verified_at timestamptz,
  verified_by uuid references auth.users (id) on delete set null,
  review_due_at timestamptz,

  state text not null default 'draft' check (state in (
    'draft', 'pending_review', 'published',
    'temporarily_unavailable', 'deprecated', 'archived'
  )),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  constraint access_routes_effective_window
    check (effective_to is null or effective_to > effective_from),

  version integer not null default 1 check (version >= 1),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A route must resolve to something verifiable.
  constraint access_routes_has_entry_point
    check (service_code_id is not null or approved_entry_point_en is not null)
);

comment on table public.access_routes is
  'One institution-specific way to reach a payment network (or a standalone service). Belongs to a channel; may reference a service_codes USSD entry; supports one or more transfer flows (route_supported_flows). No universal eKash USSD code is created - routes are added per institution with separate verified evidence (brief section 5).';

create trigger set_access_routes_updated_at
  before update on public.access_routes
  for each row execute function public.set_updated_at();

create index idx_access_routes_provider on public.access_routes (provider_id);
create index idx_access_routes_network on public.access_routes (payment_network_id);
create index idx_access_routes_state on public.access_routes (state);
create index idx_access_routes_review_due on public.access_routes (review_due_at)
  where state = 'published';

-- ===========================================================================
-- 9. Route children: supported flows, ordered menu steps, fees, limits.
-- ===========================================================================
create table public.route_supported_flows (
  id uuid primary key default gen_random_uuid(),
  access_route_id uuid not null references public.access_routes (id) on delete cascade,
  flow_type text not null check (flow_type in (
    'account_to_wallet', 'wallet_to_account', 'account_to_account',
    'wallet_to_wallet', 'merchant_payment', 'other'
  )),
  note_en text,
  created_at timestamptz not null default now(),
  constraint route_supported_flows_unique unique (access_route_id, flow_type)
);

comment on table public.route_supported_flows is
  'Which transfer-flow types a route supports (brief section 5 supported flows / section 11 supported purposes).';

create table public.route_menu_steps (
  id uuid primary key default gen_random_uuid(),
  access_route_id uuid not null references public.access_routes (id) on delete cascade,
  position integer not null default 0,
  action_label_en text,
  action_label_rw text,
  instruction_en text not null,
  instruction_rw text,
  expected_menu_label_en text,
  -- text, not integer: menus use "1", "1.2", "#". NULL until verified.
  expected_option_number text,
  -- references a safe service_code_parameters.key / route input - never a secret.
  parameter_key text,
  caution_en text,
  caution_rw text,
  channel_applicability text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  constraint route_menu_steps_unique_position unique (access_route_id, position)
);

comment on table public.route_menu_steps is
  'Ordered, localised menu instructions for a route (brief section 7). expected_option_number is set only when verified. parameter_key may never be a PIN/OTP/secret - admin_upsert_access_route enforces the allowlist. The final step may say "authorise with your provider''s secure process" but nothing here can hold a PIN prompt (ADR 0001).';

create index idx_route_menu_steps_route on public.route_menu_steps (access_route_id, position);

create table public.route_fees (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('network', 'institution')),
  payment_network_id uuid references public.payment_networks (id) on delete cascade,
  access_route_id uuid references public.access_routes (id) on delete cascade,
  -- The semantic the brief demands (section 7): distinguish no-fee /
  -- unknown / varies-by-institution / published-maximum instead of
  -- overloading 0 or NULL.
  fee_type text not null check (fee_type in (
    'fixed', 'percentage', 'tiered', 'none', 'unknown',
    'varies_by_institution', 'published_maximum'
  )),
  fixed_fee_minor bigint check (fixed_fee_minor is null or fixed_fee_minor >= 0),
  percentage_bps integer check (percentage_bps is null or percentage_bps >= 0),
  min_fee_minor bigint check (min_fee_minor is null or min_fee_minor >= 0),
  max_fee_minor bigint check (max_fee_minor is null or max_fee_minor >= 0),
  -- "minor units". RWF has no subunit, so a RWF value here is whole RWF.
  currency char(3) not null default 'RWF' check (currency = upper(currency)),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  source_url text,
  source_label text,
  note_en text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint route_fees_window check (effective_to is null or effective_to > effective_from),
  constraint route_fees_scope_target check (
    (scope = 'network' and payment_network_id is not null and access_route_id is null) or
    (scope = 'institution' and access_route_id is not null and payment_network_id is null)
  )
);

comment on table public.route_fees is
  'Fee information at network scope (published framework) or institution scope (verified override). Institution-scope rows take precedence in the read layer (brief section 13). fee_type carries the no-fee/unknown/varies/published-maximum distinction.';

create index idx_route_fees_network on public.route_fees (payment_network_id) where scope = 'network';
create index idx_route_fees_route on public.route_fees (access_route_id) where scope = 'institution';

create table public.route_limits (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('network', 'institution')),
  payment_network_id uuid references public.payment_networks (id) on delete cascade,
  access_route_id uuid references public.access_routes (id) on delete cascade,
  min_txn_minor bigint check (min_txn_minor is null or min_txn_minor >= 0),
  max_txn_minor bigint check (max_txn_minor is null or max_txn_minor >= 0),
  daily_limit_minor bigint check (daily_limit_minor is null or daily_limit_minor >= 0),
  currency char(3) not null default 'RWF' check (currency = upper(currency)),
  is_published_maximum boolean not null default false,
  institution_override boolean not null default false,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  source_url text,
  source_label text,
  note_en text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint route_limits_window check (effective_to is null or effective_to > effective_from),
  constraint route_limits_scope_target check (
    (scope = 'network' and payment_network_id is not null and access_route_id is null) or
    (scope = 'institution' and access_route_id is not null and payment_network_id is null)
  )
);

comment on table public.route_limits is
  'Transaction / daily limits at network scope (published platform capability) or institution scope (verified lower limit). is_published_maximum flags the platform ceiling; institutions may enforce lower (brief section 5).';

create index idx_route_limits_network on public.route_limits (payment_network_id) where scope = 'network';
create index idx_route_limits_route on public.route_limits (access_route_id) where scope = 'institution';

-- ===========================================================================
-- 10. Verification sources + private evidence artefacts (brief section 7).
-- ===========================================================================
create table public.directory_sources (
  id uuid primary key default gen_random_uuid(),
  organization text not null,
  title text,
  classification text not null check (classification in (
    'official_regulator', 'official_system_operator', 'official_financial_institution',
    'official_telecom_emoney', 'approved_internal_verification', 'community_suggestion_unverified'
  )),
  source_url text,
  publication_date date,
  -- Private by default. Public pages may show organization/title/
  -- publication_date/source_url ONLY when is_public (brief section 7).
  is_public boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.directory_sources is
  'A verification citation (who says so). Kept private unless is_public. Public directory pages may display organization, title, publication_date and source_url only for is_public rows.';

create trigger set_directory_sources_updated_at
  before update on public.directory_sources
  for each row execute function public.set_updated_at();

create table public.directory_evidence (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.directory_sources (id) on delete restrict,
  subject_type text not null check (subject_type in (
    'service_code', 'payment_network', 'network_operator',
    'institution_participation', 'access_route'
  )),
  subject_id uuid not null,
  -- relative to the private 'directory-evidence' storage bucket - never a public URL.
  storage_path text,
  mime_type text,
  byte_size bigint check (byte_size is null or byte_size > 0),
  checksum text,
  uploaded_by uuid references auth.users (id) on delete set null,
  verified_by uuid references auth.users (id) on delete set null,
  verification_date timestamptz,
  next_review_date timestamptz,
  internal_note text,
  public_caveat_en text,
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.directory_evidence is
  'Uploaded verification artefact (screenshot / PDF / document) for a directory subject. Bytes live in the private "directory-evidence" bucket and reach an admin only via a signed URL from a server route that first checks directory.view_evidence (Phase K report-artifacts pattern). Table metadata is readable via RLS by directory.view_evidence holders.';

create index idx_directory_evidence_subject on public.directory_evidence (subject_type, subject_id);
create index idx_directory_evidence_next_review on public.directory_evidence (next_review_date)
  where next_review_date is not null;

-- Private bucket. public = false is what prevents unauthenticated object
-- access; no storage.objects policies for anon/authenticated are added
-- (RLS-enabled-no-policy already denies them; service_role bypasses).
-- Mirrors 20260903000000_phase_k_report_artifacts.sql.
insert into storage.buckets (id, name, public)
values ('directory-evidence', 'directory-evidence', false)
on conflict (id) do nothing;

-- ===========================================================================
-- 11. Search aliases (brief section 12).
-- ===========================================================================
create table public.directory_aliases (
  id uuid primary key default gen_random_uuid(),
  alias text not null,
  normalized_alias text not null,
  subject_type text not null check (subject_type in (
    'payment_network', 'service_code', 'service_provider', 'access_route'
  )),
  subject_id uuid not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  constraint directory_aliases_unique unique (normalized_alias, subject_type, subject_id)
);

comment on table public.directory_aliases is
  'Alternate spellings that resolve to a directory subject (e.g. e-Kash / eCash -> the eKash network). normalized_alias is maintained by a trigger. An alias row is visible only when its subject is (RLS) so unpublished names never leak into search.';

create index idx_directory_aliases_normalized on public.directory_aliases (normalized_alias);
create unique index directory_aliases_one_primary
  on public.directory_aliases (subject_type, subject_id) where is_primary;

create function public.directory_aliases_set_normalized()
returns trigger
language plpgsql
as $$
begin
  new.normalized_alias := public.normalize_directory_alias(new.alias);
  if new.normalized_alias = '' then
    raise exception 'invalid_alias: normalises to empty' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.directory_aliases_set_normalized() from public;

create trigger directory_aliases_set_normalized
  before insert or update on public.directory_aliases
  for each row execute function public.directory_aliases_set_normalized();

-- ===========================================================================
-- 12. Generic append-only version history for the Phase P entities.
--     (service_codes keeps its own service_code_versions.)
-- ===========================================================================
create table public.directory_versions (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in (
    'payment_network', 'network_operator', 'institution_participation', 'access_route'
  )),
  subject_id uuid not null,
  version integer not null check (version >= 1),
  snapshot jsonb not null,
  change_reason text,
  changed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint directory_versions_unique unique (subject_type, subject_id, version)
);

comment on table public.directory_versions is
  'Append-only snapshot history for payment_networks / payment_network_operators / institution_network_participation / access_routes (+ their children). Written by the admin RPCs. Readable only by directory.view_audit holders.';

create index idx_directory_versions_subject on public.directory_versions (subject_type, subject_id, version desc);

-- ===========================================================================
-- 13. Admin RPCs. All SECURITY DEFINER, permission-checked via
-- has_directory_permission(), each writes a version snapshot + an audit
-- row. There is deliberately NO INSERT/UPDATE/DELETE grant or policy for
-- `authenticated` on any directory-content table.
-- ===========================================================================

-- Internal: append a directory_versions row for a Phase P subject.
create function public.record_directory_version(
  p_subject_type text, p_subject_id uuid, p_snapshot jsonb, p_reason text, p_new_version integer
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.directory_versions (subject_type, subject_id, version, snapshot, change_reason, changed_by)
  values (p_subject_type, p_subject_id, p_new_version, p_snapshot, nullif(p_reason, ''), auth.uid());
$$;

revoke all on function public.record_directory_version(text, uuid, jsonb, text, integer) from public;

-- Internal: append a directory audit event for a Phase P subject.
create function public.record_directory_audit(
  p_action text, p_subject_type text, p_subject_id uuid, p_before jsonb, p_after jsonb, p_reason text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.service_directory_audit_events
    (actor_user_id, action, subject_type, subject_id, before_state, after_state, reason)
  values (auth.uid(), p_action, p_subject_type, p_subject_id, p_before, p_after, nullif(p_reason, ''));
$$;

revoke all on function public.record_directory_audit(text, text, uuid, jsonb, jsonb, text) from public;

-- --- regulatory_authorities ------------------------------------------------
create function public.admin_upsert_regulatory_authority(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(payload->>'id', '')::uuid;
begin
  if v_id is null then
    if not public.has_directory_permission('directory.create') then
      raise exception 'not_authorized: directory.create required' using errcode = 'insufficient_privilege';
    end if;
    insert into public.regulatory_authorities (slug, name, country, website_url, notes)
    values (
      payload->>'slug', payload->>'name',
      coalesce(nullif(payload->>'country', ''), 'RW'),
      nullif(payload->>'website_url', ''), nullif(payload->>'notes', '')
    )
    returning id into v_id;
    perform public.record_directory_audit('regulatory_authority.create', 'regulatory_authority', v_id, null,
      (select to_jsonb(r.*) from public.regulatory_authorities r where r.id = v_id), payload->>'change_reason');
  else
    if not public.has_directory_permission('directory.edit_draft') then
      raise exception 'not_authorized: directory.edit_draft required' using errcode = 'insufficient_privilege';
    end if;
    update public.regulatory_authorities set
      name = coalesce(payload->>'name', name),
      country = coalesce(nullif(payload->>'country', ''), country),
      website_url = case when payload ? 'website_url' then nullif(payload->>'website_url', '') else website_url end,
      notes = case when payload ? 'notes' then nullif(payload->>'notes', '') else notes end
    where id = v_id;
    if not found then
      raise exception 'not_found: regulatory_authority %', v_id using errcode = 'no_data_found';
    end if;
    perform public.record_directory_audit('regulatory_authority.update', 'regulatory_authority', v_id, null,
      (select to_jsonb(r.*) from public.regulatory_authorities r where r.id = v_id), payload->>'change_reason');
  end if;
  return v_id;
end;
$$;

revoke all on function public.admin_upsert_regulatory_authority(jsonb) from public;
grant execute on function public.admin_upsert_regulatory_authority(jsonb) to authenticated;

-- --- service_operators ---------------------------------------------------
create function public.admin_upsert_service_operator(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(payload->>'id', '')::uuid;
begin
  if v_id is null then
    if not public.has_directory_permission('directory.create') then
      raise exception 'not_authorized: directory.create required' using errcode = 'insufficient_privilege';
    end if;
    insert into public.service_operators (slug, name, country, website_url, notes)
    values (
      payload->>'slug', payload->>'name',
      coalesce(nullif(payload->>'country', ''), 'RW'),
      nullif(payload->>'website_url', ''), nullif(payload->>'notes', '')
    )
    returning id into v_id;
    perform public.record_directory_audit('service_operator.create', 'service_operator', v_id, null,
      (select to_jsonb(o.*) from public.service_operators o where o.id = v_id), payload->>'change_reason');
  else
    if not public.has_directory_permission('directory.edit_draft') then
      raise exception 'not_authorized: directory.edit_draft required' using errcode = 'insufficient_privilege';
    end if;
    update public.service_operators set
      name = coalesce(payload->>'name', name),
      country = coalesce(nullif(payload->>'country', ''), country),
      website_url = case when payload ? 'website_url' then nullif(payload->>'website_url', '') else website_url end,
      notes = case when payload ? 'notes' then nullif(payload->>'notes', '') else notes end
    where id = v_id;
    if not found then
      raise exception 'not_found: service_operator %', v_id using errcode = 'no_data_found';
    end if;
    perform public.record_directory_audit('service_operator.update', 'service_operator', v_id, null,
      (select to_jsonb(o.*) from public.service_operators o where o.id = v_id), payload->>'change_reason');
  end if;
  return v_id;
end;
$$;

revoke all on function public.admin_upsert_service_operator(jsonb) from public;
grant execute on function public.admin_upsert_service_operator(jsonb) to authenticated;

-- --- payment_networks (+ nested aliases) --------------------------------
create function public.admin_upsert_payment_network(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(payload->>'id', '')::uuid;
  v_is_insert boolean := v_id is null;
  v_before jsonb;
  v_new_version integer;
  v_alias jsonb;
  v_current_state text;
begin
  if v_is_insert then
    if not public.has_directory_permission('directory.create') then
      raise exception 'not_authorized: directory.create required' using errcode = 'insufficient_privilege';
    end if;
    insert into public.payment_networks (
      slug, canonical_name, display_name_en, display_name_rw, description_en, description_rw,
      entity_type, country, regulatory_authority_id,
      full_interoperability_effective_date, separate_registration_required, separate_app_required,
      access_channel_summary_en, access_channel_summary_rw, custody_note_en, custody_note_rw,
      official_source_url, official_source_label, verified_at, verified_by, review_due_at,
      created_by
    ) values (
      payload->>'slug', payload->>'canonical_name', payload->>'display_name_en',
      nullif(payload->>'display_name_rw', ''), nullif(payload->>'description_en', ''),
      nullif(payload->>'description_rw', ''),
      payload->>'entity_type', coalesce(nullif(payload->>'country', ''), 'RW'),
      nullif(payload->>'regulatory_authority_id', '')::uuid,
      nullif(payload->>'full_interoperability_effective_date', '')::date,
      (payload->>'separate_registration_required')::boolean,
      (payload->>'separate_app_required')::boolean,
      nullif(payload->>'access_channel_summary_en', ''), nullif(payload->>'access_channel_summary_rw', ''),
      nullif(payload->>'custody_note_en', ''), nullif(payload->>'custody_note_rw', ''),
      nullif(payload->>'official_source_url', ''), nullif(payload->>'official_source_label', ''),
      case when (payload->>'verified')::boolean then now() end,
      case when (payload->>'verified')::boolean then auth.uid() end,
      nullif(payload->>'review_due_at', '')::timestamptz,
      auth.uid()
    )
    returning id, version into v_id, v_new_version;
    v_before := null;
  else
    if not public.has_directory_permission('directory.edit_draft') then
      raise exception 'not_authorized: directory.edit_draft required' using errcode = 'insufficient_privilege';
    end if;
    select to_jsonb(n.*), n.state into v_before, v_current_state
    from public.payment_networks n where id = v_id;
    if v_before is null then
      raise exception 'not_found: payment_network %', v_id using errcode = 'no_data_found';
    end if;

    update public.payment_networks set
      canonical_name = coalesce(payload->>'canonical_name', canonical_name),
      display_name_en = coalesce(payload->>'display_name_en', display_name_en),
      display_name_rw = case when payload ? 'display_name_rw' then nullif(payload->>'display_name_rw', '') else display_name_rw end,
      description_en = case when payload ? 'description_en' then nullif(payload->>'description_en', '') else description_en end,
      description_rw = case when payload ? 'description_rw' then nullif(payload->>'description_rw', '') else description_rw end,
      entity_type = coalesce(payload->>'entity_type', entity_type),
      country = coalesce(nullif(payload->>'country', ''), country),
      regulatory_authority_id = case when payload ? 'regulatory_authority_id' then nullif(payload->>'regulatory_authority_id', '')::uuid else regulatory_authority_id end,
      full_interoperability_effective_date = case when payload ? 'full_interoperability_effective_date' then nullif(payload->>'full_interoperability_effective_date', '')::date else full_interoperability_effective_date end,
      separate_registration_required = case when payload ? 'separate_registration_required' then (payload->>'separate_registration_required')::boolean else separate_registration_required end,
      separate_app_required = case when payload ? 'separate_app_required' then (payload->>'separate_app_required')::boolean else separate_app_required end,
      access_channel_summary_en = case when payload ? 'access_channel_summary_en' then nullif(payload->>'access_channel_summary_en', '') else access_channel_summary_en end,
      access_channel_summary_rw = case when payload ? 'access_channel_summary_rw' then nullif(payload->>'access_channel_summary_rw', '') else access_channel_summary_rw end,
      custody_note_en = case when payload ? 'custody_note_en' then nullif(payload->>'custody_note_en', '') else custody_note_en end,
      custody_note_rw = case when payload ? 'custody_note_rw' then nullif(payload->>'custody_note_rw', '') else custody_note_rw end,
      official_source_url = case when payload ? 'official_source_url' then nullif(payload->>'official_source_url', '') else official_source_url end,
      official_source_label = case when payload ? 'official_source_label' then nullif(payload->>'official_source_label', '') else official_source_label end,
      verified_at = case when (payload->>'verified')::boolean is true then now()
                         when (payload->>'verified')::boolean is false then null else verified_at end,
      verified_by = case when (payload->>'verified')::boolean is true then auth.uid()
                         when (payload->>'verified')::boolean is false then null else verified_by end,
      review_due_at = case when payload ? 'review_due_at' then nullif(payload->>'review_due_at', '')::timestamptz else review_due_at end,
      -- Material change to a live row returns it to review unless the
      -- editor explicitly flags a minor edit AND can self-approve it.
      state = case
        when v_current_state in ('published', 'temporarily_unavailable')
             and coalesce((payload->>'minor_edit')::boolean, false) is not true
        then 'pending_review' else state end,
      version = version + 1
    where id = v_id
    returning version into v_new_version;
  end if;

  -- Replace aliases if provided.
  if payload ? 'aliases' then
    delete from public.directory_aliases where subject_type = 'payment_network' and subject_id = v_id;
    for v_alias in select * from jsonb_array_elements(payload->'aliases')
    loop
      insert into public.directory_aliases (alias, normalized_alias, subject_type, subject_id, is_primary)
      values (v_alias->>'alias', '', 'payment_network', v_id, coalesce((v_alias->>'is_primary')::boolean, false))
      on conflict (normalized_alias, subject_type, subject_id) do nothing;
    end loop;
  end if;

  perform public.record_directory_version('payment_network', v_id,
    jsonb_build_object(
      'network', (select to_jsonb(n.*) from public.payment_networks n where n.id = v_id),
      'aliases', coalesce((select jsonb_agg(to_jsonb(a.*) order by a.alias) from public.directory_aliases a
                           where a.subject_type = 'payment_network' and a.subject_id = v_id), '[]'::jsonb)
    ),
    payload->>'change_reason', v_new_version);

  perform public.record_directory_audit(
    case when v_is_insert then 'payment_network.create' else 'payment_network.update' end,
    'payment_network', v_id, v_before,
    (select to_jsonb(n.*) from public.payment_networks n where n.id = v_id),
    payload->>'change_reason');

  return v_id;
end;
$$;

revoke all on function public.admin_upsert_payment_network(jsonb) from public;
grant execute on function public.admin_upsert_payment_network(jsonb) to authenticated;

-- --- payment_network_operators -----------------------------------------
create function public.admin_upsert_network_operator(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(payload->>'id', '')::uuid;
  v_network uuid := nullif(payload->>'payment_network_id', '')::uuid;
  v_role text := coalesce(nullif(payload->>'operator_role', ''), 'system_operator');
  v_new_version integer;
begin
  if v_id is null then
    if not public.has_directory_permission('directory.create') then
      raise exception 'not_authorized: directory.create required' using errcode = 'insufficient_privilege';
    end if;
    -- Close the prior current row for this (network, role).
    update public.payment_network_operators
    set is_current = false, effective_to = coalesce(effective_to, now())
    where payment_network_id = v_network and operator_role = v_role and is_current;

    insert into public.payment_network_operators (
      payment_network_id, service_operator_id, operator_role,
      effective_from, is_current, official_source_url, official_source_label,
      verified_at, verified_by, created_by
    ) values (
      v_network, (payload->>'service_operator_id')::uuid, v_role,
      coalesce(nullif(payload->>'effective_from', '')::timestamptz, now()),
      coalesce((payload->>'is_current')::boolean, true),
      nullif(payload->>'official_source_url', ''), nullif(payload->>'official_source_label', ''),
      case when (payload->>'verified')::boolean then now() end,
      case when (payload->>'verified')::boolean then auth.uid() end,
      auth.uid()
    )
    returning id into v_id;
  else
    if not public.has_directory_permission('directory.edit_draft') then
      raise exception 'not_authorized: directory.edit_draft required' using errcode = 'insufficient_privilege';
    end if;
    update public.payment_network_operators set
      operator_role = coalesce(nullif(payload->>'operator_role', ''), operator_role),
      effective_to = case when payload ? 'effective_to' then nullif(payload->>'effective_to', '')::timestamptz else effective_to end,
      is_current = coalesce((payload->>'is_current')::boolean, is_current),
      official_source_url = case when payload ? 'official_source_url' then nullif(payload->>'official_source_url', '') else official_source_url end,
      official_source_label = case when payload ? 'official_source_label' then nullif(payload->>'official_source_label', '') else official_source_label end,
      verified_at = case when (payload->>'verified')::boolean is true then now()
                         when (payload->>'verified')::boolean is false then null else verified_at end,
      verified_by = case when (payload->>'verified')::boolean is true then auth.uid()
                         when (payload->>'verified')::boolean is false then null else verified_by end
    where id = v_id;
    if not found then
      raise exception 'not_found: payment_network_operator %', v_id using errcode = 'no_data_found';
    end if;
    select payment_network_id into v_network from public.payment_network_operators where id = v_id;
  end if;

  select version + 0 into v_new_version from public.payment_networks where id = v_network;
  perform public.record_directory_version('network_operator', v_id,
    (select to_jsonb(o.*) from public.payment_network_operators o where o.id = v_id),
    payload->>'change_reason', coalesce(v_new_version, 1));
  perform public.record_directory_audit('network_operator.upsert', 'network_operator', v_id, null,
    (select to_jsonb(o.*) from public.payment_network_operators o where o.id = v_id),
    payload->>'change_reason');
  return v_id;
end;
$$;

revoke all on function public.admin_upsert_network_operator(jsonb) from public;
grant execute on function public.admin_upsert_network_operator(jsonb) to authenticated;

-- --- institution_network_participation --------------------------------
create function public.admin_upsert_institution_participation(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(payload->>'id', '')::uuid;
  v_is_insert boolean := v_id is null;
  v_before jsonb;
  v_new_version integer;
  v_current_state text;
begin
  if v_is_insert then
    if not public.has_directory_permission('directory.create') then
      raise exception 'not_authorized: directory.create required' using errcode = 'insufficient_privilege';
    end if;
    insert into public.institution_network_participation (
      provider_id, payment_network_id, participant_role,
      official_source_url, official_source_label, verified_at, verified_by, review_due_at,
      created_by
    ) values (
      (payload->>'provider_id')::uuid, (payload->>'payment_network_id')::uuid, payload->>'participant_role',
      nullif(payload->>'official_source_url', ''), nullif(payload->>'official_source_label', ''),
      case when (payload->>'verified')::boolean then now() end,
      case when (payload->>'verified')::boolean then auth.uid() end,
      nullif(payload->>'review_due_at', '')::timestamptz,
      auth.uid()
    )
    returning id, version into v_id, v_new_version;
  else
    if not public.has_directory_permission('directory.edit_draft') then
      raise exception 'not_authorized: directory.edit_draft required' using errcode = 'insufficient_privilege';
    end if;
    select to_jsonb(p.*), p.state into v_before, v_current_state
    from public.institution_network_participation p where id = v_id;
    if v_before is null then
      raise exception 'not_found: institution_network_participation %', v_id using errcode = 'no_data_found';
    end if;
    update public.institution_network_participation set
      participant_role = coalesce(payload->>'participant_role', participant_role),
      official_source_url = case when payload ? 'official_source_url' then nullif(payload->>'official_source_url', '') else official_source_url end,
      official_source_label = case when payload ? 'official_source_label' then nullif(payload->>'official_source_label', '') else official_source_label end,
      verified_at = case when (payload->>'verified')::boolean is true then now()
                         when (payload->>'verified')::boolean is false then null else verified_at end,
      verified_by = case when (payload->>'verified')::boolean is true then auth.uid()
                         when (payload->>'verified')::boolean is false then null else verified_by end,
      review_due_at = case when payload ? 'review_due_at' then nullif(payload->>'review_due_at', '')::timestamptz else review_due_at end,
      state = case
        when v_current_state in ('published', 'temporarily_unavailable')
             and coalesce((payload->>'minor_edit')::boolean, false) is not true
        then 'pending_review' else state end,
      version = version + 1
    where id = v_id
    returning version into v_new_version;
  end if;

  perform public.record_directory_version('institution_participation', v_id,
    (select to_jsonb(p.*) from public.institution_network_participation p where p.id = v_id),
    payload->>'change_reason', v_new_version);
  perform public.record_directory_audit(
    case when v_is_insert then 'institution_participation.create' else 'institution_participation.update' end,
    'institution_participation', v_id, v_before,
    (select to_jsonb(p.*) from public.institution_network_participation p where p.id = v_id),
    payload->>'change_reason');
  return v_id;
end;
$$;

revoke all on function public.admin_upsert_institution_participation(jsonb) from public;
grant execute on function public.admin_upsert_institution_participation(jsonb) to authenticated;

-- --- access_routes (+ nested flows / menu_steps / fees / limits) ------
create function public.admin_upsert_access_route(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(payload->>'id', '')::uuid;
  v_is_insert boolean := v_id is null;
  v_before jsonb;
  v_new_version integer;
  v_current_state text;
  v_row jsonb;
  v_pos integer := 0;
  v_forbidden text[] := array['pin', 'otp', 'password', 'secret', 'credential', 'security_answer', 'card_cvv', 'cvv'];
begin
  if v_is_insert then
    if not public.has_directory_permission('directory.create') then
      raise exception 'not_authorized: directory.create required' using errcode = 'insufficient_privilege';
    end if;
    insert into public.access_routes (
      slug, provider_id, payment_network_id, participation_id, channel,
      service_code_id, approved_entry_point_en, internet_required, device_compat,
      display_name_en, display_name_rw, description_en, description_rw, risk_text, caution_text,
      replacement_route_id, official_source_url, official_source_label,
      verified_at, verified_by, review_due_at, created_by
    ) values (
      payload->>'slug', (payload->>'provider_id')::uuid,
      nullif(payload->>'payment_network_id', '')::uuid,
      nullif(payload->>'participation_id', '')::uuid,
      payload->>'channel',
      nullif(payload->>'service_code_id', '')::uuid,
      nullif(payload->>'approved_entry_point_en', ''),
      coalesce((payload->>'internet_required')::boolean, false),
      coalesce((select array_agg(value::text) from jsonb_array_elements_text(payload->'device_compat')), '{}'::text[]),
      payload->>'display_name_en', nullif(payload->>'display_name_rw', ''),
      nullif(payload->>'description_en', ''), nullif(payload->>'description_rw', ''),
      nullif(payload->>'risk_text', ''), nullif(payload->>'caution_text', ''),
      nullif(payload->>'replacement_route_id', '')::uuid,
      nullif(payload->>'official_source_url', ''), nullif(payload->>'official_source_label', ''),
      case when (payload->>'verified')::boolean then now() end,
      case when (payload->>'verified')::boolean then auth.uid() end,
      nullif(payload->>'review_due_at', '')::timestamptz,
      auth.uid()
    )
    returning id, version into v_id, v_new_version;
  else
    if not public.has_directory_permission('directory.edit_draft') then
      raise exception 'not_authorized: directory.edit_draft required' using errcode = 'insufficient_privilege';
    end if;
    select to_jsonb(r.*), r.state into v_before, v_current_state
    from public.access_routes r where id = v_id;
    if v_before is null then
      raise exception 'not_found: access_route %', v_id using errcode = 'no_data_found';
    end if;
    update public.access_routes set
      payment_network_id = case when payload ? 'payment_network_id' then nullif(payload->>'payment_network_id', '')::uuid else payment_network_id end,
      participation_id = case when payload ? 'participation_id' then nullif(payload->>'participation_id', '')::uuid else participation_id end,
      channel = coalesce(payload->>'channel', channel),
      service_code_id = case when payload ? 'service_code_id' then nullif(payload->>'service_code_id', '')::uuid else service_code_id end,
      approved_entry_point_en = case when payload ? 'approved_entry_point_en' then nullif(payload->>'approved_entry_point_en', '') else approved_entry_point_en end,
      internet_required = coalesce((payload->>'internet_required')::boolean, internet_required),
      device_compat = coalesce((select array_agg(value::text) from jsonb_array_elements_text(payload->'device_compat')), device_compat),
      display_name_en = coalesce(payload->>'display_name_en', display_name_en),
      display_name_rw = case when payload ? 'display_name_rw' then nullif(payload->>'display_name_rw', '') else display_name_rw end,
      description_en = case when payload ? 'description_en' then nullif(payload->>'description_en', '') else description_en end,
      description_rw = case when payload ? 'description_rw' then nullif(payload->>'description_rw', '') else description_rw end,
      risk_text = case when payload ? 'risk_text' then nullif(payload->>'risk_text', '') else risk_text end,
      caution_text = case when payload ? 'caution_text' then nullif(payload->>'caution_text', '') else caution_text end,
      replacement_route_id = case when payload ? 'replacement_route_id' then nullif(payload->>'replacement_route_id', '')::uuid else replacement_route_id end,
      official_source_url = case when payload ? 'official_source_url' then nullif(payload->>'official_source_url', '') else official_source_url end,
      official_source_label = case when payload ? 'official_source_label' then nullif(payload->>'official_source_label', '') else official_source_label end,
      verified_at = case when (payload->>'verified')::boolean is true then now()
                         when (payload->>'verified')::boolean is false then null else verified_at end,
      verified_by = case when (payload->>'verified')::boolean is true then auth.uid()
                         when (payload->>'verified')::boolean is false then null else verified_by end,
      review_due_at = case when payload ? 'review_due_at' then nullif(payload->>'review_due_at', '')::timestamptz else review_due_at end,
      state = case
        when v_current_state in ('published', 'temporarily_unavailable')
             and coalesce((payload->>'minor_edit')::boolean, false) is not true
        then 'pending_review' else state end,
      version = version + 1
    where id = v_id
    returning version into v_new_version;
  end if;

  if payload ? 'supported_flows' then
    delete from public.route_supported_flows where access_route_id = v_id;
    for v_row in select * from jsonb_array_elements(payload->'supported_flows')
    loop
      insert into public.route_supported_flows (access_route_id, flow_type, note_en)
      values (v_id, v_row->>'flow_type', nullif(v_row->>'note_en', ''))
      on conflict (access_route_id, flow_type) do nothing;
    end loop;
  end if;

  if payload ? 'menu_steps' then
    delete from public.route_menu_steps where access_route_id = v_id;
    v_pos := 0;
    for v_row in select * from jsonb_array_elements(payload->'menu_steps')
    loop
      if lower(coalesce(v_row->>'parameter_key', '')) = any (v_forbidden) then
        raise exception 'payment_secret_forbidden: menu step parameter_key may not be a PIN/OTP/secret'
          using errcode = 'check_violation';
      end if;
      insert into public.route_menu_steps (
        access_route_id, position, action_label_en, action_label_rw,
        instruction_en, instruction_rw, expected_menu_label_en, expected_option_number,
        parameter_key, caution_en, caution_rw, channel_applicability
      ) values (
        v_id, coalesce((v_row->>'position')::integer, v_pos),
        nullif(v_row->>'action_label_en', ''), nullif(v_row->>'action_label_rw', ''),
        v_row->>'instruction_en', nullif(v_row->>'instruction_rw', ''),
        nullif(v_row->>'expected_menu_label_en', ''), nullif(v_row->>'expected_option_number', ''),
        nullif(v_row->>'parameter_key', ''), nullif(v_row->>'caution_en', ''), nullif(v_row->>'caution_rw', ''),
        coalesce((select array_agg(value::text) from jsonb_array_elements_text(v_row->'channel_applicability')), '{}'::text[])
      );
      v_pos := v_pos + 1;
    end loop;
  end if;

  if payload ? 'fees' then
    delete from public.route_fees where scope = 'institution' and access_route_id = v_id;
    for v_row in select * from jsonb_array_elements(payload->'fees')
    loop
      insert into public.route_fees (
        scope, access_route_id, fee_type, fixed_fee_minor, percentage_bps,
        min_fee_minor, max_fee_minor, currency, source_url, source_label, note_en, created_by
      ) values (
        'institution', v_id, v_row->>'fee_type',
        nullif(v_row->>'fixed_fee_minor', '')::bigint, nullif(v_row->>'percentage_bps', '')::integer,
        nullif(v_row->>'min_fee_minor', '')::bigint, nullif(v_row->>'max_fee_minor', '')::bigint,
        coalesce(nullif(v_row->>'currency', ''), 'RWF'),
        nullif(v_row->>'source_url', ''), nullif(v_row->>'source_label', ''), nullif(v_row->>'note_en', ''),
        auth.uid()
      );
    end loop;
  end if;

  if payload ? 'limits' then
    delete from public.route_limits where scope = 'institution' and access_route_id = v_id;
    for v_row in select * from jsonb_array_elements(payload->'limits')
    loop
      insert into public.route_limits (
        scope, access_route_id, min_txn_minor, max_txn_minor, daily_limit_minor,
        currency, is_published_maximum, institution_override, source_url, source_label, note_en, created_by
      ) values (
        'institution', v_id,
        nullif(v_row->>'min_txn_minor', '')::bigint, nullif(v_row->>'max_txn_minor', '')::bigint,
        nullif(v_row->>'daily_limit_minor', '')::bigint,
        coalesce(nullif(v_row->>'currency', ''), 'RWF'),
        coalesce((v_row->>'is_published_maximum')::boolean, false),
        coalesce((v_row->>'institution_override')::boolean, true),
        nullif(v_row->>'source_url', ''), nullif(v_row->>'source_label', ''), nullif(v_row->>'note_en', ''),
        auth.uid()
      );
    end loop;
  end if;

  perform public.record_directory_version('access_route', v_id,
    jsonb_build_object(
      'route', (select to_jsonb(r.*) from public.access_routes r where r.id = v_id),
      'supported_flows', coalesce((select jsonb_agg(to_jsonb(f.*) order by f.flow_type) from public.route_supported_flows f where f.access_route_id = v_id), '[]'::jsonb),
      'menu_steps', coalesce((select jsonb_agg(to_jsonb(s.*) order by s.position) from public.route_menu_steps s where s.access_route_id = v_id), '[]'::jsonb),
      'fees', coalesce((select jsonb_agg(to_jsonb(x.*)) from public.route_fees x where x.scope = 'institution' and x.access_route_id = v_id), '[]'::jsonb),
      'limits', coalesce((select jsonb_agg(to_jsonb(x.*)) from public.route_limits x where x.scope = 'institution' and x.access_route_id = v_id), '[]'::jsonb)
    ),
    payload->>'change_reason', v_new_version);

  perform public.record_directory_audit(
    case when v_is_insert then 'access_route.create' else 'access_route.update' end,
    'access_route', v_id, v_before,
    (select to_jsonb(r.*) from public.access_routes r where r.id = v_id),
    payload->>'change_reason');
  return v_id;
end;
$$;

revoke all on function public.admin_upsert_access_route(jsonb) from public;
grant execute on function public.admin_upsert_access_route(jsonb) to authenticated;

-- --- network-scope fees / limits (not nested under a route) -----------
create function public.admin_upsert_network_fee(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(payload->>'id', '')::uuid;
begin
  if not public.has_directory_permission('directory.edit_draft') then
    raise exception 'not_authorized: directory.edit_draft required' using errcode = 'insufficient_privilege';
  end if;
  if v_id is null then
    insert into public.route_fees (
      scope, payment_network_id, fee_type, fixed_fee_minor, percentage_bps,
      min_fee_minor, max_fee_minor, currency, source_url, source_label, note_en, created_by
    ) values (
      'network', (payload->>'payment_network_id')::uuid, payload->>'fee_type',
      nullif(payload->>'fixed_fee_minor', '')::bigint, nullif(payload->>'percentage_bps', '')::integer,
      nullif(payload->>'min_fee_minor', '')::bigint, nullif(payload->>'max_fee_minor', '')::bigint,
      coalesce(nullif(payload->>'currency', ''), 'RWF'),
      nullif(payload->>'source_url', ''), nullif(payload->>'source_label', ''), nullif(payload->>'note_en', ''),
      auth.uid()
    )
    returning id into v_id;
  else
    update public.route_fees set
      fee_type = coalesce(payload->>'fee_type', fee_type),
      fixed_fee_minor = case when payload ? 'fixed_fee_minor' then nullif(payload->>'fixed_fee_minor', '')::bigint else fixed_fee_minor end,
      percentage_bps = case when payload ? 'percentage_bps' then nullif(payload->>'percentage_bps', '')::integer else percentage_bps end,
      min_fee_minor = case when payload ? 'min_fee_minor' then nullif(payload->>'min_fee_minor', '')::bigint else min_fee_minor end,
      max_fee_minor = case when payload ? 'max_fee_minor' then nullif(payload->>'max_fee_minor', '')::bigint else max_fee_minor end,
      currency = coalesce(nullif(payload->>'currency', ''), currency),
      source_url = case when payload ? 'source_url' then nullif(payload->>'source_url', '') else source_url end,
      source_label = case when payload ? 'source_label' then nullif(payload->>'source_label', '') else source_label end,
      note_en = case when payload ? 'note_en' then nullif(payload->>'note_en', '') else note_en end
    where id = v_id and scope = 'network';
    if not found then
      raise exception 'not_found: network route_fee %', v_id using errcode = 'no_data_found';
    end if;
  end if;
  perform public.record_directory_audit('network_fee.upsert', 'payment_network',
    (select payment_network_id from public.route_fees where id = v_id), null,
    (select to_jsonb(x.*) from public.route_fees x where x.id = v_id), payload->>'change_reason');
  return v_id;
end;
$$;

revoke all on function public.admin_upsert_network_fee(jsonb) from public;
grant execute on function public.admin_upsert_network_fee(jsonb) to authenticated;

create function public.admin_upsert_network_limit(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(payload->>'id', '')::uuid;
begin
  if not public.has_directory_permission('directory.edit_draft') then
    raise exception 'not_authorized: directory.edit_draft required' using errcode = 'insufficient_privilege';
  end if;
  if v_id is null then
    insert into public.route_limits (
      scope, payment_network_id, min_txn_minor, max_txn_minor, daily_limit_minor,
      currency, is_published_maximum, institution_override, source_url, source_label, note_en, created_by
    ) values (
      'network', (payload->>'payment_network_id')::uuid,
      nullif(payload->>'min_txn_minor', '')::bigint, nullif(payload->>'max_txn_minor', '')::bigint,
      nullif(payload->>'daily_limit_minor', '')::bigint,
      coalesce(nullif(payload->>'currency', ''), 'RWF'),
      coalesce((payload->>'is_published_maximum')::boolean, false),
      coalesce((payload->>'institution_override')::boolean, false),
      nullif(payload->>'source_url', ''), nullif(payload->>'source_label', ''), nullif(payload->>'note_en', ''),
      auth.uid()
    )
    returning id into v_id;
  else
    update public.route_limits set
      min_txn_minor = case when payload ? 'min_txn_minor' then nullif(payload->>'min_txn_minor', '')::bigint else min_txn_minor end,
      max_txn_minor = case when payload ? 'max_txn_minor' then nullif(payload->>'max_txn_minor', '')::bigint else max_txn_minor end,
      daily_limit_minor = case when payload ? 'daily_limit_minor' then nullif(payload->>'daily_limit_minor', '')::bigint else daily_limit_minor end,
      currency = coalesce(nullif(payload->>'currency', ''), currency),
      is_published_maximum = coalesce((payload->>'is_published_maximum')::boolean, is_published_maximum),
      institution_override = coalesce((payload->>'institution_override')::boolean, institution_override),
      source_url = case when payload ? 'source_url' then nullif(payload->>'source_url', '') else source_url end,
      source_label = case when payload ? 'source_label' then nullif(payload->>'source_label', '') else source_label end,
      note_en = case when payload ? 'note_en' then nullif(payload->>'note_en', '') else note_en end
    where id = v_id and scope = 'network';
    if not found then
      raise exception 'not_found: network route_limit %', v_id using errcode = 'no_data_found';
    end if;
  end if;
  perform public.record_directory_audit('network_limit.upsert', 'payment_network',
    (select payment_network_id from public.route_limits where id = v_id), null,
    (select to_jsonb(x.*) from public.route_limits x where x.id = v_id), payload->>'change_reason');
  return v_id;
end;
$$;

revoke all on function public.admin_upsert_network_limit(jsonb) from public;
grant execute on function public.admin_upsert_network_limit(jsonb) to authenticated;

-- --- directory_sources -----------------------------------------------
create function public.admin_upsert_directory_source(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(payload->>'id', '')::uuid;
begin
  if v_id is null then
    if not public.has_directory_permission('directory.create') then
      raise exception 'not_authorized: directory.create required' using errcode = 'insufficient_privilege';
    end if;
    insert into public.directory_sources (organization, title, classification, source_url, publication_date, is_public, created_by)
    values (
      payload->>'organization', nullif(payload->>'title', ''), payload->>'classification',
      nullif(payload->>'source_url', ''), nullif(payload->>'publication_date', '')::date,
      coalesce((payload->>'is_public')::boolean, false), auth.uid()
    )
    returning id into v_id;
    perform public.record_directory_audit('directory_source.create', 'directory_source', v_id, null,
      (select to_jsonb(s.*) from public.directory_sources s where s.id = v_id), payload->>'change_reason');
  else
    if not public.has_directory_permission('directory.edit_draft') then
      raise exception 'not_authorized: directory.edit_draft required' using errcode = 'insufficient_privilege';
    end if;
    update public.directory_sources set
      organization = coalesce(payload->>'organization', organization),
      title = case when payload ? 'title' then nullif(payload->>'title', '') else title end,
      classification = coalesce(payload->>'classification', classification),
      source_url = case when payload ? 'source_url' then nullif(payload->>'source_url', '') else source_url end,
      publication_date = case when payload ? 'publication_date' then nullif(payload->>'publication_date', '')::date else publication_date end,
      is_public = coalesce((payload->>'is_public')::boolean, is_public)
    where id = v_id;
    if not found then
      raise exception 'not_found: directory_source %', v_id using errcode = 'no_data_found';
    end if;
    perform public.record_directory_audit('directory_source.update', 'directory_source', v_id, null,
      (select to_jsonb(s.*) from public.directory_sources s where s.id = v_id), payload->>'change_reason');
  end if;
  return v_id;
end;
$$;

revoke all on function public.admin_upsert_directory_source(jsonb) from public;
grant execute on function public.admin_upsert_directory_source(jsonb) to authenticated;

-- --- directory_evidence attach / detach -----------------------------
create function public.admin_attach_directory_evidence(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.has_directory_permission('directory.manage_evidence') then
    raise exception 'not_authorized: directory.manage_evidence required' using errcode = 'insufficient_privilege';
  end if;
  insert into public.directory_evidence (
    source_id, subject_type, subject_id, storage_path, mime_type, byte_size, checksum,
    uploaded_by, verified_by, verification_date, next_review_date, internal_note, public_caveat_en, is_public
  ) values (
    (payload->>'source_id')::uuid, payload->>'subject_type', (payload->>'subject_id')::uuid,
    nullif(payload->>'storage_path', ''), nullif(payload->>'mime_type', ''),
    nullif(payload->>'byte_size', '')::bigint, nullif(payload->>'checksum', ''),
    auth.uid(),
    case when (payload->>'verified')::boolean then auth.uid() end,
    case when (payload->>'verified')::boolean then now() end,
    nullif(payload->>'next_review_date', '')::timestamptz,
    nullif(payload->>'internal_note', ''), nullif(payload->>'public_caveat_en', ''),
    coalesce((payload->>'is_public')::boolean, false)
  )
  returning id into v_id;
  perform public.record_directory_audit('directory_evidence.attach', payload->>'subject_type',
    (payload->>'subject_id')::uuid, null,
    (select to_jsonb(e.*) - 'storage_path' from public.directory_evidence e where e.id = v_id),
    payload->>'change_reason');
  return v_id;
end;
$$;

revoke all on function public.admin_attach_directory_evidence(jsonb) from public;
grant execute on function public.admin_attach_directory_evidence(jsonb) to authenticated;

create function public.admin_detach_directory_evidence(p_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
begin
  if not public.has_directory_permission('directory.manage_evidence') then
    raise exception 'not_authorized: directory.manage_evidence required' using errcode = 'insufficient_privilege';
  end if;
  select to_jsonb(e.*) - 'storage_path' into v_row from public.directory_evidence e where e.id = p_id;
  if v_row is null then
    raise exception 'not_found: directory_evidence %', p_id using errcode = 'no_data_found';
  end if;
  delete from public.directory_evidence where id = p_id;
  perform public.record_directory_audit('directory_evidence.detach', v_row->>'subject_type',
    (v_row->>'subject_id')::uuid, v_row, null, p_reason);
end;
$$;

revoke all on function public.admin_detach_directory_evidence(uuid, text) from public;
grant execute on function public.admin_detach_directory_evidence(uuid, text) to authenticated;

-- ===========================================================================
-- 14. Publication state machine RPCs (one per lifecycled entity). Same
-- allowed-transition matrix as Phase M; per-transition permission
-- (maker-checker). pending_review -> published additionally requires
-- directory.publish. Deprecating a live row requires a reason.
-- ===========================================================================
create function public.admin_set_payment_network_state(p_id uuid, p_state text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
  v_before jsonb;
  v_perm text;
begin
  select state, to_jsonb(n.*) into v_current, v_before
  from public.payment_networks n where id = p_id for update;
  if v_current is null then
    raise exception 'not_found: payment_network %', p_id using errcode = 'no_data_found';
  end if;
  if not public.directory_transition_allowed(v_current, p_state) then
    raise exception 'invalid_transition: % -> %', v_current, p_state using errcode = 'check_violation';
  end if;
  v_perm := public.directory_transition_permission(v_current, p_state);
  if not public.has_directory_permission(v_perm) then
    raise exception 'not_authorized: % required', v_perm using errcode = 'insufficient_privilege';
  end if;
  if p_state = 'published' and not public.has_directory_permission('directory.publish') then
    raise exception 'not_authorized: directory.publish required' using errcode = 'insufficient_privilege';
  end if;
  if p_state = 'deprecated' and coalesce(trim(p_reason), '') = '' then
    raise exception 'reason_required: deprecating a published record needs a public replacement explanation'
      using errcode = 'check_violation';
  end if;

  update public.payment_networks set state = p_state, version = version + 1 where id = p_id;
  perform public.record_directory_version('payment_network', p_id,
    jsonb_build_object('network', (select to_jsonb(n.*) from public.payment_networks n where n.id = p_id),
                       'transition', jsonb_build_object('from', v_current, 'to', p_state)),
    coalesce(p_reason, format('state %s -> %s', v_current, p_state)),
    (select version from public.payment_networks where id = p_id));
  perform public.record_directory_audit('payment_network.state_change', 'payment_network', p_id, v_before,
    (select to_jsonb(n.*) from public.payment_networks n where n.id = p_id),
    coalesce(p_reason, format('state %s -> %s', v_current, p_state)));
end;
$$;

revoke all on function public.admin_set_payment_network_state(uuid, text, text) from public;
grant execute on function public.admin_set_payment_network_state(uuid, text, text) to authenticated;

create function public.admin_set_participation_state(p_id uuid, p_state text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
  v_before jsonb;
  v_perm text;
begin
  select state, to_jsonb(p.*) into v_current, v_before
  from public.institution_network_participation p where id = p_id for update;
  if v_current is null then
    raise exception 'not_found: institution_network_participation %', p_id using errcode = 'no_data_found';
  end if;
  if not public.directory_transition_allowed(v_current, p_state) then
    raise exception 'invalid_transition: % -> %', v_current, p_state using errcode = 'check_violation';
  end if;
  v_perm := public.directory_transition_permission(v_current, p_state);
  if not public.has_directory_permission(v_perm) then
    raise exception 'not_authorized: % required', v_perm using errcode = 'insufficient_privilege';
  end if;
  if p_state = 'published' and not public.has_directory_permission('directory.publish') then
    raise exception 'not_authorized: directory.publish required' using errcode = 'insufficient_privilege';
  end if;
  if p_state = 'deprecated' and coalesce(trim(p_reason), '') = '' then
    raise exception 'reason_required' using errcode = 'check_violation';
  end if;

  update public.institution_network_participation set state = p_state, version = version + 1 where id = p_id;
  perform public.record_directory_version('institution_participation', p_id,
    jsonb_build_object('participation', (select to_jsonb(p.*) from public.institution_network_participation p where p.id = p_id),
                       'transition', jsonb_build_object('from', v_current, 'to', p_state)),
    coalesce(p_reason, format('state %s -> %s', v_current, p_state)),
    (select version from public.institution_network_participation where id = p_id));
  perform public.record_directory_audit('institution_participation.state_change', 'institution_participation', p_id, v_before,
    (select to_jsonb(p.*) from public.institution_network_participation p where p.id = p_id),
    coalesce(p_reason, format('state %s -> %s', v_current, p_state)));
end;
$$;

revoke all on function public.admin_set_participation_state(uuid, text, text) from public;
grant execute on function public.admin_set_participation_state(uuid, text, text) to authenticated;

create function public.admin_set_access_route_state(p_id uuid, p_state text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
  v_before jsonb;
  v_perm text;
begin
  select state, to_jsonb(r.*) into v_current, v_before
  from public.access_routes r where id = p_id for update;
  if v_current is null then
    raise exception 'not_found: access_route %', p_id using errcode = 'no_data_found';
  end if;
  if not public.directory_transition_allowed(v_current, p_state) then
    raise exception 'invalid_transition: % -> %', v_current, p_state using errcode = 'check_violation';
  end if;
  v_perm := public.directory_transition_permission(v_current, p_state);
  if not public.has_directory_permission(v_perm) then
    raise exception 'not_authorized: % required', v_perm using errcode = 'insufficient_privilege';
  end if;
  if p_state = 'published' and not public.has_directory_permission('directory.publish') then
    raise exception 'not_authorized: directory.publish required' using errcode = 'insufficient_privilege';
  end if;
  if p_state = 'deprecated' and coalesce(trim(p_reason), '') = '' then
    raise exception 'reason_required' using errcode = 'check_violation';
  end if;

  update public.access_routes set state = p_state, version = version + 1 where id = p_id;
  perform public.record_directory_version('access_route', p_id,
    jsonb_build_object('route', (select to_jsonb(r.*) from public.access_routes r where r.id = p_id),
                       'transition', jsonb_build_object('from', v_current, 'to', p_state)),
    coalesce(p_reason, format('state %s -> %s', v_current, p_state)),
    (select version from public.access_routes where id = p_id));
  perform public.record_directory_audit('access_route.state_change', 'access_route', p_id, v_before,
    (select to_jsonb(r.*) from public.access_routes r where r.id = p_id),
    coalesce(p_reason, format('state %s -> %s', v_current, p_state)));
end;
$$;

revoke all on function public.admin_set_access_route_state(uuid, text, text) from public;
grant execute on function public.admin_set_access_route_state(uuid, text, text) to authenticated;

-- ===========================================================================
-- 15. Re-issue the Phase M RPCs with has_directory_permission() guards.
-- is_platform_admin() implies every directory.* permission, so the
-- current single-operator setup, the Phase M seed, and the Phase M test
-- block are behaviourally unchanged. Bodies are otherwise identical to
-- 20260906000000_phase_m_ussd_directory.sql.
-- ===========================================================================
create or replace function public.admin_upsert_service_code(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_is_insert boolean;
  v_before jsonb;
  v_new_version integer;
  v_param jsonb;
  v_step jsonb;
  v_step_pos integer := 0;
begin
  v_id := nullif(payload->>'id', '')::uuid;
  v_is_insert := v_id is null;

  if v_is_insert then
    if not public.has_directory_permission('directory.create') then
      raise exception 'not_authorized: directory.create required' using errcode = 'insufficient_privilege';
    end if;
  else
    if not public.has_directory_permission('directory.edit_draft') then
      raise exception 'not_authorized: directory.edit_draft required' using errcode = 'insufficient_privilege';
    end if;
  end if;

  if v_is_insert then
    insert into public.service_codes (
      provider_id, slug, category, intent,
      display_name_en, display_name_rw, description_en, description_rw,
      ussd_template, accepts_parameters, supported_networks,
      official_source_url, official_source_label,
      verified_at, verified_by, review_due_at,
      risk_text, caution_text, replacement_code_id,
      created_by
    ) values (
      (payload->>'provider_id')::uuid,
      payload->>'slug',
      payload->>'category',
      nullif(payload->>'intent', ''),
      payload->>'display_name_en',
      nullif(payload->>'display_name_rw', ''),
      nullif(payload->>'description_en', ''),
      nullif(payload->>'description_rw', ''),
      payload->>'ussd_template',
      coalesce((payload->>'accepts_parameters')::boolean, false),
      coalesce(
        (select array_agg(value::text) from jsonb_array_elements_text(payload->'supported_networks')),
        '{}'::text[]
      ),
      nullif(payload->>'official_source_url', ''),
      nullif(payload->>'official_source_label', ''),
      case when (payload->>'verified')::boolean then now() end,
      case when (payload->>'verified')::boolean then auth.uid() end,
      nullif(payload->>'review_due_at', '')::timestamptz,
      nullif(payload->>'risk_text', ''),
      nullif(payload->>'caution_text', ''),
      nullif(payload->>'replacement_code_id', '')::uuid,
      auth.uid()
    )
    returning id into v_id;
    v_before := null;
    v_new_version := 1;
  else
    select to_jsonb(sc.*) into v_before from public.service_codes sc where id = v_id;
    if v_before is null then
      raise exception 'not_found: service_code %', v_id using errcode = 'no_data_found';
    end if;

    update public.service_codes set
      provider_id = coalesce((payload->>'provider_id')::uuid, provider_id),
      category = coalesce(payload->>'category', category),
      intent = case when payload ? 'intent' then nullif(payload->>'intent', '') else intent end,
      display_name_en = coalesce(payload->>'display_name_en', display_name_en),
      display_name_rw = case when payload ? 'display_name_rw' then nullif(payload->>'display_name_rw', '') else display_name_rw end,
      description_en = case when payload ? 'description_en' then nullif(payload->>'description_en', '') else description_en end,
      description_rw = case when payload ? 'description_rw' then nullif(payload->>'description_rw', '') else description_rw end,
      ussd_template = coalesce(payload->>'ussd_template', ussd_template),
      accepts_parameters = coalesce((payload->>'accepts_parameters')::boolean, accepts_parameters),
      supported_networks = coalesce(
        (select array_agg(value::text) from jsonb_array_elements_text(payload->'supported_networks')),
        supported_networks
      ),
      official_source_url = case when payload ? 'official_source_url' then nullif(payload->>'official_source_url', '') else official_source_url end,
      official_source_label = case when payload ? 'official_source_label' then nullif(payload->>'official_source_label', '') else official_source_label end,
      verified_at = case
        when (payload->>'verified')::boolean is true then now()
        when (payload->>'verified')::boolean is false then null
        else verified_at end,
      verified_by = case
        when (payload->>'verified')::boolean is true then auth.uid()
        when (payload->>'verified')::boolean is false then null
        else verified_by end,
      review_due_at = case when payload ? 'review_due_at' then nullif(payload->>'review_due_at', '')::timestamptz else review_due_at end,
      risk_text = case when payload ? 'risk_text' then nullif(payload->>'risk_text', '') else risk_text end,
      caution_text = case when payload ? 'caution_text' then nullif(payload->>'caution_text', '') else caution_text end,
      replacement_code_id = case when payload ? 'replacement_code_id' then nullif(payload->>'replacement_code_id', '')::uuid else replacement_code_id end,
      version = version + 1
    where id = v_id
    returning version into v_new_version;
  end if;

  if payload ? 'parameters' then
    delete from public.service_code_parameters where service_code_id = v_id;
    for v_param in select * from jsonb_array_elements(payload->'parameters')
    loop
      insert into public.service_code_parameters (
        service_code_id, key, label_en, label_rw, kind, required, position,
        format_regex, format_hint_en, format_hint_rw, min_length, max_length
      ) values (
        v_id,
        v_param->>'key',
        v_param->>'label_en',
        nullif(v_param->>'label_rw', ''),
        v_param->>'kind',
        coalesce((v_param->>'required')::boolean, true),
        coalesce((v_param->>'position')::integer, 0),
        nullif(v_param->>'format_regex', ''),
        nullif(v_param->>'format_hint_en', ''),
        nullif(v_param->>'format_hint_rw', ''),
        nullif(v_param->>'min_length', '')::integer,
        nullif(v_param->>'max_length', '')::integer
      );
    end loop;
  end if;

  if payload ? 'steps' then
    delete from public.service_code_steps where service_code_id = v_id;
    for v_step in select * from jsonb_array_elements(payload->'steps')
    loop
      insert into public.service_code_steps (service_code_id, position, instruction_en, instruction_rw)
      values (
        v_id,
        coalesce((v_step->>'position')::integer, v_step_pos),
        v_step->>'instruction_en',
        nullif(v_step->>'instruction_rw', '')
      );
      v_step_pos := v_step_pos + 1;
    end loop;
  end if;

  insert into public.service_code_versions (service_code_id, version, snapshot, change_reason, changed_by)
  values (
    v_id,
    v_new_version,
    jsonb_build_object(
      'code', (select to_jsonb(sc.*) from public.service_codes sc where id = v_id),
      'parameters', coalesce((select jsonb_agg(to_jsonb(p.*) order by p.position) from public.service_code_parameters p where p.service_code_id = v_id), '[]'::jsonb),
      'steps', coalesce((select jsonb_agg(to_jsonb(s.*) order by s.position) from public.service_code_steps s where s.service_code_id = v_id), '[]'::jsonb)
    ),
    nullif(payload->>'change_reason', ''),
    auth.uid()
  );

  insert into public.service_directory_audit_events (actor_user_id, action, service_code_id, before_state, after_state, reason)
  values (
    auth.uid(),
    case when v_is_insert then 'service_code.create' else 'service_code.update' end,
    v_id,
    v_before,
    (select to_jsonb(sc.*) from public.service_codes sc where id = v_id),
    nullif(payload->>'change_reason', '')
  );

  return v_id;
end;
$$;

create or replace function public.admin_set_service_code_state(p_id uuid, p_state text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
  v_before jsonb;
  v_perm text;
begin
  select state, to_jsonb(sc.*) into v_current, v_before
  from public.service_codes sc where id = p_id
  for update;

  if v_current is null then
    raise exception 'not_found: service_code %', p_id using errcode = 'no_data_found';
  end if;

  if not public.directory_transition_allowed(v_current, p_state) then
    raise exception 'invalid_transition: % -> %', v_current, p_state using errcode = 'check_violation';
  end if;

  v_perm := public.directory_transition_permission(v_current, p_state);
  if not public.has_directory_permission(v_perm) then
    raise exception 'not_authorized: % required', v_perm using errcode = 'insufficient_privilege';
  end if;
  if p_state = 'published' and not public.has_directory_permission('directory.publish') then
    raise exception 'not_authorized: directory.publish required' using errcode = 'insufficient_privilege';
  end if;

  update public.service_codes
  set state = p_state, version = version + 1
  where id = p_id;

  insert into public.service_code_versions (service_code_id, version, snapshot, change_reason, changed_by)
  select
    p_id,
    sc.version,
    jsonb_build_object('code', to_jsonb(sc.*), 'transition', jsonb_build_object('from', v_current, 'to', p_state)),
    coalesce(p_reason, format('state %s -> %s', v_current, p_state)),
    auth.uid()
  from public.service_codes sc where sc.id = p_id;

  insert into public.service_directory_audit_events (actor_user_id, action, service_code_id, before_state, after_state, reason)
  values (
    auth.uid(),
    'service_code.state_change',
    p_id,
    v_before,
    (select to_jsonb(sc.*) from public.service_codes sc where id = p_id),
    coalesce(p_reason, format('state %s -> %s', v_current, p_state))
  );
end;
$$;

create or replace function public.admin_resolve_service_code_report(p_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
begin
  if not public.has_directory_permission('directory.resolve_reports') then
    raise exception 'not_authorized: directory.resolve_reports required' using errcode = 'insufficient_privilege';
  end if;

  if p_status not in ('open', 'reviewing', 'resolved', 'dismissed') then
    raise exception 'invalid_status: %', p_status using errcode = 'check_violation';
  end if;

  select to_jsonb(r.*) into v_before from public.service_code_reports r where id = p_id;
  if v_before is null then
    raise exception 'not_found: report %', p_id using errcode = 'no_data_found';
  end if;

  update public.service_code_reports set
    status = p_status,
    resolution_note = coalesce(p_note, resolution_note),
    resolved_by = case when p_status in ('resolved', 'dismissed') then auth.uid() else resolved_by end,
    resolved_at = case when p_status in ('resolved', 'dismissed') then now() else null end
  where id = p_id;

  insert into public.service_directory_audit_events (actor_user_id, action, service_code_id, before_state, after_state, reason)
  select auth.uid(), 'service_code_report.triage', r.service_code_id, v_before, to_jsonb(r.*), p_note
  from public.service_code_reports r where r.id = p_id;
end;
$$;

-- ===========================================================================
-- 16. RLS
-- ===========================================================================
alter table public.directory_role_grants enable row level security;
alter table public.regulatory_authorities enable row level security;
alter table public.service_operators enable row level security;
alter table public.payment_networks enable row level security;
alter table public.payment_network_operators enable row level security;
alter table public.institution_network_participation enable row level security;
alter table public.access_routes enable row level security;
alter table public.route_supported_flows enable row level security;
alter table public.route_menu_steps enable row level security;
alter table public.route_fees enable row level security;
alter table public.route_limits enable row level security;
alter table public.directory_sources enable row level security;
alter table public.directory_evidence enable row level security;
alter table public.directory_aliases enable row level security;
alter table public.directory_versions enable row level security;

-- Reusable "this network row is visible to me" predicate is inlined per
-- policy (a SQL helper would need its own grant; inlining matches Phase M).

create policy directory_role_grants_select on public.directory_role_grants
  for select to authenticated
  using (user_id = auth.uid() or public.has_directory_permission('directory.view_admin'));

create policy regulatory_authorities_select on public.regulatory_authorities
  for select to authenticated using (true);

create policy service_operators_select on public.service_operators
  for select to authenticated using (true);

create policy payment_networks_select on public.payment_networks
  for select to authenticated
  using (
    public.has_directory_permission('directory.view_admin')
    or (state = 'published' and effective_from <= now()
        and (effective_to is null or effective_to > now()))
  );

create policy payment_network_operators_select on public.payment_network_operators
  for select to authenticated
  using (
    public.has_directory_permission('directory.view_admin')
    or exists (
      select 1 from public.payment_networks n
      where n.id = payment_network_id
        and n.state = 'published' and n.effective_from <= now()
        and (n.effective_to is null or n.effective_to > now())
    )
  );

create policy institution_network_participation_select on public.institution_network_participation
  for select to authenticated
  using (
    public.has_directory_permission('directory.view_admin')
    or (state = 'published' and effective_from <= now()
        and (effective_to is null or effective_to > now()))
  );

create policy access_routes_select on public.access_routes
  for select to authenticated
  using (
    public.has_directory_permission('directory.view_admin')
    or (state = 'published' and effective_from <= now()
        and (effective_to is null or effective_to > now()))
  );

create policy route_supported_flows_select on public.route_supported_flows
  for select to authenticated
  using (exists (
    select 1 from public.access_routes r
    where r.id = access_route_id
      and (
        public.has_directory_permission('directory.view_admin')
        or (r.state = 'published' and r.effective_from <= now()
            and (r.effective_to is null or r.effective_to > now()))
      )
  ));

create policy route_menu_steps_select on public.route_menu_steps
  for select to authenticated
  using (exists (
    select 1 from public.access_routes r
    where r.id = access_route_id
      and (
        public.has_directory_permission('directory.view_admin')
        or (r.state = 'published' and r.effective_from <= now()
            and (r.effective_to is null or r.effective_to > now()))
      )
  ));

create policy route_fees_select on public.route_fees
  for select to authenticated
  using (
    public.has_directory_permission('directory.view_admin')
    or (scope = 'network' and exists (
      select 1 from public.payment_networks n where n.id = payment_network_id
        and n.state = 'published' and n.effective_from <= now()
        and (n.effective_to is null or n.effective_to > now())))
    or (scope = 'institution' and exists (
      select 1 from public.access_routes r where r.id = access_route_id
        and r.state = 'published' and r.effective_from <= now()
        and (r.effective_to is null or r.effective_to > now())))
  );

create policy route_limits_select on public.route_limits
  for select to authenticated
  using (
    public.has_directory_permission('directory.view_admin')
    or (scope = 'network' and exists (
      select 1 from public.payment_networks n where n.id = payment_network_id
        and n.state = 'published' and n.effective_from <= now()
        and (n.effective_to is null or n.effective_to > now())))
    or (scope = 'institution' and exists (
      select 1 from public.access_routes r where r.id = access_route_id
        and r.state = 'published' and r.effective_from <= now()
        and (r.effective_to is null or r.effective_to > now())))
  );

create policy directory_sources_select on public.directory_sources
  for select to authenticated
  using (is_public or public.has_directory_permission('directory.view_evidence'));

create policy directory_evidence_select on public.directory_evidence
  for select to authenticated
  using (public.has_directory_permission('directory.view_evidence'));

create policy directory_aliases_select on public.directory_aliases
  for select to authenticated
  using (
    public.has_directory_permission('directory.view_admin')
    or (subject_type = 'payment_network' and exists (
      select 1 from public.payment_networks n where n.id = subject_id
        and n.state = 'published' and n.effective_from <= now()
        and (n.effective_to is null or n.effective_to > now())))
    or (subject_type = 'access_route' and exists (
      select 1 from public.access_routes r where r.id = subject_id
        and r.state = 'published' and r.effective_from <= now()
        and (r.effective_to is null or r.effective_to > now())))
    or (subject_type = 'service_code' and exists (
      select 1 from public.service_codes c where c.id = subject_id
        and c.state = 'published' and c.effective_from <= now()
        and (c.effective_to is null or c.effective_to > now())))
    or (subject_type = 'service_provider' and exists (
      select 1 from public.service_providers p where p.id = subject_id and p.status = 'active'))
  );

create policy directory_versions_select on public.directory_versions
  for select to authenticated
  using (public.has_directory_permission('directory.view_audit'));

-- ===========================================================================
-- 17. Grants. `anon` gets nothing. `authenticated` gets SELECT on the
-- public-readable directory tables (all writes go through the RPCs above)
-- + directory_evidence metadata for view_evidence holders (bytes are
-- served separately via a signed URL). service_role keeps full access.
-- ===========================================================================
revoke all on public.directory_role_grants from anon;
revoke all on public.regulatory_authorities from anon;
revoke all on public.service_operators from anon;
revoke all on public.payment_networks from anon;
revoke all on public.payment_network_operators from anon;
revoke all on public.institution_network_participation from anon;
revoke all on public.access_routes from anon;
revoke all on public.route_supported_flows from anon;
revoke all on public.route_menu_steps from anon;
revoke all on public.route_fees from anon;
revoke all on public.route_limits from anon;
revoke all on public.directory_sources from anon;
revoke all on public.directory_evidence from anon;
revoke all on public.directory_aliases from anon;
revoke all on public.directory_versions from anon;

grant select on public.directory_role_grants to authenticated;
grant select on public.regulatory_authorities to authenticated;
grant select on public.service_operators to authenticated;
grant select on public.payment_networks to authenticated;
grant select on public.payment_network_operators to authenticated;
grant select on public.institution_network_participation to authenticated;
grant select on public.access_routes to authenticated;
grant select on public.route_supported_flows to authenticated;
grant select on public.route_menu_steps to authenticated;
grant select on public.route_fees to authenticated;
grant select on public.route_limits to authenticated;
grant select on public.directory_sources to authenticated;
grant select on public.directory_evidence to authenticated;
grant select on public.directory_aliases to authenticated;
grant select on public.directory_versions to authenticated;

grant all on public.directory_role_grants to service_role;
grant all on public.regulatory_authorities to service_role;
grant all on public.service_operators to service_role;
grant all on public.payment_networks to service_role;
grant all on public.payment_network_operators to service_role;
grant all on public.institution_network_participation to service_role;
grant all on public.access_routes to service_role;
grant all on public.route_supported_flows to service_role;
grant all on public.route_menu_steps to service_role;
grant all on public.route_fees to service_role;
grant all on public.route_limits to service_role;
grant all on public.directory_sources to service_role;
grant all on public.directory_evidence to service_role;
grant all on public.directory_aliases to service_role;
grant all on public.directory_versions to service_role;
