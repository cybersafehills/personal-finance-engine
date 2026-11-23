-- Partners & placements (platform console).
--
-- Sponsored offers are submitted, reviewed and approved by staff; the platform
-- owner decides where and how they appear. Nothing here is reachable by a normal
-- user except `partner_feed()`, which returns only APPROVED, unexpired offers and
-- only while the owner's delivery switch is on (it is OFF by default).
--
-- Same rules as the other console workflows:
--   * RPC-only tables (RLS on, no grants to anon/authenticated)
--   * one SECURITY DEFINER function per command, each starting console_assert()
--   * the audit row is written in the same transaction as the change
--   * review history is append-only
--   * free text is never copied into audit metadata
--   * financial-provider offers need a disclosure, a review note, and an approver
--     holding approve_financial_partners (Platform Owner only)
--   * no tracking: this feed carries no user identifiers and no financial data

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
insert into public.console_role_permissions (role, permission) values
  ('platform_owner', 'view_partners'),
  ('platform_admin', 'view_partners'),
  ('finance_admin', 'view_partners'),
  ('read_only_analyst', 'view_partners'),
  ('platform_owner', 'manage_partners'),
  ('platform_admin', 'manage_partners'),
  ('platform_owner', 'manage_partner_delivery'),
  ('platform_owner', 'approve_financial_partners')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.partner_advertisers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  kind text not null check (kind in ('brand', 'agency', 'organization', 'financial_provider')),
  created_at timestamptz not null default now()
);
create unique index uq_partner_advertisers_name on public.partner_advertisers (lower(btrim(name)));

create table public.partner_offers (
  id uuid primary key default gen_random_uuid(),
  offer_no bigint generated always as identity,
  advertiser_id uuid not null references public.partner_advertisers (id),
  category text not null check (category in ('Connectivity', 'Learning', 'Banking')),
  title text not null check (char_length(btrim(title)) between 3 and 80),
  benefit text not null check (char_length(btrim(benefit)) between 3 and 160),
  eligibility text not null check (char_length(btrim(eligibility)) between 3 and 300),
  terms text not null check (char_length(btrim(terms)) between 10 and 1000),
  destination_url text not null check (destination_url ~ '^https://[^\s]+$' and char_length(destination_url) <= 500),
  country text not null default 'Rwanda' check (char_length(country) between 2 and 60),
  language text not null default 'English' check (language in ('English', 'Kinyarwanda')),
  ends_on date not null,
  home_featured boolean not null default false,
  financial_disclosure text check (financial_disclosure is null or char_length(financial_disclosure) between 40 and 600),
  status text not null default 'in_review'
    check (status in ('in_review', 'changes_requested', 'approved', 'paused', 'ended', 'rejected')),
  review_note text check (review_note is null or char_length(review_note) <= 500),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_offer_banking_disclosure check (category <> 'Banking' or financial_disclosure is not null)
);
create index idx_partner_offers_status on public.partner_offers (status, updated_at desc);

-- Append-only review history.
create table public.partner_offer_events (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.partner_offers (id) on delete cascade,
  kind text not null check (kind in ('submitted', 'approved', 'changes_requested', 'rejected', 'paused', 'resumed', 'ended')),
  actor_user_id uuid,
  actor_role text,
  note text check (note is null or char_length(note) <= 500),
  from_status text,
  to_status text,
  created_at timestamptz not null default now()
);
create index idx_partner_offer_events_offer on public.partner_offer_events (offer_id, created_at);

-- One row per placement the apps know about.
create table public.partner_placements (
  id text primary key check (id in ('home', 'pay-person', 'pay-merchant', 'plan')),
  enabled boolean not null default true,
  format text not null check (format in ('wide', 'square', 'tall', 'bar')),
  mode text not null default 'carousel' check (mode in ('static', 'carousel')),
  interval_sec integer not null default 5 check (interval_sec between 3 and 30),
  loop boolean not null default true,
  offer_ids uuid[] not null default '{}',
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.partner_placements (id, format) values
  ('home', 'wide'), ('pay-person', 'square'), ('pay-merchant', 'square'), ('plan', 'bar');

-- Single-row master switch. OFF until the platform owner turns delivery on.
create table public.partner_delivery (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.partner_delivery (singleton) values (true);

alter table public.partner_advertisers enable row level security;
alter table public.partner_offers enable row level security;
alter table public.partner_offer_events enable row level security;
alter table public.partner_placements enable row level security;
alter table public.partner_delivery enable row level security;

revoke all on public.partner_advertisers from anon, authenticated;
revoke all on public.partner_offers from anon, authenticated;
revoke all on public.partner_offer_events from anon, authenticated;
revoke all on public.partner_placements from anon, authenticated;
revoke all on public.partner_delivery from anon, authenticated;

grant select, insert, update on public.partner_advertisers to service_role;
grant select, insert, update on public.partner_offers to service_role;
grant select, insert, update on public.partner_placements to service_role;
grant select, update on public.partner_delivery to service_role;
revoke all on public.partner_offer_events from service_role;
grant select, insert on public.partner_offer_events to service_role;

create trigger partner_offer_events_append_only
  before update or delete on public.partner_offer_events
  for each row execute function public.console_append_only();
create trigger partner_offer_events_no_truncate
  before truncate on public.partner_offer_events
  for each statement execute function public.console_append_only();

-- ---------------------------------------------------------------------------
-- Overview / lists  (view_partners)
-- ---------------------------------------------------------------------------
create function public.console_partners_overview()
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
begin
  perform public.console_assert('view_partners');
  return jsonb_build_object(
    'delivery_enabled', (select enabled from public.partner_delivery),
    'counts', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
               from (select status, count(*) as n from public.partner_offers group by status) c),
    'advertisers', (select count(*) from public.partner_advertisers),
    'live_offers', (select count(*) from public.partner_offers where status = 'approved' and ends_on >= current_date)
  );
end;
$$;

create function public.console_partner_offer_list(p_status text default null, p_limit integer default 50)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
begin
  perform public.console_assert('view_partners');
  if p_status is not null and p_status not in
     ('in_review','changes_requested','approved','paused','ended','rejected','active') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(t) order by t.updated_at desc)
    from (
      select o.id, 'P-' || lpad(o.offer_no::text, 5, '0') as ref, o.title, o.category, o.status,
             a.name as advertiser, a.kind as advertiser_kind, o.ends_on, o.home_featured,
             (o.ends_on < current_date) as expired, o.updated_at
      from public.partner_offers o
      join public.partner_advertisers a on a.id = o.advertiser_id
      where (p_status is null
             or (p_status = 'active' and o.status in ('in_review','changes_requested','approved','paused'))
             or o.status = p_status)
      order by o.updated_at desc
      limit v_limit
    ) t
  ), '[]'::jsonb);
end;
$$;

create function public.console_partner_offer_get(p_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
declare
  v jsonb;
begin
  perform public.console_assert('view_partners');
  select jsonb_build_object(
    'id', o.id, 'ref', 'P-' || lpad(o.offer_no::text, 5, '0'),
    'advertiser', a.name, 'advertiser_kind', a.kind,
    'category', o.category, 'title', o.title, 'benefit', o.benefit,
    'eligibility', o.eligibility, 'terms', o.terms, 'destination_url', o.destination_url,
    'country', o.country, 'language', o.language, 'ends_on', o.ends_on,
    'home_featured', o.home_featured, 'financial_disclosure', o.financial_disclosure,
    'status', o.status, 'review_note', o.review_note, 'expired', (o.ends_on < current_date),
    'created_at', o.created_at, 'updated_at', o.updated_at,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'kind', e.kind, 'actor_role', e.actor_role,
        'actor_email', (select u.email from auth.users u where u.id = e.actor_user_id),
        'note', e.note, 'from_status', e.from_status, 'to_status', e.to_status,
        'created_at', e.created_at) order by e.created_at, e.id)
      from public.partner_offer_events e where e.offer_id = o.id), '[]'::jsonb)
  ) into v
  from public.partner_offers o join public.partner_advertisers a on a.id = o.advertiser_id
  where o.id = p_id;
  if v is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Submit an offer on an advertiser's behalf  (manage_partners)
-- ---------------------------------------------------------------------------
create function public.console_partner_offer_create(
  p_advertiser_name text,
  p_advertiser_kind text,
  p_category text,
  p_title text,
  p_benefit text,
  p_eligibility text,
  p_terms text,
  p_destination_url text,
  p_ends_on date,
  p_home_featured boolean default false,
  p_financial_disclosure text default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role text;
  v_adv uuid;
  v_id uuid;
  v_no bigint;
begin
  v_role := public.console_assert('manage_partners');
  if p_ends_on is null or p_ends_on < current_date then
    raise exception 'invalid_end_date' using errcode = '22023';
  end if;
  -- A financial provider, or any Banking offer, is a financial promotion.
  if (p_advertiser_kind = 'financial_provider' or p_category = 'Banking')
     and (p_advertiser_kind <> 'financial_provider' or p_category <> 'Banking') then
    raise exception 'financial_pairing' using errcode = '22023';
  end if;
  select id into v_adv from public.partner_advertisers where lower(btrim(name)) = lower(btrim(p_advertiser_name));
  if v_adv is null then
    insert into public.partner_advertisers (name, kind) values (btrim(p_advertiser_name), p_advertiser_kind)
      returning id into v_adv;
  elsif (select kind from public.partner_advertisers where id = v_adv) <> p_advertiser_kind then
    raise exception 'advertiser_kind_mismatch' using errcode = '22023';
  end if;
  insert into public.partner_offers
    (advertiser_id, category, title, benefit, eligibility, terms, destination_url,
     ends_on, home_featured, financial_disclosure, created_by)
  values (v_adv, p_category, btrim(p_title), btrim(p_benefit), btrim(p_eligibility), btrim(p_terms),
          btrim(p_destination_url), p_ends_on, coalesce(p_home_featured, false),
          nullif(btrim(p_financial_disclosure), ''), auth.uid())
  returning id, offer_no into v_id, v_no;
  insert into public.partner_offer_events (offer_id, kind, actor_user_id, actor_role, to_status)
    values (v_id, 'submitted', auth.uid(), v_role, 'in_review');
  perform public.console_audit_internal(v_role, 'partners.offer_submitted', 'partner_offer',
    'P-' || lpad(v_no::text, 5, '0'), 'success', jsonb_build_object('category', p_category));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Review decisions  (manage_partners; Banking needs approve_financial_partners)
-- ---------------------------------------------------------------------------
create function public.console_partner_offer_decide(p_id uuid, p_decision text, p_note text default null)
  returns text
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role text;
  v_cur text;
  v_cat text;
  v_no bigint;
  v_end date;
  v_to text;
  v_kind text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_ok boolean;
begin
  v_role := public.console_assert('manage_partners');
  if p_decision not in ('approve','request_changes','reject','pause','resume','end') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  select status, category, offer_no, ends_on into v_cur, v_cat, v_no, v_end
    from public.partner_offers where id = p_id for update;
  if v_cur is null then raise exception 'not_found' using errcode = 'P0002'; end if;

  v_to := case p_decision when 'approve' then 'approved' when 'request_changes' then 'changes_requested'
    when 'reject' then 'rejected' when 'pause' then 'paused' when 'resume' then 'approved' else 'ended' end;
  v_kind := case p_decision when 'approve' then 'approved' when 'request_changes' then 'changes_requested'
    when 'reject' then 'rejected' when 'pause' then 'paused' when 'resume' then 'resumed' else 'ended' end;
  if v_cur = v_to then return v_cur; end if;  -- idempotent
  v_ok := case p_decision
    when 'approve' then v_cur in ('in_review')
    when 'request_changes' then v_cur in ('in_review')
    when 'reject' then v_cur in ('in_review','changes_requested')
    when 'pause' then v_cur = 'approved'
    when 'resume' then v_cur = 'paused'
    else v_cur in ('approved','paused') end;
  if not v_ok then raise exception 'invalid_transition' using errcode = '22023'; end if;
  if p_decision in ('request_changes','reject','approve') and (v_note is null or char_length(v_note) < 10) then
    raise exception 'note_required' using errcode = '22023';
  end if;
  if p_decision in ('approve','resume') and v_end < current_date then
    raise exception 'offer_expired' using errcode = '22023';
  end if;
  -- Financial promotions: a second, stricter permission, Owner only.
  if v_cat = 'Banking' and p_decision in ('approve','resume') then
    perform public.console_assert('approve_financial_partners');
  end if;

  update public.partner_offers
     set status = v_to, updated_at = now(),
         review_note = case when p_decision in ('approve','request_changes','reject') then v_note else review_note end,
         reviewed_by = case when p_decision in ('approve','request_changes','reject') then auth.uid() else reviewed_by end,
         reviewed_at = case when p_decision in ('approve','request_changes','reject') then now() else reviewed_at end
   where id = p_id;
  insert into public.partner_offer_events (offer_id, kind, actor_user_id, actor_role, note, from_status, to_status)
    values (p_id, v_kind, auth.uid(), v_role, v_note, v_cur, v_to);
  perform public.console_audit_internal(v_role, 'partners.offer_' || v_kind, 'partner_offer',
    'P-' || lpad(v_no::text, 5, '0'), 'success', jsonb_build_object('from', v_cur, 'to', v_to));
  return v_to;
end;
$$;

-- ---------------------------------------------------------------------------
-- Placement settings and the master delivery switch
-- ---------------------------------------------------------------------------
create function public.console_partner_placements_get()
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
begin
  perform public.console_assert('view_partners');
  return jsonb_build_object(
    'delivery_enabled', (select enabled from public.partner_delivery),
    'placements', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'enabled', enabled, 'format', format, 'mode', mode,
        'interval_sec', interval_sec, 'loop', loop, 'offer_ids', to_jsonb(offer_ids),
        'updated_at', updated_at) order by id), '[]'::jsonb) from public.partner_placements),
    'approved_offers', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id, 'title', o.title, 'advertiser', a.name, 'category', o.category,
        'home_featured', o.home_featured, 'ends_on', o.ends_on) order by o.title), '[]'::jsonb)
      from public.partner_offers o join public.partner_advertisers a on a.id = o.advertiser_id
      where o.status = 'approved' and o.ends_on >= current_date)
  );
end;
$$;

create function public.console_partner_placement_set(
  p_id text,
  p_enabled boolean,
  p_format text,
  p_mode text,
  p_interval_sec integer,
  p_loop boolean,
  p_offer_ids uuid[] default '{}'
)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role text;
begin
  v_role := public.console_assert('manage_partners');
  if p_id not in ('home','pay-person','pay-merchant','plan') then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_format not in ('wide','square','tall','bar') or p_mode not in ('static','carousel')
     or p_interval_sec is null or p_interval_sec not between 3 and 30 then
    raise exception 'invalid_setting' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_offer_ids, '{}')) x
             where not exists (select 1 from public.partner_offers where id = x and status = 'approved')) then
    raise exception 'offer_not_approved' using errcode = '22023';
  end if;
  update public.partner_placements
     set enabled = coalesce(p_enabled, enabled), format = p_format, mode = p_mode,
         interval_sec = p_interval_sec, loop = coalesce(p_loop, loop),
         offer_ids = coalesce(p_offer_ids, '{}'), updated_by = auth.uid(), updated_at = now()
   where id = p_id;
  perform public.console_audit_internal(v_role, 'partners.placement_updated', 'partner_placement', p_id, 'success',
    jsonb_build_object('enabled', p_enabled, 'format', p_format, 'mode', p_mode, 'interval_sec', p_interval_sec));
end;
$$;

create function public.console_partner_delivery_set(p_enabled boolean)
  returns boolean
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role text;
begin
  v_role := public.console_assert('manage_partner_delivery');
  if p_enabled is null then raise exception 'invalid_setting' using errcode = '22023'; end if;
  update public.partner_delivery set enabled = p_enabled, updated_by = auth.uid(), updated_at = now();
  perform public.console_audit_internal(v_role,
    case when p_enabled then 'partners.delivery_enabled' else 'partners.delivery_disabled' end,
    'partner_delivery', 'global');
  return p_enabled;
end;
$$;

-- ---------------------------------------------------------------------------
-- The user-app feed. Any signed-in user may call it; it exposes only what is
-- meant to be shown: approved, unexpired offers and the owner's placement
-- settings, and nothing at all while delivery is off. No user data goes in or out.
-- ---------------------------------------------------------------------------
create function public.partner_feed()
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not (select enabled from public.partner_delivery) then
    return jsonb_build_object('enabled', false, 'placements', '[]'::jsonb, 'offers', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'enabled', true,
    'placements', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'enabled', enabled, 'format', format, 'mode', mode,
        'intervalSec', interval_sec, 'loop', loop, 'offerIds', to_jsonb(offer_ids)) order by id), '[]'::jsonb)
      from public.partner_placements),
    'offers', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id, 'brandId', a.id, 'brand', a.name, 'category', o.category,
        'title', o.title, 'benefit', o.benefit, 'eligibility', o.eligibility, 'terms', o.terms,
        'destination', o.destination_url, 'endsOn', o.ends_on, 'country', o.country,
        'language', o.language, 'homeFeatured', o.home_featured,
        'financialDisclosure', o.financial_disclosure) order by o.updated_at desc), '[]'::jsonb)
      from public.partner_offers o join public.partner_advertisers a on a.id = o.advertiser_id
      where o.status = 'approved' and o.ends_on >= current_date)
  );
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'console_partners_overview()',
    'console_partner_offer_list(text,integer)',
    'console_partner_offer_get(uuid)',
    'console_partner_offer_create(text,text,text,text,text,text,text,text,date,boolean,text)',
    'console_partner_offer_decide(uuid,text,text)',
    'console_partner_placements_get()',
    'console_partner_placement_set(text,boolean,text,text,integer,boolean,uuid[])',
    'console_partner_delivery_set(boolean)',
    'partner_feed()'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
