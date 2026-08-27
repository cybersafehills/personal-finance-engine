-- Phase P seed: the verified eKash payment-network record.
--
-- Everything here is taken from the supplied official RSwitch Ltd public
-- notice and is entered as state='published', verified_at set. Per the
-- brief (section 5) the notice contains NO bank USSD codes or menu option
-- numbers, so NO access_routes / route_menu_steps are seeded - those are
-- added later, one institution at a time, each with separate verified
-- evidence. The two institution participation rows (Bank of Kigali, MTN
-- Rwanda) are seeded as state='draft', verified_at IS NULL purely so the
-- P2 admin queues and P3 route-finder empty states have realistic rows;
-- they are never published by this migration.
--
-- Idempotent: fixed UUIDs + `on conflict do nothing`. Re-running inserts
-- nothing new.

-- --- regulatory authority + system operator -------------------------------
insert into public.regulatory_authorities (id, slug, name, country, website_url)
values ('d0000000-0000-4000-8000-0000000000d1', 'bnr', 'National Bank of Rwanda', 'RW', 'https://www.bnr.rw/')
on conflict (id) do nothing;

insert into public.service_operators (id, slug, name, country, website_url)
values ('d0000000-0000-4000-8000-0000000000d2', 'rswitch', 'RSwitch Ltd', 'RW', 'https://www.rswitch.rw/')
on conflict (id) do nothing;

-- --- eKash payment network (VERIFIED against the RSwitch notice) ----------
insert into public.payment_networks (
  id, slug, canonical_name, display_name_en,
  description_en,
  entity_type, country, regulatory_authority_id,
  full_interoperability_effective_date,
  separate_registration_required, separate_app_required,
  access_channel_summary_en, custody_note_en,
  official_source_url, official_source_label,
  verified_at, review_due_at, state
)
values (
  'd0000000-0000-4000-8000-0000000000d3', 'ekash', 'eKash', 'eKash',
  'eKash is an interoperable national payment network that lets customers move money between participating bank accounts and mobile wallets using the provider channels they already have. There is no separate registration or app. Customer funds stay in the customer''s existing regulated bank account or mobile wallet - OneLedger does not hold funds or process the payment.',
  'interoperable_network', 'RW', 'd0000000-0000-4000-8000-0000000000d1',
  '2026-07-14',
  false, false,
  'Existing USSD, mobile-banking apps, Mobile Money apps, and internet-banking services.',
  'Customer funds remain in the customer''s existing regulated bank account or mobile wallet.',
  null, 'RSwitch Ltd - official system-operator publication',
  now(), now() + interval '180 days', 'published'
)
on conflict (id) do nothing;

-- --- network <-> operator (RSwitch is the current system operator) -------
insert into public.payment_network_operators (
  id, payment_network_id, service_operator_id, operator_role,
  is_current, official_source_label, verified_at
)
values (
  'd0000000-0000-4000-8000-0000000000d4',
  'd0000000-0000-4000-8000-0000000000d3', 'd0000000-0000-4000-8000-0000000000d2',
  'system_operator', true, 'RSwitch Ltd - official system-operator publication', now()
)
on conflict (id) do nothing;

-- --- verification source for the notice ---------------------------------
insert into public.directory_sources (id, organization, title, classification, is_public, publication_date)
values (
  'd0000000-0000-4000-8000-0000000000d5', 'RSwitch Ltd',
  'eKash interoperability public notice', 'official_system_operator', true, null
)
on conflict (id) do nothing;

-- --- network-level published fee (RWF 20 maximum) ----------------------
-- Represented as a published MAXIMUM, not a guaranteed universal fee and
-- not necessarily charged by eKash itself (brief section 5).
insert into public.route_fees (
  id, scope, payment_network_id, fee_type, max_fee_minor, currency, source_url, source_label, note_en
)
values (
  'd0000000-0000-4000-8000-0000000000d6', 'network', 'd0000000-0000-4000-8000-0000000000d3',
  'published_maximum', 20, 'RWF', null, 'RSwitch Ltd - official system-operator publication',
  'Published maximum of RWF 20 per transaction. Participating financial institutions may determine applicable charges within this published framework; this is not necessarily a fee charged directly by eKash.'
)
on conflict (id) do nothing;

-- --- network-level published transaction capacity (RWF 10,000,000) -----
insert into public.route_limits (
  id, scope, payment_network_id, max_txn_minor, currency, is_published_maximum, source_label, note_en
)
values (
  'd0000000-0000-4000-8000-0000000000d7', 'network', 'd0000000-0000-4000-8000-0000000000d3',
  10000000, 'RWF', true, 'RSwitch Ltd - official system-operator publication',
  'Published platform-level per-transaction capability of RWF 10,000,000. Participating institutions may enforce lower per-transaction or daily limits under their own policies.'
)
on conflict (id) do nothing;

-- --- search aliases (brief section 12) --------------------------------
-- 'eKash' is canonical/primary; e-Kash and eCash/e-Cash are normalised
-- alternates. The normalise trigger + unique (normalized_alias, subject)
-- constraint dedupe e-Kash into eKash and e-Cash into eCash on their own.
insert into public.directory_aliases (alias, subject_type, subject_id, is_primary)
values
  ('eKash',   'payment_network', 'd0000000-0000-4000-8000-0000000000d3', true),
  ('e-Kash',  'payment_network', 'd0000000-0000-4000-8000-0000000000d3', false),
  ('eCash',   'payment_network', 'd0000000-0000-4000-8000-0000000000d3', false),
  ('e-Cash',  'payment_network', 'd0000000-0000-4000-8000-0000000000d3', false),
  ('RSwitch', 'payment_network', 'd0000000-0000-4000-8000-0000000000d3', false)
on conflict do nothing;

-- --- provider metadata: e-money issuers + regulator link --------------
update public.service_providers set emoney_issuer = true
  where slug in ('mtn-rwanda', 'airtel-rwanda') and emoney_issuer = false;
update public.service_providers set regulatory_authority_id = 'd0000000-0000-4000-8000-0000000000d1'
  where slug in ('bank-of-kigali', 'mtn-rwanda', 'airtel-rwanda') and regulatory_authority_id is null;

-- --- DRAFT, UNVERIFIED institution participation examples -------------
-- Not published. verified_at IS NULL. Present only to give the P2 admin
-- queues and the P3 route-finder a realistic "participation not yet
-- verified" state to render.
insert into public.institution_network_participation (
  id, provider_id, payment_network_id, participant_role, state, official_source_label
)
values
  (
    'd0000000-0000-4000-8000-0000000000d8',
    'a0000000-0000-4000-8000-0000000000a3', 'd0000000-0000-4000-8000-0000000000d3',
    'bank', 'draft', 'Pending official verification'
  ),
  (
    'd0000000-0000-4000-8000-0000000000d9',
    'a0000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-0000000000d3',
    'emi', 'draft', 'Pending official verification'
  )
on conflict (id) do nothing;
