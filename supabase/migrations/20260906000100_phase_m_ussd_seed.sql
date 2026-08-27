-- Phase M seed: an initial curated Rwanda USSD / services set for the
-- Pay & Services directory.
--
-- IMPORTANT - DOCUMENTED DEVIATION FROM THE MASTER PROMPT:
-- The master implementation prompt says "Do not seed an unverified
-- internet list as authoritative." At the project owner's explicit
-- direction this migration seeds a curated common-knowledge Rwanda set
-- NOW so the directory is useful on day one, but it does so honestly:
--   * every row is state='published' so it is visible,
--   * BUT verified_at IS NULL and official_source_label makes the
--     provenance plain ("Community-compiled - pending official
--     verification"),
--   * review_due_at is 14 days out so it surfaces in the admin
--     re-verification queue immediately,
--   * caution_text is set on every parameterised money-movement code,
--   * the UI renders a "Not officially verified" badge whenever
--     verified_at IS NULL, regardless of state.
-- An admin is expected to verify each entry against the provider's own
-- published documentation and stamp verified_at via the admin surface.
-- See docs/pay-and-services.md ("Seed data & the verification gap").
--
-- Idempotent: `on conflict (slug) do nothing` on providers and codes, and
-- child rows are only inserted for codes this run actually created.
-- Fixed UUIDs so the rows are stable to reference from tests.

-- --- providers --------------------------------------------------------------
insert into public.service_providers (id, slug, display_name, kind, country, networks, status)
values
  ('a0000000-0000-4000-8000-0000000000a1', 'mtn-rwanda',   'MTN Rwanda',              'mno',        'RW', array['mtn'],    'active'),
  ('a0000000-0000-4000-8000-0000000000a2', 'airtel-rwanda','Airtel Rwanda',           'mno',        'RW', array['airtel'], 'active'),
  ('a0000000-0000-4000-8000-0000000000a3', 'bank-of-kigali','Bank of Kigali',         'bank',       'RW', array[]::text[], 'active'),
  ('a0000000-0000-4000-8000-0000000000a4', 'rra',          'Rwanda Revenue Authority','government', 'RW', array[]::text[], 'active'),
  ('a0000000-0000-4000-8000-0000000000a5', 'irembo',       'Irembo',                  'government', 'RW', array[]::text[], 'active')
on conflict (slug) do nothing;

-- --- codes ----------------------------------------------------------------
-- Common defaults applied to every seeded code below.
insert into public.service_codes (
  id, provider_id, slug, category, intent,
  display_name_en, description_en,
  ussd_template, accepts_parameters, supported_networks,
  official_source_url, official_source_label,
  verified_at, review_due_at, state, caution_text
)
values
  (
    'c0000000-0000-4000-8000-00000000c001',
    'a0000000-0000-4000-8000-0000000000a1', 'mtn-momo-menu', 'mobile_money', 'open_menu',
    'MTN MoMo main menu', 'Opens the MTN Mobile Money USSD menu, where you can send money, pay, buy airtime, and check your balance.',
    '*182#', false, array['mtn'],
    'https://www.mtn.co.rw/momo/', 'Community-compiled - pending official verification',
    null, now() + interval '14 days', 'published', null
  ),
  (
    'c0000000-0000-4000-8000-00000000c002',
    'a0000000-0000-4000-8000-0000000000a1', 'mtn-momo-send', 'mobile_money', 'send_money',
    'MTN MoMo - send money', 'Prepares the MTN Mobile Money "send money to a phone number" instruction. You confirm the amount and enter your PIN on your own phone - OneLedger never sees it.',
    '*182*1*1*{phone}*{amount}#', true, array['mtn'],
    'https://www.mtn.co.rw/momo/', 'Community-compiled - pending official verification',
    null, now() + interval '14 days', 'published',
    'The exact menu path can change. If the dialled sequence does not match what your phone shows, stop and use the MTN MoMo menu (*182#) instead, then report the code.'
  ),
  (
    'c0000000-0000-4000-8000-00000000c003',
    'a0000000-0000-4000-8000-0000000000a1', 'mtn-momo-balance', 'account_inquiry', 'check_balance',
    'MTN MoMo - check balance', 'Checks your MTN Mobile Money balance.',
    '*182*6*1#', false, array['mtn'],
    'https://www.mtn.co.rw/momo/', 'Community-compiled - pending official verification',
    null, now() + interval '14 days', 'published', null
  ),
  (
    'c0000000-0000-4000-8000-00000000c004',
    'a0000000-0000-4000-8000-0000000000a1', 'mtn-airtime-self', 'airtime_data', 'buy_airtime',
    'MTN - buy airtime for yourself', 'Buys MTN airtime for the SIM you are dialling from, paid with MTN Mobile Money.',
    '*182*2*1#', false, array['mtn'],
    'https://www.mtn.co.rw/', 'Community-compiled - pending official verification',
    null, now() + interval '14 days', 'published', null
  ),
  (
    'c0000000-0000-4000-8000-00000000c005',
    'a0000000-0000-4000-8000-0000000000a2', 'airtel-money-menu', 'mobile_money', 'open_menu',
    'Airtel Money main menu', 'Opens the Airtel Money USSD menu.',
    '*500#', false, array['airtel'],
    'https://www.airtel.co.rw/airtel-money', 'Community-compiled - pending official verification',
    null, now() + interval '14 days', 'published', null
  ),
  (
    'c0000000-0000-4000-8000-00000000c006',
    'a0000000-0000-4000-8000-0000000000a2', 'airtel-money-send', 'mobile_money', 'send_money',
    'Airtel Money - send money', 'Prepares the Airtel Money "send money" instruction. You confirm and enter your PIN on your own phone.',
    '*500*1*{phone}*{amount}#', true, array['airtel'],
    'https://www.airtel.co.rw/airtel-money', 'Community-compiled - pending official verification',
    null, now() + interval '14 days', 'published',
    'The exact menu path can change. If the dialled sequence does not match what your phone shows, stop and use the Airtel Money menu (*500#) instead, then report the code.'
  ),
  (
    'c0000000-0000-4000-8000-00000000c007',
    'a0000000-0000-4000-8000-0000000000a3', 'bk-menu', 'banking', 'open_menu',
    'Bank of Kigali USSD menu', 'Opens the Bank of Kigali mobile banking USSD menu (balance, transfers, airtime).',
    '*334#', false, array[]::text[],
    'https://www.bk.rw/', 'Community-compiled - pending official verification',
    null, now() + interval '14 days', 'published', null
  ),
  (
    'c0000000-0000-4000-8000-00000000c008',
    'a0000000-0000-4000-8000-0000000000a4', 'rra-menu', 'taxes', 'open_menu',
    'RRA tax services (*800#)', 'Opens the Rwanda Revenue Authority USSD menu for declaring and paying certain taxes and fees.',
    '*800#', false, array[]::text[],
    'https://www.rra.gov.rw/', 'Community-compiled - pending official verification',
    null, now() + interval '14 days', 'published', null
  ),
  (
    'c0000000-0000-4000-8000-00000000c009',
    'a0000000-0000-4000-8000-0000000000a5', 'irembo-menu', 'government', 'open_menu',
    'Irembo government services (*909#)', 'Opens the Irembo USSD menu for paying for certain government services.',
    '*909#', false, array[]::text[],
    'https://irembo.gov.rw/', 'Community-compiled - pending official verification',
    null, now() + interval '14 days', 'published', null
  )
on conflict (slug) do nothing;

-- --- parameters (only for the parameterised codes) -------------------------
insert into public.service_code_parameters (service_code_id, key, label_en, kind, required, position, format_regex, format_hint_en)
select v.service_code_id, v.key, v.label_en, v.kind, v.required, v.position, v.format_regex, v.format_hint_en
from (values
  ('c0000000-0000-4000-8000-00000000c002'::uuid, 'phone',  'Recipient phone number', 'phone',  true, 0, '^(07[2389][0-9]{7}|\+?25007[2389][0-9]{7})$', 'A Rwandan mobile number, e.g. 0781234567'),
  ('c0000000-0000-4000-8000-00000000c002'::uuid, 'amount', 'Amount (RWF)',            'amount', true, 1, '^[1-9][0-9]{1,6}$', 'Whole RWF amount, no decimals'),
  ('c0000000-0000-4000-8000-00000000c006'::uuid, 'phone',  'Recipient phone number', 'phone',  true, 0, '^(07[2389][0-9]{7}|\+?25007[2389][0-9]{7})$', 'A Rwandan mobile number, e.g. 0731234567'),
  ('c0000000-0000-4000-8000-00000000c006'::uuid, 'amount', 'Amount (RWF)',            'amount', true, 1, '^[1-9][0-9]{1,6}$', 'Whole RWF amount, no decimals')
) as v(service_code_id, key, label_en, kind, required, position, format_regex, format_hint_en)
where exists (select 1 from public.service_codes c where c.id = v.service_code_id)
  and not exists (
    select 1 from public.service_code_parameters p
    where p.service_code_id = v.service_code_id and p.key = v.key
  );

-- --- fallback steps -------------------------------------------------------
insert into public.service_code_steps (service_code_id, position, instruction_en)
select v.service_code_id, v.position, v.instruction_en
from (values
  ('c0000000-0000-4000-8000-00000000c001'::uuid, 0, 'On the phone with your MTN SIM, open the dialer and enter *182#, then press call.'),
  ('c0000000-0000-4000-8000-00000000c001'::uuid, 1, 'Follow the on-screen menu. Enter your MoMo PIN only on your phone''s own screen.'),
  ('c0000000-0000-4000-8000-00000000c002'::uuid, 0, 'Open your MTN dialer and enter *182#, then press call.'),
  ('c0000000-0000-4000-8000-00000000c002'::uuid, 1, 'Choose "Transfer / Send money", then "To phone number".'),
  ('c0000000-0000-4000-8000-00000000c002'::uuid, 2, 'Enter the recipient number, then the amount, then confirm.'),
  ('c0000000-0000-4000-8000-00000000c002'::uuid, 3, 'Enter your MoMo PIN on your phone. OneLedger never asks for it and cannot see it.'),
  ('c0000000-0000-4000-8000-00000000c005'::uuid, 0, 'On the phone with your Airtel SIM, open the dialer and enter *500#, then press call.'),
  ('c0000000-0000-4000-8000-00000000c005'::uuid, 1, 'Follow the on-screen menu. Enter your Airtel Money PIN only on your phone''s own screen.'),
  ('c0000000-0000-4000-8000-00000000c006'::uuid, 0, 'Open your Airtel dialer and enter *500#, then press call.'),
  ('c0000000-0000-4000-8000-00000000c006'::uuid, 1, 'Choose "Send Money", enter the recipient number and amount, then confirm with your PIN on your phone.')
) as v(service_code_id, position, instruction_en)
where exists (select 1 from public.service_codes c where c.id = v.service_code_id)
  and not exists (
    select 1 from public.service_code_steps s
    where s.service_code_id = v.service_code_id and s.position = v.position
  );
