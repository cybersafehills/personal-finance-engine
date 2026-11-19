-- Provider fee tariffs (OneLedger 3.0 spec section 9: "versioned, source-attributed
-- fee schedules with validity dates and provider / transaction-type applicability").
--
-- WHY A NEW TABLE. route_fees describes a payment NETWORK (eKash) or one access
-- route. A mobile-money provider's own tariff - what MTN or Airtel charges to send
-- money - belongs to the PROVIDER (service_providers), varies by transaction type
-- and by who receives the money, and is almost always tiered by amount. route_fees
-- can say "tiered" but stores no tiers, so nothing computable could ever be
-- recorded there.
--
-- WHAT THIS ADDS (no data: this migration seeds NO tariff; a number goes in only
-- from a verified, source-cited migration):
--   provider_tariffs      one tariff: provider + transaction type + recipient scope
--                         + currency + validity window + where it came from
--   provider_tariff_tiers its amount bands, each fixed / percentage / no fee
--
-- SAFETY RULES, enforced by the database rather than by convention:
--   * Invisible until verified. Clients (authenticated) can read only tariffs whose
--     verified_at is set, and only the tiers of such a tariff. Drafts exist only for
--     the service role. Nothing unverified can ever reach a screen.
--   * Verification needs evidence: a source label is mandatory on every tariff, and
--     a tariff cannot be verified until it has at least one tier.
--   * Verified means frozen: the tiers of a verified tariff cannot be inserted,
--     changed or deleted. To correct one, clear verified_at first (it disappears
--     from clients), fix it, and verify it again.
--   * Tiers cannot overlap (amount bands are inclusive and in minor units); gaps are
--     allowed and are reported by the calculator as "outside the published bands",
--     never filled in.
--   * Writes are service-role only. No client role can insert, update or delete.
--
-- Rollback: drop the two tables and the two trigger functions (nothing else
-- references them).

create table public.provider_tariffs (
  id uuid primary key default gen_random_uuid(),
  service_provider_id uuid not null references public.service_providers (id) on delete restrict,
  transaction_type text not null check (transaction_type in (
    'send_money', 'merchant_payment', 'cash_withdrawal', 'bill_payment', 'airtime', 'bank_transfer'
  )),
  -- Tariffs commonly differ by who receives the money.
  recipient_scope text not null default 'any' check (recipient_scope in (
    'any', 'same_network', 'other_network', 'unregistered'
  )),
  currency char(3) not null default 'RWF' check (currency = upper(currency)),
  effective_from timestamptz not null,
  effective_to timestamptz,
  -- Evidence. A label is always required; the link, when given, must be https.
  source_label text not null check (length(trim(source_label)) > 0),
  source_url text check (source_url is null or source_url ~ '^https://'),
  note_en text,
  -- NULL = a draft that no client can see. Set only after a human has checked every
  -- tier against the cited source.
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  constraint provider_tariffs_window check (effective_to is null or effective_to > effective_from),
  constraint provider_tariffs_unique unique (
    service_provider_id, transaction_type, recipient_scope, currency, effective_from
  )
);

comment on table public.provider_tariffs is
  'A mobile-money / bank provider''s published fee tariff for one transaction type and recipient scope, with its source and validity window. Invisible to clients until verified_at is set; verified tariffs are frozen. See 20270107000000_provider_tariffs.sql.';

create index idx_provider_tariffs_lookup
  on public.provider_tariffs (service_provider_id, transaction_type)
  where verified_at is not null;

create table public.provider_tariff_tiers (
  id uuid primary key default gen_random_uuid(),
  tariff_id uuid not null references public.provider_tariffs (id) on delete cascade,
  -- Inclusive amount band in minor units of the tariff's currency (RWF has none).
  min_amount_minor bigint not null check (min_amount_minor >= 0),
  max_amount_minor bigint check (max_amount_minor is null or max_amount_minor >= min_amount_minor),
  fee_type text not null check (fee_type in ('fixed', 'percentage', 'none')),
  fixed_fee_minor bigint check (fixed_fee_minor is null or fixed_fee_minor >= 0),
  percentage_bps integer check (percentage_bps is null or percentage_bps >= 0),
  min_fee_minor bigint check (min_fee_minor is null or min_fee_minor >= 0),
  max_fee_minor bigint check (max_fee_minor is null or max_fee_minor >= 0),
  created_at timestamptz not null default now(),
  constraint provider_tariff_tiers_unique unique (tariff_id, min_amount_minor),
  -- Exactly the fields the fee type needs, never a stray one.
  constraint provider_tariff_tiers_shape check (
    (fee_type = 'fixed'      and fixed_fee_minor is not null and percentage_bps is null) or
    (fee_type = 'percentage' and percentage_bps is not null and fixed_fee_minor is null) or
    (fee_type = 'none'       and fixed_fee_minor is null and percentage_bps is null)
  ),
  constraint provider_tariff_tiers_fee_clamp check (
    min_fee_minor is null or max_fee_minor is null or max_fee_minor >= min_fee_minor
  )
);

comment on table public.provider_tariff_tiers is
  'Amount bands of a provider tariff. Bands may not overlap; the tiers of a verified tariff are immutable.';

create index idx_provider_tariff_tiers_tariff on public.provider_tariff_tiers (tariff_id, min_amount_minor);

-- ---------------------------------------------------------------------------
-- Integrity triggers (internal; no client role is granted these).
-- ---------------------------------------------------------------------------
create or replace function public.provider_tariff_tiers_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_tariff uuid := case when tg_op = 'DELETE' then old.tariff_id else new.tariff_id end;
  v_verified timestamptz;
begin
  -- One writer per tariff at a time, so the overlap check below cannot race.
  perform pg_advisory_xact_lock(hashtextextended('provider_tariff_tiers:' || v_tariff::text, 0));

  select verified_at into v_verified from public.provider_tariffs where id = v_tariff;
  if v_verified is not null then
    raise exception 'tariff_verified_immutable'
      using errcode = '55000',
            hint = 'Clear verified_at, correct the tiers, then verify the tariff again.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  -- an UPDATE may also move a tier to another tariff: the target must not be verified
  if tg_op = 'UPDATE' and new.tariff_id <> old.tariff_id then
    select verified_at into v_verified from public.provider_tariffs where id = new.tariff_id;
    if v_verified is not null then
      raise exception 'tariff_verified_immutable' using errcode = '55000';
    end if;
  end if;

  if exists (
    select 1 from public.provider_tariff_tiers t
    where t.tariff_id = new.tariff_id
      and t.id <> new.id
      and new.min_amount_minor <= coalesce(t.max_amount_minor, 9223372036854775807)
      and t.min_amount_minor <= coalesce(new.max_amount_minor, 9223372036854775807)
  ) then
    raise exception 'tier_overlap'
      using errcode = '23P01', hint = 'Amount bands of one tariff must not overlap.';
  end if;
  return new;
end;
$$;
revoke all on function public.provider_tariff_tiers_guard() from public;

create trigger provider_tariff_tiers_guard
  before insert or update or delete on public.provider_tariff_tiers
  for each row execute function public.provider_tariff_tiers_guard();

create or replace function public.provider_tariffs_verify_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.verified_at is not null then
    if not exists (select 1 from public.provider_tariff_tiers where tariff_id = new.id) then
      raise exception 'tariff_needs_tiers'
        using errcode = '23514', hint = 'A tariff with no amount bands cannot be verified.';
    end if;
    -- Once verified, the identity of the tariff is frozen too (what it applies to
    -- and when), not just its tiers.
    if tg_op = 'UPDATE' and old.verified_at is not null and (
         new.service_provider_id is distinct from old.service_provider_id
      or new.transaction_type is distinct from old.transaction_type
      or new.recipient_scope is distinct from old.recipient_scope
      or new.currency is distinct from old.currency
      or new.effective_from is distinct from old.effective_from
      or new.effective_to is distinct from old.effective_to
      or new.source_label is distinct from old.source_label
      or new.source_url is distinct from old.source_url
    ) then
      raise exception 'tariff_verified_immutable' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.provider_tariffs_verify_guard() from public;

create trigger provider_tariffs_verify_guard
  before insert or update on public.provider_tariffs
  for each row execute function public.provider_tariffs_verify_guard();

-- ---------------------------------------------------------------------------
-- RLS: clients read verified tariffs only; nobody but the service role writes.
-- ---------------------------------------------------------------------------
alter table public.provider_tariffs enable row level security;
alter table public.provider_tariff_tiers enable row level security;

create policy provider_tariffs_select on public.provider_tariffs
  for select to authenticated
  using (verified_at is not null);

-- The subquery runs under the caller's own RLS on provider_tariffs, so a tier is
-- visible exactly when its tariff is verified.
create policy provider_tariff_tiers_select on public.provider_tariff_tiers
  for select to authenticated
  using (exists (select 1 from public.provider_tariffs p where p.id = provider_tariff_tiers.tariff_id));

revoke all on public.provider_tariffs, public.provider_tariff_tiers from anon, authenticated;
grant select on public.provider_tariffs, public.provider_tariff_tiers to authenticated;
grant select, insert, update, delete on public.provider_tariffs, public.provider_tariff_tiers to service_role;
