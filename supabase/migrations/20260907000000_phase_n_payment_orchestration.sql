-- Phase N: OneLedger Pay & Services - Phase 2a (Assisted Quick Pay).
--
-- Payment-intent orchestration: a server-enforced state machine over
-- *prepared, handed-off* payment instructions. Still non-custodial - see
-- docs/adr/0001-non-custodial-boundary.md and 0002-payment-intent-
-- lifecycle.md:
--   * OneLedger never initiates a provider payment here, never writes the
--     `transactions` ledger, never stores a PIN/OTP/secret.
--   * an intent can only reach `successful` in Phase 2a via an explicitly
--     labelled *manual confirmation* (manually_confirmed_at set,
--     verified_at left NULL). Real `verified_at` + `requires_reconciliation`
--     + `reversed` come from Phase 2b's SMS reconciliation (system actor).
--   * `payment_reconciliations` ships here as SCHEMA ONLY so 2b is purely
--     additive.
--
-- Conventions follow Phase D/E/L/M exactly: text + CHECK enum-likes, RLS
-- via is_workspace_member(), anon revoked, explicit GRANT EXECUTE per
-- function, SECURITY DEFINER for state transitions, set_updated_at()
-- trigger on mutable rows.

-- ===========================================================================
-- trusted_recipients
-- ===========================================================================
create table public.trusted_recipients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  display_name text not null check (length(trim(both from display_name)) > 0),
  kind text not null check (kind in ('phone', 'merchant', 'biller', 'meter', 'other')),
  -- Rwandan MSISDN normalised to 2507XXXXXXXX (no +). Display form kept
  -- separately so the user's own formatting survives.
  normalized_msisdn text
    check (normalized_msisdn is null or normalized_msisdn ~ '^2507[0-9]{8}$'),
  msisdn_display text,
  provider text check (provider is null or provider in ('mtn', 'airtel', 'bank', 'other')),
  merchant_code text,
  account_reference text,
  relationship text,
  default_category text,
  default_budget_id uuid references public.budgets (id) on delete set null,
  expected_amount_min bigint check (expected_amount_min is null or expected_amount_min >= 0),
  expected_amount_max bigint check (expected_amount_max is null or expected_amount_max >= 0),
  -- NEVER 'verified_by_provider' in Phase 2 - OneLedger cannot attest to
  -- that. "saved" = just stored; "trusted_by_user" = the user explicitly
  -- marked it trusted. The UI must keep these visually distinct from any
  -- future provider verification.
  trust_status text not null default 'saved'
    check (trust_status in ('saved', 'trusted_by_user')),
  verification_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trusted_recipients_amount_order
    check (expected_amount_min is null or expected_amount_max is null
           or expected_amount_min <= expected_amount_max),
  constraint trusted_recipients_has_identifier
    check (normalized_msisdn is not null or merchant_code is not null
           or account_reference is not null)
);

comment on table public.trusted_recipients is
  'Per-workspace saved payees for Assisted Quick Pay. No PINs/secrets. trust_status is user-asserted only - never provider-verified in Phase 2.';

create trigger set_trusted_recipients_updated_at
  before update on public.trusted_recipients
  for each row execute function public.set_updated_at();

create unique index trusted_recipients_unique_identifier
  on public.trusted_recipients (
    workspace_id, kind,
    coalesce(normalized_msisdn, merchant_code, account_reference)
  );
create index idx_trusted_recipients_workspace_kind
  on public.trusted_recipients (workspace_id, kind);

-- ===========================================================================
-- payment_templates
-- ===========================================================================
create table public.payment_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  name text not null check (length(trim(both from name)) > 0),
  payment_type text not null check (payment_type in (
    'pay_person', 'pay_merchant', 'pay_bill', 'buy_electricity', 'buy_airtime', 'government'
  )),
  provider text check (provider is null or provider in ('mtn', 'airtel', 'bank', 'other')),
  source_account_id uuid references public.accounts (id) on delete set null,
  trusted_recipient_id uuid references public.trusted_recipients (id) on delete set null,
  -- Non-secret only: display name, MASKED msisdn, merchant code, meter,
  -- reference. Enforced by enforce_no_payment_secret() below.
  recipient_snapshot jsonb not null default '{}'::jsonb,
  default_amount_minor bigint check (default_amount_minor is null or default_amount_minor > 0),
  currency char(3) not null default 'RWF' check (currency = upper(currency)),
  note text,
  category text,
  budget_id uuid references public.budgets (id) on delete set null,
  service_code_id uuid references public.service_codes (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.payment_templates is
  'Reusable non-secret payment presets. recipient_snapshot may never contain pin/otp/password/secret/credential keys (enforce_no_payment_secret trigger).';

create trigger set_payment_templates_updated_at
  before update on public.payment_templates
  for each row execute function public.set_updated_at();

create index idx_payment_templates_workspace_type
  on public.payment_templates (workspace_id, payment_type);

-- Hard stop against a secret ever being persisted in a template blob.
create function public.enforce_no_payment_secret()
returns trigger
language plpgsql
as $$
begin
  if new.recipient_snapshot ?| array['pin', 'otp', 'password', 'secret', 'credential'] then
    raise exception 'payment_secret_forbidden: recipient_snapshot must not contain pin/otp/password/secret/credential'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_no_payment_secret() from public;

create trigger enforce_no_payment_secret
  before insert or update on public.payment_templates
  for each row execute function public.enforce_no_payment_secret();

-- ===========================================================================
-- payment_intents - the orchestration record.
-- ===========================================================================
create table public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  -- Server-generated. Unique per workspace so a retried create is a
  -- no-op, not a duplicate intent (master prompt "Idempotency and
  -- duplication").
  idempotency_key text not null,
  payment_type text not null check (payment_type in (
    'pay_person', 'pay_merchant', 'pay_bill', 'buy_electricity', 'buy_airtime', 'government'
  )),
  provider text check (provider is null or provider in ('mtn', 'airtel', 'bank', 'other')),
  source_account_id uuid references public.accounts (id) on delete set null,
  currency char(3) not null default 'RWF' check (currency = upper(currency)),
  amount_minor bigint not null check (amount_minor > 0),
  -- Null = "the provider will show the final fee". OneLedger does not
  -- guess a fee.
  fee_minor bigint check (fee_minor is null or fee_minor >= 0),
  recipient_kind text check (recipient_kind is null or recipient_kind in (
    'phone', 'merchant', 'biller', 'meter', 'other'
  )),
  recipient_name text,
  recipient_msisdn_normalized text
    check (recipient_msisdn_normalized is null or recipient_msisdn_normalized ~ '^2507[0-9]{8}$'),
  recipient_msisdn_masked text,
  merchant_code text,
  meter_number text,
  billing_reference text,
  government_reference text,
  service_code_id uuid references public.service_codes (id) on delete set null,
  -- The <kind>-REDACTED USSD template only (never the filled string with
  -- a real phone number / amount in it).
  ussd_string_redacted text,
  note text,
  category text,
  budget_id uuid references public.budgets (id) on delete set null,
  trusted_recipient_id uuid references public.trusted_recipients (id) on delete set null,
  template_id uuid references public.payment_templates (id) on delete set null,
  handoff_method text not null default 'none'
    check (handoff_method in ('dialer', 'copy', 'qr', 'none')),
  state text not null default 'draft' check (state in (
    'draft', 'initiated', 'awaiting_verification', 'processing',
    'successful', 'failed', 'expired', 'reversed', 'requires_reconciliation', 'cancelled'
  )),
  expires_at timestamptz,
  -- Set by Phase 2b only (SMS reconciliation).
  linked_transaction_id uuid references public.transactions (id) on delete set null,
  verified_at timestamptz,
  -- Set by an explicit user "I confirmed this with my provider" action.
  -- verified_at stays NULL - the UI renders "Manually confirmed", never a
  -- verified check.
  manually_confirmed_at timestamptz,
  manually_confirmed_by uuid references auth.users (id) on delete set null,
  -- Audit-only in 2a: was the caller's session fresh when they created
  -- this? (Soft check - no reauth gate in 2a.)
  session_fresh_at_creation boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_intents_idempotency_unique unique (workspace_id, idempotency_key),
  -- verified_at only ever co-exists with a linked transaction (2b).
  constraint payment_intents_verified_needs_link
    check (verified_at is null or linked_transaction_id is not null)
);

comment on table public.payment_intents is
  'Assisted Quick Pay orchestration record. Non-custodial: never initiates a provider payment, never writes transactions. state is governed by transition_payment_intent(). In Phase 2a, successful is only reachable via manually_confirm_payment() (manual, not verified).';

create trigger set_payment_intents_updated_at
  before update on public.payment_intents
  for each row execute function public.set_updated_at();

create index idx_payment_intents_workspace_state
  on public.payment_intents (workspace_id, state, created_at desc);
create index idx_payment_intents_workspace_creator
  on public.payment_intents (workspace_id, created_by, created_at desc);
-- For Phase 2b's deterministic SMS matching.
create index idx_payment_intents_match
  on public.payment_intents (workspace_id, recipient_msisdn_normalized, amount_minor, created_at);
create index idx_payment_intents_expiry
  on public.payment_intents (expires_at)
  where state in ('initiated', 'awaiting_verification');

-- ===========================================================================
-- payment_attempts - one row per handoff gesture (copy / dialer / QR).
-- No raw msisdn / amount / filled USSD (mirrors service_recent_usage).
-- ===========================================================================
create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null references public.payment_intents (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  attempt_no integer not null default 1 check (attempt_no >= 1),
  handoff_method text not null check (handoff_method in ('dialer', 'copy', 'qr', 'none')),
  capability_outcome text check (capability_outcome is null or capability_outcome in (
    'dialer_opened', 'dialer_unsupported', 'copied', 'qr_shown', 'fallback_shown'
  )),
  started_at timestamptz not null default now(),
  notes text
);

comment on table public.payment_attempts is
  'One row per handoff gesture on a payment_intent. Stores only the method + capability outcome - never a phone number, amount, or filled USSD string.';

create index idx_payment_attempts_intent
  on public.payment_attempts (payment_intent_id, started_at desc);

-- ===========================================================================
-- payment_events - append-only per-intent lifecycle log.
-- ===========================================================================
create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null references public.payment_intents (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  event_type text not null check (event_type in (
    'created', 'initiated', 'handoff', 'attempt_recorded', 'awaiting_verification',
    'manual_confirm', 'marked_failed', 'expired', 'cancelled', 'state_change',
    'reconciliation_linked', 'reconciliation_conflict'
  )),
  from_state text,
  to_state text,
  actor_type text not null check (actor_type in ('user', 'system', 'ingestion')),
  actor_user_id uuid references auth.users (id) on delete set null,
  reason text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.payment_events is
  'Immutable per-intent lifecycle log. Written by the payment RPCs (and by Phase 2b reconciliation). Never updated or deleted by the application.';

create index idx_payment_events_intent
  on public.payment_events (payment_intent_id, created_at);

-- ===========================================================================
-- payment_reconciliations - SCHEMA ONLY in Phase 2a. Populated by Phase 2b.
-- ===========================================================================
create table public.payment_reconciliations (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null references public.payment_intents (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  match_method text not null check (match_method in ('deterministic', 'manual', 'probabilistic')),
  match_score numeric(5, 4) check (match_score is null or (match_score >= 0 and match_score <= 1)),
  matched_on jsonb not null default '{}'::jsonb,
  status text not null default 'linked' check (status in ('linked', 'conflict', 'rejected')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint payment_reconciliations_txn_same_workspace
    foreign key (workspace_id, transaction_id)
    references public.transactions (workspace_id, id)
);

comment on table public.payment_reconciliations is
  'Links a payment_intent to the ledger transaction that satisfied it. SCHEMA ONLY in Phase 2a - populated by Phase 2b SMS reconciliation. An intent and a transaction each link at most once (partial-unique indexes below).';

create unique index payment_reconciliations_one_linked_intent
  on public.payment_reconciliations (payment_intent_id) where status = 'linked';
create unique index payment_reconciliations_one_linked_txn
  on public.payment_reconciliations (transaction_id) where status = 'linked';

-- ===========================================================================
-- payment_audit_events - config-style change trail (recipients/templates/
-- intent drafts). Distinct from payment_events (the intent lifecycle).
-- ===========================================================================
create table public.payment_audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity_type text not null check (entity_type in (
    'trusted_recipient', 'payment_template', 'payment_intent'
  )),
  entity_id uuid,
  before_state jsonb,
  after_state jsonb,
  reason text,
  created_at timestamptz not null default now()
);

comment on table public.payment_audit_events is
  'Change trail for Assisted Quick Pay config (trusted recipients, templates, intent drafts). Own-workspace readable.';

create index idx_payment_audit_events_entity
  on public.payment_audit_events (workspace_id, entity_type, entity_id, created_at desc);

-- ===========================================================================
-- State-machine RPCs. All SECURITY DEFINER, all is_workspace_member()-
-- gated, all write a payment_events row. Clients never set state directly.
-- ===========================================================================

-- Allowed transitions. `verified`/`requires_reconciliation`/`reversed` are
-- reachable only by the system/ingestion actor (Phase 2b) - a `user`
-- caller can never request them here.
create function public.payment_intent_transition_allowed(
  p_from text, p_to text, p_actor text
) returns boolean
language sql
immutable
as $$
  select case
    when p_from = p_to then false
    when p_to = 'cancelled' and p_from in ('draft', 'initiated', 'awaiting_verification') then true
    when p_from = 'draft' and p_to = 'initiated' then true
    when p_from = 'initiated' and p_to = 'awaiting_verification' then true
    when p_from in ('initiated', 'awaiting_verification') and p_to = 'failed' then true
    when p_from in ('initiated', 'awaiting_verification') and p_to = 'expired' then true
    -- system / ingestion only (Phase 2b):
    when p_actor in ('system', 'ingestion')
      and p_from in ('initiated', 'awaiting_verification', 'processing')
      and p_to in ('successful', 'requires_reconciliation') then true
    when p_actor in ('system', 'ingestion')
      and p_from = 'successful' and p_to = 'reversed' then true
    else false
  end;
$$;

revoke all on function public.payment_intent_transition_allowed(text, text, text) from public;
grant execute on function public.payment_intent_transition_allowed(text, text, text) to authenticated;

-- Create a draft intent. Server generates idempotency_key unless the
-- caller supplies one it already holds (resume / rapid double-submit).
-- Returns { id, idempotency_key, state, existed }.
create function public.create_payment_intent(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace uuid := (payload->>'workspace_id')::uuid;
  v_key text := coalesce(nullif(payload->>'idempotency_key', ''), gen_random_uuid()::text);
  v_id uuid;
  v_existed boolean := false;
  v_amount bigint := (payload->>'amount_minor')::bigint;
begin
  if not public.is_workspace_member(v_workspace, 'member') then
    raise exception 'not_authorized: not a member of this workspace' using errcode = 'insufficient_privilege';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'invalid_amount' using errcode = 'check_violation';
  end if;

  insert into public.payment_intents (
    workspace_id, created_by, idempotency_key, payment_type, provider,
    source_account_id, currency, amount_minor,
    recipient_kind, recipient_name, recipient_msisdn_normalized, recipient_msisdn_masked,
    merchant_code, meter_number, billing_reference, government_reference,
    service_code_id, ussd_string_redacted, note, category, budget_id,
    trusted_recipient_id, template_id, expires_at, session_fresh_at_creation
  ) values (
    v_workspace, auth.uid(), v_key,
    payload->>'payment_type',
    nullif(payload->>'provider', ''),
    nullif(payload->>'source_account_id', '')::uuid,
    coalesce(nullif(payload->>'currency', ''), 'RWF'),
    v_amount,
    nullif(payload->>'recipient_kind', ''),
    nullif(payload->>'recipient_name', ''),
    nullif(payload->>'recipient_msisdn_normalized', ''),
    nullif(payload->>'recipient_msisdn_masked', ''),
    nullif(payload->>'merchant_code', ''),
    nullif(payload->>'meter_number', ''),
    nullif(payload->>'billing_reference', ''),
    nullif(payload->>'government_reference', ''),
    nullif(payload->>'service_code_id', '')::uuid,
    nullif(payload->>'ussd_string_redacted', ''),
    nullif(payload->>'note', ''),
    nullif(payload->>'category', ''),
    nullif(payload->>'budget_id', '')::uuid,
    nullif(payload->>'trusted_recipient_id', '')::uuid,
    nullif(payload->>'template_id', '')::uuid,
    now() + make_interval(hours => coalesce((payload->>'ttl_hours')::int, 24)),
    coalesce((payload->>'session_fresh')::boolean, null)
  )
  on conflict (workspace_id, idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.payment_intents
    where workspace_id = v_workspace and idempotency_key = v_key;
    v_existed := true;
  else
    insert into public.payment_events (payment_intent_id, workspace_id, event_type, to_state, actor_type, actor_user_id)
    values (v_id, v_workspace, 'created', 'draft', 'user', auth.uid());
  end if;

  return jsonb_build_object(
    'id', v_id,
    'idempotency_key', v_key,
    'state', (select state from public.payment_intents where id = v_id),
    'existed', v_existed
  );
end;
$$;

revoke all on function public.create_payment_intent(jsonb) from public;
grant execute on function public.create_payment_intent(jsonb) to authenticated;

-- Patch a draft (only while state = 'draft').
create function public.update_draft_payment_intent(p_id uuid, patch jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_state text;
  v_before jsonb;
begin
  select workspace_id, state, to_jsonb(pi.*) into v_ws, v_state, v_before
  from public.payment_intents pi where id = p_id for update;
  if v_ws is null then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;
  if not public.is_workspace_member(v_ws, 'member') then
    raise exception 'not_authorized' using errcode = 'insufficient_privilege';
  end if;
  if v_state <> 'draft' then
    raise exception 'not_draft: only a draft intent can be edited' using errcode = 'check_violation';
  end if;

  update public.payment_intents set
    payment_type = coalesce(nullif(patch->>'payment_type', ''), payment_type),
    provider = case when patch ? 'provider' then nullif(patch->>'provider', '') else provider end,
    source_account_id = case when patch ? 'source_account_id' then nullif(patch->>'source_account_id', '')::uuid else source_account_id end,
    amount_minor = coalesce((patch->>'amount_minor')::bigint, amount_minor),
    recipient_kind = case when patch ? 'recipient_kind' then nullif(patch->>'recipient_kind', '') else recipient_kind end,
    recipient_name = case when patch ? 'recipient_name' then nullif(patch->>'recipient_name', '') else recipient_name end,
    recipient_msisdn_normalized = case when patch ? 'recipient_msisdn_normalized' then nullif(patch->>'recipient_msisdn_normalized', '') else recipient_msisdn_normalized end,
    recipient_msisdn_masked = case when patch ? 'recipient_msisdn_masked' then nullif(patch->>'recipient_msisdn_masked', '') else recipient_msisdn_masked end,
    merchant_code = case when patch ? 'merchant_code' then nullif(patch->>'merchant_code', '') else merchant_code end,
    meter_number = case when patch ? 'meter_number' then nullif(patch->>'meter_number', '') else meter_number end,
    billing_reference = case when patch ? 'billing_reference' then nullif(patch->>'billing_reference', '') else billing_reference end,
    government_reference = case when patch ? 'government_reference' then nullif(patch->>'government_reference', '') else government_reference end,
    service_code_id = case when patch ? 'service_code_id' then nullif(patch->>'service_code_id', '')::uuid else service_code_id end,
    ussd_string_redacted = case when patch ? 'ussd_string_redacted' then nullif(patch->>'ussd_string_redacted', '') else ussd_string_redacted end,
    note = case when patch ? 'note' then nullif(patch->>'note', '') else note end,
    category = case when patch ? 'category' then nullif(patch->>'category', '') else category end,
    budget_id = case when patch ? 'budget_id' then nullif(patch->>'budget_id', '')::uuid else budget_id end,
    trusted_recipient_id = case when patch ? 'trusted_recipient_id' then nullif(patch->>'trusted_recipient_id', '')::uuid else trusted_recipient_id end
  where id = p_id;

  if (select amount_minor from public.payment_intents where id = p_id) <= 0 then
    raise exception 'invalid_amount' using errcode = 'check_violation';
  end if;

  insert into public.payment_audit_events (workspace_id, actor_user_id, action, entity_type, entity_id, before_state, after_state)
  values (v_ws, auth.uid(), 'payment_intent.update_draft', 'payment_intent', p_id, v_before,
          (select to_jsonb(pi.*) from public.payment_intents pi where id = p_id));
end;
$$;

revoke all on function public.update_draft_payment_intent(uuid, jsonb) from public;
grant execute on function public.update_draft_payment_intent(uuid, jsonb) to authenticated;

-- Move an intent through its lifecycle as the *user* actor. Only the
-- user-reachable transitions are permitted (draft->initiated,
-- initiated->awaiting_verification, *->cancelled,
-- initiated|awaiting_verification->failed|expired). The system/ingestion
-- transitions (successful/requires_reconciliation/reversed) get their own
-- service_role-only function in Phase 2b - never exposed to an
-- authenticated caller.
create function public.transition_payment_intent(
  p_id uuid, p_to_state text, p_reason text default null, p_evidence jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_from text;
begin
  select workspace_id, state into v_ws, v_from
  from public.payment_intents where id = p_id for update;
  if v_ws is null then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;
  if not public.is_workspace_member(v_ws, 'member') then
    raise exception 'not_authorized' using errcode = 'insufficient_privilege';
  end if;

  if not public.payment_intent_transition_allowed(v_from, p_to_state, 'user') then
    raise exception 'invalid_transition: % -> %', v_from, p_to_state
      using errcode = 'check_violation';
  end if;

  update public.payment_intents set state = p_to_state where id = p_id;

  insert into public.payment_events (payment_intent_id, workspace_id, event_type, from_state, to_state, actor_type, actor_user_id, reason, evidence)
  values (
    p_id, v_ws,
    case p_to_state
      when 'initiated' then 'initiated'
      when 'awaiting_verification' then 'awaiting_verification'
      when 'failed' then 'marked_failed'
      when 'expired' then 'expired'
      when 'cancelled' then 'cancelled'
      else 'state_change'
    end,
    v_from, p_to_state, 'user', auth.uid(),
    p_reason, coalesce(p_evidence, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.transition_payment_intent(uuid, text, text, jsonb) from public;
grant execute on function public.transition_payment_intent(uuid, text, text, jsonb) to authenticated;

-- Record a handoff gesture (copy / dialer / QR).
create function public.record_payment_attempt(p_intent_id uuid, p_method text, p_outcome text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_next int;
begin
  select workspace_id into v_ws from public.payment_intents where id = p_intent_id;
  if v_ws is null then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;
  if not public.is_workspace_member(v_ws, 'member') then
    raise exception 'not_authorized' using errcode = 'insufficient_privilege';
  end if;
  if p_method not in ('dialer', 'copy', 'qr', 'none') then
    raise exception 'invalid_method' using errcode = 'check_violation';
  end if;

  select coalesce(max(attempt_no), 0) + 1 into v_next
  from public.payment_attempts where payment_intent_id = p_intent_id;

  insert into public.payment_attempts (payment_intent_id, workspace_id, attempt_no, handoff_method, capability_outcome)
  values (p_intent_id, v_ws, v_next, p_method, nullif(p_outcome, ''));

  update public.payment_intents set handoff_method = p_method where id = p_intent_id;

  insert into public.payment_events (payment_intent_id, workspace_id, event_type, actor_type, actor_user_id, evidence)
  values (p_intent_id, v_ws, 'attempt_recorded', 'user', auth.uid(),
          jsonb_build_object('method', p_method, 'outcome', p_outcome));
end;
$$;

revoke all on function public.record_payment_attempt(uuid, text, text) from public;
grant execute on function public.record_payment_attempt(uuid, text, text) to authenticated;

-- Explicit manual confirmation. Reaches `successful` but stamps
-- manually_confirmed_* and leaves verified_at NULL - the UI renders
-- "Manually confirmed", never a verified/success check.
create function public.manually_confirm_payment(p_intent_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_from text;
begin
  select workspace_id, state into v_ws, v_from
  from public.payment_intents where id = p_intent_id for update;
  if v_ws is null then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;
  if not public.is_workspace_member(v_ws, 'member') then
    raise exception 'not_authorized' using errcode = 'insufficient_privilege';
  end if;
  if v_from not in ('initiated', 'awaiting_verification') then
    raise exception 'not_confirmable: intent is %', v_from using errcode = 'check_violation';
  end if;

  update public.payment_intents set
    state = 'successful',
    manually_confirmed_at = now(),
    manually_confirmed_by = auth.uid()
  where id = p_intent_id;

  insert into public.payment_events (payment_intent_id, workspace_id, event_type, from_state, to_state, actor_type, actor_user_id, reason)
  values (p_intent_id, v_ws, 'manual_confirm', v_from, 'successful', 'user', auth.uid(), p_note);
end;
$$;

revoke all on function public.manually_confirm_payment(uuid, text) from public;
grant execute on function public.manually_confirm_payment(uuid, text) to authenticated;

-- Expire stale intents. Called by the cron route; the app also filters
-- lazily. SECURITY DEFINER + service_role/authenticated executable, but
-- it only ever touches rows the caller could already see under RLS when
-- invoked as authenticated (the cron route calls it as service_role).
create function public.expire_stale_payment_intents(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select id, workspace_id, state from public.payment_intents
    where state in ('initiated', 'awaiting_verification')
      and expires_at is not null and expires_at <= p_now
    for update skip locked
  loop
    update public.payment_intents set state = 'expired' where id = r.id;
    insert into public.payment_events (payment_intent_id, workspace_id, event_type, from_state, to_state, actor_type)
    values (r.id, r.workspace_id, 'expired', r.state, 'expired', 'system');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.expire_stale_payment_intents(timestamptz) from public;
grant execute on function public.expire_stale_payment_intents(timestamptz) to service_role;

-- ===========================================================================
-- RLS
-- ===========================================================================
alter table public.trusted_recipients enable row level security;
alter table public.payment_templates enable row level security;
alter table public.payment_intents enable row level security;
alter table public.payment_attempts enable row level security;
alter table public.payment_events enable row level security;
alter table public.payment_reconciliations enable row level security;
alter table public.payment_audit_events enable row level security;

-- Recipients + templates: full CRUD for workspace members.
create policy trusted_recipients_rw on public.trusted_recipients
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id, 'member'));

create policy payment_templates_rw on public.payment_templates
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id, 'member'));

-- Intents + their child rows: read-only to members (all writes go
-- through the SECURITY DEFINER RPCs).
create policy payment_intents_select on public.payment_intents
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy payment_attempts_select on public.payment_attempts
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy payment_events_select on public.payment_events
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy payment_reconciliations_select on public.payment_reconciliations
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy payment_audit_events_select on public.payment_audit_events
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- ===========================================================================
-- Grants. anon: nothing. authenticated: CRUD on recipients/templates,
-- select on the orchestration tables, execute on the user-callable RPCs.
-- ===========================================================================
revoke all on public.trusted_recipients from anon;
revoke all on public.payment_templates from anon;
revoke all on public.payment_intents from anon;
revoke all on public.payment_attempts from anon;
revoke all on public.payment_events from anon;
revoke all on public.payment_reconciliations from anon;
revoke all on public.payment_audit_events from anon;

grant select, insert, update, delete on public.trusted_recipients to authenticated;
grant select, insert, update, delete on public.payment_templates to authenticated;
grant select on public.payment_intents to authenticated;
grant select on public.payment_attempts to authenticated;
grant select on public.payment_events to authenticated;
grant select on public.payment_reconciliations to authenticated;
grant select on public.payment_audit_events to authenticated;

grant all on public.trusted_recipients to service_role;
grant all on public.payment_templates to service_role;
grant all on public.payment_intents to service_role;
grant all on public.payment_attempts to service_role;
grant all on public.payment_events to service_role;
grant all on public.payment_reconciliations to service_role;
grant all on public.payment_audit_events to service_role;
