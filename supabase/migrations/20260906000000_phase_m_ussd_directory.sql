-- Phase M: OneLedger Pay & Services - Phase 1 (Verified USSD Hub).
--
-- Adds the administratively-maintained USSD / financial-services
-- directory that the "Pay & Services" capability is built on. Phase 1 is
-- a *directory plus safe hand-off* only: it moves no money, holds no
-- funds, integrates no provider API, and never stores a PIN/OTP or any
-- other provider secret. See docs/pay-and-services.md and
-- docs/adr/0001-non-custodial-boundary.md.
--
-- Conventions follow Phase J/K/L exactly:
--   * uuid pk default gen_random_uuid(), timestamptz + set_updated_at()
--     trigger on mutable rows.
--   * enum-likes are `text` + CHECK (matching public.transactions), not
--     Postgres enums - so a future value is an ordinary migration, not an
--     ALTER TYPE.
--   * RLS on every table; `anon` fully revoked; `authenticated` granted
--     only the verbs it actually uses; every new function that must be
--     callable by `authenticated` gets its OWN explicit
--     `grant execute ... to authenticated` (see the Phase L
--     is_valid_nav_order incident in supabase/migrations/README.md).
--   * application-owned objects stay `postgres`-owned.
--
-- The directory is GLOBAL (not workspace-scoped): every authenticated
-- user sees the same published codes. Only the per-user tables
-- (service_favourites, service_recent_usage, service_code_reports) carry
-- user_id / workspace_id.

-- ===========================================================================
-- Platform-admin flag. The directory's create/verify/publish workflow is
-- operated by OneLedger staff, not by workspace owners - it is a
-- platform-level capability, orthogonal to workspace membership/roles.
-- ===========================================================================
alter table public.profiles
  add column if not exists is_platform_admin boolean not null default false;

comment on column public.profiles.is_platform_admin is
  'Platform-staff flag. Grants access to the Pay & Services admin surface (USSD directory verify/publish workflow, incorrect-code report triage). Orthogonal to workspace_memberships.role - a workspace owner is NOT a platform admin. Set manually by an existing operator via a privileged path; never self-serve.';

-- SECURITY DEFINER so it can read public.profiles regardless of the
-- caller's own RLS view of that table, and STABLE so the planner can
-- call it once per statement. Mirrors public.is_workspace_member()'s
-- shape. Used both in RLS policies below and by the admin RPCs.
create function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_platform_admin = true
  );
$$;

comment on function public.is_platform_admin() is
  'True iff the current auth.uid() is a platform admin (profiles.is_platform_admin). SECURITY DEFINER, used by the Pay & Services admin RLS policies and RPCs.';

revoke all on function public.is_platform_admin() from public;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.is_platform_admin() to service_role;

-- ===========================================================================
-- service_providers - MTN, Airtel, banks, utilities, government agencies.
-- ===========================================================================
create table public.service_providers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  kind text not null check (kind in (
    'mno', 'bank', 'mfi', 'utility', 'government', 'telecom', 'aggregator', 'other'
  )),
  country char(2) not null default 'RW' check (country = upper(country)),
  -- Which Mobile Money networks this provider's codes are dialable on.
  -- Empty for providers whose codes are network-agnostic (e.g. a bank
  -- USSD reachable from any SIM).
  networks text[] not null default '{}'::text[]
    check (networks <@ array['mtn', 'airtel']),
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.service_providers is
  'Directory of USSD / financial-service providers (Rwanda-first). Global, admin-maintained. Referenced by service_codes.';

create trigger set_service_providers_updated_at
  before update on public.service_providers
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- service_codes - one published, versioned USSD route / service entry.
-- ===========================================================================
create table public.service_codes (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.service_providers (id) on delete restrict,
  slug text not null unique,
  category text not null check (category in (
    'mobile_money', 'banking', 'utilities', 'government', 'taxes',
    'health_insurance', 'telecom', 'merchant_payment', 'airtime_data',
    'account_inquiry', 'other'
  )),
  -- Free-form machine hint for what the code does ('send_money',
  -- 'buy_electricity', 'check_balance', ...). Not constrained - it is a
  -- grouping/aid, not an authorization input.
  intent text,

  -- Localized display content. English is required; Kinyarwanda is
  -- optional and filled in as translations land (see the "translation-
  -- ready, no framework yet" decision in docs/pay-and-services.md).
  display_name_en text not null,
  display_name_rw text,
  description_en text,
  description_rw text,

  -- The dial string. Either a literal code ('*182#') or a parameterised
  -- template with {placeholders} that match service_code_parameters.key
  -- ('*182*1*1*{phone}*{amount}#'). The app fills and encodes this
  -- client-side (web/lib/ussd/capability.ts) - it is never dialed
  -- automatically and never has a PIN appended.
  ussd_template text not null,
  accepts_parameters boolean not null default false,
  supported_networks text[] not null default '{}'::text[]
    check (supported_networks <@ array['mtn', 'airtel']),

  -- Provenance / verification. official_source_url + label point at the
  -- authority this entry was taken from. verified_at / verified_by are
  -- NULL until an admin has actively confirmed it against that source;
  -- the UI shows a "Not officially verified" badge whenever verified_at
  -- is null, regardless of state. review_due_at drives the
  -- re-verification reminder surface.
  official_source_url text,
  official_source_label text,
  verified_at timestamptz,
  verified_by uuid references auth.users (id) on delete set null,
  review_due_at timestamptz,

  -- Publication lifecycle. Only 'published' rows in their effective
  -- window are visible to non-admins (see RLS below).
  state text not null default 'draft' check (state in (
    'draft', 'pending_review', 'published',
    'temporarily_unavailable', 'deprecated', 'archived'
  )),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  constraint service_codes_effective_window
    check (effective_to is null or effective_to > effective_from),

  -- When deprecated/replaced, point at the successor so the UI can link
  -- users forward.
  replacement_code_id uuid references public.service_codes (id) on delete set null,

  risk_text text,
  caution_text text,

  version integer not null default 1 check (version >= 1),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.service_codes is
  'One verified USSD route / financial-service entry. Global, admin-maintained, versioned. Non-admins only ever see state=''published'' rows inside their [effective_from, effective_to) window (RLS). Never dialed automatically; never carries a PIN.';

create trigger set_service_codes_updated_at
  before update on public.service_codes
  for each row execute function public.set_updated_at();

create index idx_service_codes_state_category on public.service_codes (state, category);
create index idx_service_codes_provider on public.service_codes (provider_id);
create index idx_service_codes_review_due on public.service_codes (review_due_at)
  where state = 'published';

-- ===========================================================================
-- service_code_parameters - the safe input schema for a parameterised
-- code. Drives the pre-fill form and client-side format validation.
-- ===========================================================================
create table public.service_code_parameters (
  id uuid primary key default gen_random_uuid(),
  service_code_id uuid not null references public.service_codes (id) on delete cascade,
  key text not null,
  label_en text not null,
  label_rw text,
  kind text not null check (kind in (
    'phone', 'amount', 'meter_number', 'billing_id', 'merchant_code',
    'account_reference', 'national_id', 'reference', 'text'
  )),
  required boolean not null default true,
  position integer not null default 0,
  -- Optional client-side format guard. Applied in addition to the
  -- kind's built-in rules (web/lib/ussd/capability.ts). Never a security
  -- boundary - the value is dialed by the user on their own handset.
  format_regex text,
  format_hint_en text,
  format_hint_rw text,
  min_length integer check (min_length is null or min_length >= 0),
  max_length integer check (max_length is null or max_length >= 1),
  created_at timestamptz not null default now(),
  constraint service_code_parameters_unique_key unique (service_code_id, key),
  constraint service_code_parameters_length_order
    check (min_length is null or max_length is null or min_length <= max_length)
);

comment on table public.service_code_parameters is
  'Input schema for a parameterised service_code (e.g. {phone},{amount}). Drives the pre-fill form and client-side formatting. Not an authorization boundary.';

create index idx_service_code_parameters_code on public.service_code_parameters (service_code_id, position);

-- ===========================================================================
-- service_code_steps - human-readable fallback instructions, shown when
-- direct dialing is unavailable (desktop, unsupported handset, tel: fail).
-- ===========================================================================
create table public.service_code_steps (
  id uuid primary key default gen_random_uuid(),
  service_code_id uuid not null references public.service_codes (id) on delete cascade,
  position integer not null default 0,
  instruction_en text not null,
  instruction_rw text,
  created_at timestamptz not null default now(),
  constraint service_code_steps_unique_position unique (service_code_id, position)
);

comment on table public.service_code_steps is
  'Ordered human-readable fallback steps for a service_code, shown when the dialer cannot be opened. English required, Kinyarwanda optional.';

create index idx_service_code_steps_code on public.service_code_steps (service_code_id, position);

-- ===========================================================================
-- service_code_versions - append-only change history for a service_code.
-- Written by the admin RPCs on every material change.
-- ===========================================================================
create table public.service_code_versions (
  id uuid primary key default gen_random_uuid(),
  service_code_id uuid not null references public.service_codes (id) on delete cascade,
  version integer not null check (version >= 1),
  snapshot jsonb not null,
  change_reason text,
  changed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint service_code_versions_unique unique (service_code_id, version)
);

comment on table public.service_code_versions is
  'Append-only snapshot history for service_codes (code + parameters + steps at each version). Written by the admin RPCs. Admin-readable only.';

create index idx_service_code_versions_code on public.service_code_versions (service_code_id, version desc);

-- ===========================================================================
-- service_directory_audit_events - admin action audit trail for the
-- directory (publish, deprecate, edit, report resolution).
-- ===========================================================================
create table public.service_directory_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null,
  service_code_id uuid references public.service_codes (id) on delete set null,
  before_state jsonb,
  after_state jsonb,
  reason text,
  created_at timestamptz not null default now()
);

comment on table public.service_directory_audit_events is
  'Immutable audit trail of platform-admin actions on the USSD directory. Admin-readable only; never updated or deleted by the application.';

create index idx_service_directory_audit_code on public.service_directory_audit_events (service_code_id, created_at desc);

-- ===========================================================================
-- service_code_reports - user "this code is wrong" reports.
-- ===========================================================================
create table public.service_code_reports (
  id uuid primary key default gen_random_uuid(),
  service_code_id uuid not null references public.service_codes (id) on delete cascade,
  reporter_user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid references public.workspaces (id) on delete set null,
  report_type text not null check (report_type in (
    'incorrect_code', 'outdated', 'wrong_prerequisites', 'provider_changed', 'other'
  )),
  details text,
  status text not null default 'open' check (status in (
    'open', 'reviewing', 'resolved', 'dismissed'
  )),
  resolution_note text,
  resolved_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

comment on table public.service_code_reports is
  'User-submitted corrections / "this USSD code is wrong" reports. Insert is rate-limited (<=5 open per user per rolling hour) by a BEFORE INSERT trigger. A reporter sees only their own rows; admins triage all.';

create index idx_service_code_reports_status on public.service_code_reports (status, created_at desc);
create index idx_service_code_reports_reporter on public.service_code_reports (reporter_user_id, created_at desc);

-- Rate-limit guard: at most 5 still-open reports per reporter in any
-- rolling hour. Keeps the report surface from being used to spam the
-- admin queue. Runs SECURITY INVOKER - the reporter can see their own
-- rows via RLS, which is all the count needs.
create function public.enforce_service_code_report_rate_limit()
returns trigger
language plpgsql
as $$
declare
  recent_count integer;
begin
  select count(*) into recent_count
  from public.service_code_reports
  where reporter_user_id = new.reporter_user_id
    and status = 'open'
    and created_at > now() - interval '1 hour';

  if recent_count >= 5 then
    raise exception 'rate_limited: too many open reports from this user in the last hour'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_service_code_report_rate_limit() from public;

create trigger enforce_service_code_report_rate_limit
  before insert on public.service_code_reports
  for each row execute function public.enforce_service_code_report_rate_limit();

-- ===========================================================================
-- service_favourites - per-user starred services.
-- ===========================================================================
create table public.service_favourites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid references public.workspaces (id) on delete set null,
  service_code_id uuid not null references public.service_codes (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint service_favourites_unique unique (user_id, service_code_id)
);

comment on table public.service_favourites is
  'Per-user favourited service_codes. RLS-scoped to the owning user only.';

create index idx_service_favourites_user on public.service_favourites (user_id, created_at desc);

-- ===========================================================================
-- service_recent_usage - per-user recent activity, used for the
-- "Recently used" list and privacy-conscious capability analytics.
-- Deliberately stores NO raw phone numbers, amounts, meter numbers, or
-- filled USSD strings - only which code and what kind of action/outcome.
-- ===========================================================================
create table public.service_recent_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid references public.workspaces (id) on delete set null,
  service_code_id uuid not null references public.service_codes (id) on delete cascade,
  action text not null check (action in (
    'viewed', 'copied_code', 'opened_dialer', 'used_template'
  )),
  capability_outcome text check (capability_outcome is null or capability_outcome in (
    'dialer_opened', 'dialer_unsupported', 'copied', 'fallback_shown'
  )),
  occurred_at timestamptz not null default now()
);

comment on table public.service_recent_usage is
  'Per-user recent service activity (which code, what action/outcome). NEVER stores raw phone numbers, amounts, references, or filled USSD strings. Trimmed to the newest 50 rows per user by a BEFORE INSERT trigger.';

create index idx_service_recent_usage_user on public.service_recent_usage (user_id, occurred_at desc);

-- Keep only the newest 50 rows per user - this table is a convenience
-- surface, not an audit log (that is service_directory_audit_events).
create function public.trim_service_recent_usage()
returns trigger
language plpgsql
as $$
begin
  delete from public.service_recent_usage
  where user_id = new.user_id
    and id not in (
      select id from public.service_recent_usage
      where user_id = new.user_id
      order by occurred_at desc
      limit 49
    );
  return new;
end;
$$;

revoke all on function public.trim_service_recent_usage() from public;

create trigger trim_service_recent_usage
  after insert on public.service_recent_usage
  for each row execute function public.trim_service_recent_usage();

-- ===========================================================================
-- Admin RPCs. All SECURITY DEFINER (there is deliberately no
-- INSERT/UPDATE/DELETE grant or policy for `authenticated` on the
-- directory content tables), all guarded by is_platform_admin(), all
-- write a version snapshot + an audit row.
-- ===========================================================================

-- Insert or update a service_code together with its parameters and steps,
-- in one transaction. `payload` shape (all keys optional unless noted):
--   { id?, provider_id (req on insert), slug (req on insert), category (req on insert),
--     intent?, display_name_en (req on insert), display_name_rw?, description_en?,
--     description_rw?, ussd_template (req on insert), accepts_parameters?,
--     supported_networks?, official_source_url?, official_source_label?,
--     verified?, review_due_at?, risk_text?, caution_text?, replacement_code_id?,
--     parameters?: [{ key, label_en, label_rw?, kind, required?, position?,
--                     format_regex?, format_hint_en?, format_hint_rw?, min_length?, max_length? }],
--     steps?: [{ position?, instruction_en, instruction_rw? }],
--     change_reason? }
-- `verified` = true stamps verified_at = now(), verified_by = caller.
-- State is NOT changed here - use admin_set_service_code_state.
create function public.admin_upsert_service_code(payload jsonb)
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
  if not public.is_platform_admin() then
    raise exception 'not_authorized: platform admin required' using errcode = 'insufficient_privilege';
  end if;

  v_id := nullif(payload->>'id', '')::uuid;
  v_is_insert := v_id is null;

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

  -- Replace parameters if provided.
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

  -- Replace steps if provided.
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

  -- Snapshot + audit.
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

revoke all on function public.admin_upsert_service_code(jsonb) from public;
grant execute on function public.admin_upsert_service_code(jsonb) to authenticated;

-- Move a service_code through its publication lifecycle. Permitted
-- transitions only; a stale/invalid transition raises.
create function public.admin_set_service_code_state(p_id uuid, p_state text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
  v_before jsonb;
  v_allowed boolean;
begin
  if not public.is_platform_admin() then
    raise exception 'not_authorized: platform admin required' using errcode = 'insufficient_privilege';
  end if;

  select state, to_jsonb(sc.*) into v_current, v_before
  from public.service_codes sc where id = p_id
  for update;

  if v_current is null then
    raise exception 'not_found: service_code %', p_id using errcode = 'no_data_found';
  end if;

  v_allowed := case
    when p_state = v_current then false
    when p_state = 'archived' then true
    when v_current = 'draft' and p_state = 'pending_review' then true
    when v_current = 'pending_review' and p_state in ('draft', 'published') then true
    when v_current = 'published' and p_state in ('temporarily_unavailable', 'deprecated') then true
    when v_current = 'temporarily_unavailable' and p_state in ('published', 'deprecated') then true
    when v_current = 'deprecated' and p_state = 'published' then true
    else false
  end;

  if not v_allowed then
    raise exception 'invalid_transition: % -> %', v_current, p_state using errcode = 'check_violation';
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

revoke all on function public.admin_set_service_code_state(uuid, text, text) from public;
grant execute on function public.admin_set_service_code_state(uuid, text, text) to authenticated;

-- Triage a user report.
create function public.admin_resolve_service_code_report(p_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'not_authorized: platform admin required' using errcode = 'insufficient_privilege';
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

revoke all on function public.admin_resolve_service_code_report(uuid, text, text) from public;
grant execute on function public.admin_resolve_service_code_report(uuid, text, text) to authenticated;

-- ===========================================================================
-- RLS
-- ===========================================================================
alter table public.service_providers enable row level security;
alter table public.service_codes enable row level security;
alter table public.service_code_parameters enable row level security;
alter table public.service_code_steps enable row level security;
alter table public.service_code_versions enable row level security;
alter table public.service_directory_audit_events enable row level security;
alter table public.service_code_reports enable row level security;
alter table public.service_favourites enable row level security;
alter table public.service_recent_usage enable row level security;

-- A published, in-effect code is visible to any authenticated user;
-- everything else only to platform admins.
create policy service_codes_select on public.service_codes
  for select to authenticated
  using (
    public.is_platform_admin()
    or (
      state = 'published'
      and effective_from <= now()
      and (effective_to is null or effective_to > now())
    )
  );

-- A provider is visible if it is active, or to an admin.
create policy service_providers_select on public.service_providers
  for select to authenticated
  using (public.is_platform_admin() or status = 'active');

-- Child rows follow their parent code's visibility.
create policy service_code_parameters_select on public.service_code_parameters
  for select to authenticated
  using (exists (
    select 1 from public.service_codes c
    where c.id = service_code_id
      and (
        public.is_platform_admin()
        or (c.state = 'published' and c.effective_from <= now()
            and (c.effective_to is null or c.effective_to > now()))
      )
  ));

create policy service_code_steps_select on public.service_code_steps
  for select to authenticated
  using (exists (
    select 1 from public.service_codes c
    where c.id = service_code_id
      and (
        public.is_platform_admin()
        or (c.state = 'published' and c.effective_from <= now()
            and (c.effective_to is null or c.effective_to > now()))
      )
  ));

-- History + audit: admin-readable only.
create policy service_code_versions_select on public.service_code_versions
  for select to authenticated
  using (public.is_platform_admin());

create policy service_directory_audit_events_select on public.service_directory_audit_events
  for select to authenticated
  using (public.is_platform_admin());

-- Reports: a reporter sees their own; admins see all. Insert only your
-- own. Update only by an admin (the RPC handles the real workflow, but a
-- direct status update is harmless and admin-only).
create policy service_code_reports_select on public.service_code_reports
  for select to authenticated
  using (reporter_user_id = auth.uid() or public.is_platform_admin());

create policy service_code_reports_insert on public.service_code_reports
  for insert to authenticated
  with check (reporter_user_id = auth.uid());

create policy service_code_reports_update on public.service_code_reports
  for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- Favourites + recent usage: strictly the owning user.
create policy service_favourites_all on public.service_favourites
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy service_recent_usage_all on public.service_recent_usage
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ===========================================================================
-- Grants. `anon` gets nothing anywhere; `authenticated` gets exactly the
-- verbs each surface needs. Directory content tables are read-only to
-- `authenticated` - all writes go through the admin RPCs above.
-- ===========================================================================
revoke all on public.service_providers from anon;
revoke all on public.service_codes from anon;
revoke all on public.service_code_parameters from anon;
revoke all on public.service_code_steps from anon;
revoke all on public.service_code_versions from anon;
revoke all on public.service_directory_audit_events from anon;
revoke all on public.service_code_reports from anon;
revoke all on public.service_favourites from anon;
revoke all on public.service_recent_usage from anon;

grant select on public.service_providers to authenticated;
grant select on public.service_codes to authenticated;
grant select on public.service_code_parameters to authenticated;
grant select on public.service_code_steps to authenticated;
grant select on public.service_code_versions to authenticated;
grant select on public.service_directory_audit_events to authenticated;
grant select, insert on public.service_code_reports to authenticated;
grant update (status, resolution_note, resolved_by, resolved_at) on public.service_code_reports to authenticated;
grant select, insert, delete on public.service_favourites to authenticated;
grant select, insert, delete on public.service_recent_usage to authenticated;

-- service_role keeps full access everywhere (ingestion/admin tooling),
-- consistent with the rest of the schema.
grant all on public.service_providers to service_role;
grant all on public.service_codes to service_role;
grant all on public.service_code_parameters to service_role;
grant all on public.service_code_steps to service_role;
grant all on public.service_code_versions to service_role;
grant all on public.service_directory_audit_events to service_role;
grant all on public.service_code_reports to service_role;
grant all on public.service_favourites to service_role;
grant all on public.service_recent_usage to service_role;
