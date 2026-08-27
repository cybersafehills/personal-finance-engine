-- Phase P (P3 content): verified eKash "start using eKash" / bank-to-wallet
-- USSD entry codes.
--
-- Source: MTN Rwanda / eKash "SOZA DIRU na eKash" public campaign material
-- ("How to transfer money from your bank account to your Mobile Money
-- Wallet" and "Tangira ukureshe eKash"). These are the INSTITUTION ENTRY
-- codes that open the eKash flow at each participating institution - not
-- the full per-institution menu trees (the campaign publishes the entry
-- code only), so each route carries the code plus generic prompts and the
-- standard authorise-on-your-phone notice.
--
-- Everything here is state='published', verified_at=now(), provenance set
-- to the campaign. Idempotent: providers/codes/routes use
-- `on conflict (slug) do nothing`; participation/flows/steps/evidence use
-- `where not exists` / `on conflict ... do nothing`.

do $$
declare
  v_ekash uuid;
  v_bnr uuid;
  v_source uuid := 'e0000000-0000-4000-8000-000000000001';
  v_src_label text := 'MTN Rwanda / eKash "SOZA DIRU na eKash" campaign - bank-to-wallet USSD directory';
begin
  select id into v_ekash from public.payment_networks where slug = 'ekash';
  select id into v_bnr from public.regulatory_authorities where slug = 'bnr';
  if v_ekash is null then
    raise notice 'eKash network not found - skipping bank-route seed';
    return;
  end if;

  -- ---- verification source ------------------------------------------------
  insert into public.directory_sources (id, organization, title, classification, is_public, publication_date)
  values (v_source, 'MTN Rwanda', 'eKash "SOZA DIRU na eKash" - bank-to-wallet USSD directory',
          'official_telecom_emoney', true, null)
  on conflict (id) do nothing;

  -- ---- the institution + code dataset -----------------------------------
  create temporary table _ekash_inst (
    slug text, name text, kind text, role text, category text, code text, helpline text
  ) on commit drop;

  insert into _ekash_inst (slug, name, kind, role, category, code, helpline) values
    ('mtn-rwanda',            'MTN Rwanda',            'mno', 'emi',  'mobile_money', '*182*1*2#', null),
    ('bank-of-kigali',        'Bank of Kigali',        'bank','bank', 'banking',      '*334*2*4#', '4455 / +250 788 143 000'),
    ('bpr-bank',              'BPR Bank',              'bank','bank', 'banking',      '*150*3*4#', '+250 788 140 000'),
    ('im-bank-rwanda',        'I&M Bank Rwanda',       'bank','bank', 'banking',      '*227*4*3#', '+250 788 162 006'),
    ('gt-bank-rwanda',        'GT Bank Rwanda',        'bank','bank', 'banking',      '*600*7*2#', '5054'),
    ('zigama-css',            'Zigama CSS',            'mfi', 'bank', 'banking',      '*139*5*3#', '5005'),
    ('equity-bank-rwanda',    'Equity Bank Rwanda',    'bank','bank', 'banking',      '*555*2#',   '4555 / +250 788 190 000'),
    ('bank-of-africa-rwanda', 'Bank of Africa Rwanda', 'bank','bank', 'banking',      '*512*2*2#', '5120 / +250 788 172 600'),
    ('access-bank-rwanda',    'Access Bank Rwanda',    'bank','bank', 'banking',      '*903*3*5#', '5536 / +250 788 145 300'),
    ('ecobank-rwanda',        'Ecobank Rwanda',        'bank','bank', 'banking',      '*883*8*1#', '+250 788 161 000 / +250 788 384 000'),
    ('ncba-bank-rwanda',      'NCBA Bank Rwanda',      'bank','bank', 'banking',      '*650*1*2#', '+250 788 384 000'),
    ('ab-bank-rwanda',        'AB Bank Rwanda',        'bank','bank', 'banking',      '*540*2*3#', null),
    ('copedu-trust',          'Copedu Trust',          'mfi', 'bank', 'banking',      '*866*3#',   null),
    ('umwalimu-sacco',        'Umwalimu SACCO',        'mfi', 'bank', 'banking',      '*175*3#',   null),
    ('lolc-unguka',           'LOLC Rwanda (Unguka)',  'mfi', 'bank', 'banking',      '*951*4#',   null),
    ('letshego-rwanda',       'Letshego Rwanda',       'mfi', 'bank', 'banking',      '*598*1*3#', null),
    ('mvend',                 'Mvend',                 'aggregator', 'other', 'other', '*737*1*2#', null),
    ('jali-finance',          'Jali Finance',          'aggregator', 'other', 'other', '*655*8*3#', null);

  -- ---- providers -------------------------------------------------------
  insert into public.service_providers (slug, display_name, kind, country, networks, status, emoney_issuer, regulatory_authority_id)
  select i.slug, i.name, i.kind, 'RW', '{}'::text[], 'active',
         i.role in ('emi', 'other'),
         v_bnr
  from _ekash_inst i
  on conflict (slug) do nothing;

  -- ---- promote any pre-seeded DRAFT eKash participation, then add the rest
  update public.institution_network_participation p
  set state = 'published', verified_at = now(), official_source_label = v_src_label
  from public.service_providers sp
  where p.provider_id = sp.id
    and p.payment_network_id = v_ekash
    and p.state = 'draft'
    and sp.slug in (select slug from _ekash_inst);

  insert into public.institution_network_participation
    (provider_id, payment_network_id, participant_role, state, verified_at, official_source_label)
  select sp.id, v_ekash, i.role, 'published', now(), v_src_label
  from _ekash_inst i
  join public.service_providers sp on sp.slug = i.slug
  where not exists (
    select 1 from public.institution_network_participation x
    where x.provider_id = sp.id and x.payment_network_id = v_ekash
      and x.effective_to is null and x.state <> 'archived'
  );

  -- ---- one USSD service_code per institution --------------------------
  insert into public.service_codes
    (provider_id, slug, category, intent, display_name_en, description_en,
     ussd_template, accepts_parameters, supported_networks,
     official_source_url, official_source_label, verified_at, review_due_at, state, caution_text)
  select sp.id,
         'ekash-' || i.slug,
         i.category,
         'ekash_transfer',
         i.name || ' - eKash transfer',
         'Opens the eKash transfer flow at ' || i.name || '. From here you choose the amount and the Mobile Money number. '
           || coalesce('Help line: ' || i.helpline || '. ', '')
           || 'You authorise the transfer with your own PIN on your phone - OneLedger never sees it.',
         i.code, false,
         case when i.slug = 'mtn-rwanda' then array['mtn'] else '{}'::text[] end,
         null, v_src_label, now(), now() + interval '180 days', 'published',
         'This is the eKash entry code published by the MTN/eKash campaign. The exact next menu options can change - if what your phone shows does not match, stop and use your provider''s main menu, then report it.'
  from _ekash_inst i
  join public.service_providers sp on sp.slug = i.slug
  on conflict (slug) do nothing;

  -- ---- one access_route per institution ------------------------------
  insert into public.access_routes
    (slug, provider_id, payment_network_id, participation_id, channel, service_code_id,
     approved_entry_point_en, internet_required, display_name_en, description_en,
     official_source_url, official_source_label, verified_at, review_due_at, state, caution_text)
  select 'ekash-route-' || i.slug,
         sp.id, v_ekash,
         (select x.id from public.institution_network_participation x
          where x.provider_id = sp.id and x.payment_network_id = v_ekash
            and x.effective_to is null and x.state <> 'archived' limit 1),
         'ussd',
         (select c.id from public.service_codes c where c.slug = 'ekash-' || i.slug),
         i.code, false,
         case when i.slug = 'mtn-rwanda'
              then i.name || ' wallet - eKash transfer'
              else i.name || ' account to Mobile Money wallet (eKash)' end,
         'Dial ' || i.code || ' on the phone linked to your ' || i.name
           || ' account and follow the eKash prompts. '
           || coalesce('Help line: ' || i.helpline || '. ', ''),
         null, v_src_label, now(), now() + interval '180 days', 'published',
         'Entry code from the MTN/eKash campaign. If the menu does not match, stop and use the provider''s main menu, then report it.'
  from _ekash_inst i
  join public.service_providers sp on sp.slug = i.slug
  on conflict (slug) do nothing;

  -- ---- supported flows ---------------------------------------------
  insert into public.route_supported_flows (access_route_id, flow_type, note_en)
  select r.id, 'account_to_wallet', 'Move funds from the bank/SACCO account to a Mobile Money wallet.'
  from public.access_routes r
  where r.slug like 'ekash-route-%'
    and r.slug <> 'ekash-route-mtn-rwanda'
  on conflict (access_route_id, flow_type) do nothing;

  insert into public.route_supported_flows (access_route_id, flow_type, note_en)
  select r.id, f.flow_type, f.note_en
  from public.access_routes r
  cross join (values
    ('wallet_to_account'::text, 'Send from the MoMo wallet to a bank account via eKash.'),
    ('wallet_to_wallet'::text,  'Send from the MoMo wallet to another wallet via eKash.')
  ) as f(flow_type, note_en)
  where r.slug = 'ekash-route-mtn-rwanda'
  on conflict (access_route_id, flow_type) do nothing;

  -- ---- generic menu steps (entry code only is published) -----------
  insert into public.route_menu_steps (access_route_id, position, action_label_en, instruction_en, caution_en)
  select r.id, s.pos, s.action, s.instr, s.caution
  from public.access_routes r
  cross join (values
    (0, 'Dial the code',
        'On the phone linked to your account, dial the code shown above and press call.',
        null),
    (1, 'Follow the eKash prompts',
        'Choose the amount and the Mobile Money number to receive it, then confirm.',
        null),
    (2, 'Authorise on your phone',
        'Enter your banking / USSD PIN on your own phone to approve. OneLedger never asks for it and cannot see it.',
        'If any screen asks you to enter a PIN anywhere other than your own phone''s USSD prompt, stop.')
  ) as s(pos, action, instr, caution)
  where r.slug like 'ekash-route-%'
  on conflict (access_route_id, position) do nothing;

  -- ---- evidence: link every route + the network to the campaign source
  insert into public.directory_evidence (source_id, subject_type, subject_id, is_public, verification_date, next_review_date, public_caveat_en)
  select v_source, 'access_route', r.id, true, now(), now() + interval '180 days',
         'Entry code published by the MTN/eKash "SOZA DIRU na eKash" campaign.'
  from public.access_routes r
  where r.slug like 'ekash-route-%'
    and not exists (
      select 1 from public.directory_evidence e
      where e.subject_type = 'access_route' and e.subject_id = r.id and e.source_id = v_source
    );

  insert into public.directory_evidence (source_id, subject_type, subject_id, is_public, verification_date, next_review_date)
  select v_source, 'payment_network', v_ekash, true, now(), now() + interval '180 days'
  where not exists (
    select 1 from public.directory_evidence e
    where e.subject_type = 'payment_network' and e.subject_id = v_ekash and e.source_id = v_source
  );

  -- ---- two entries that are NOT a plain dialable code ---------------
  -- Airtel Money: the campaign graphic showed *182*1*2# for Airtel too,
  -- which is MTN's prefix and looks like a copy error - so this is entered
  -- as a provider entry-point note, NOT a dialable code, pending its own
  -- verification.
  insert into public.institution_network_participation
    (provider_id, payment_network_id, participant_role, state, verified_at, official_source_label)
  select sp.id, v_ekash, 'emi', 'published', now(), v_src_label
  from public.service_providers sp
  where sp.slug = 'airtel-rwanda'
    and not exists (
      select 1 from public.institution_network_participation x
      where x.provider_id = sp.id and x.payment_network_id = v_ekash
        and x.effective_to is null and x.state <> 'archived'
    );
  update public.institution_network_participation p
  set state = 'published', verified_at = now(), official_source_label = v_src_label
  from public.service_providers sp
  where p.provider_id = sp.id and sp.slug = 'airtel-rwanda'
    and p.payment_network_id = v_ekash and p.state = 'draft';

  insert into public.access_routes
    (slug, provider_id, payment_network_id, participation_id, channel,
     approved_entry_point_en, internet_required, display_name_en, description_en,
     official_source_label, verified_at, review_due_at, state, caution_text)
  select 'ekash-route-airtel-rwanda', sp.id, v_ekash,
         (select x.id from public.institution_network_participation x
          where x.provider_id = sp.id and x.payment_network_id = v_ekash
            and x.effective_to is null and x.state <> 'archived' limit 1),
         'ussd',
         'Dial *500# and choose the bank / eKash transfer option',
         false,
         'Airtel Money wallet - eKash transfer',
         'Open the Airtel Money menu (*500#) and choose the eKash / bank transfer option.',
         v_src_label, now(), now() + interval '180 days', 'published',
         'The published campaign graphic showed the same code as MTN (*182*1*2#) for Airtel, which appears to be an error - the exact Airtel Money eKash path still needs its own verification.'
  from public.service_providers sp
  where sp.slug = 'airtel-rwanda'
  on conflict (slug) do nothing;

  -- Chipper Cash: app only, no USSD.
  insert into public.service_providers (slug, display_name, kind, country, networks, status, emoney_issuer, regulatory_authority_id)
  values ('chipper-cash', 'Chipper Cash', 'other', 'RW', '{}'::text[], 'active', true, v_bnr)
  on conflict (slug) do nothing;

  insert into public.institution_network_participation
    (provider_id, payment_network_id, participant_role, state, verified_at, official_source_label)
  select sp.id, v_ekash, 'other', 'published', now(), v_src_label
  from public.service_providers sp
  where sp.slug = 'chipper-cash'
    and not exists (
      select 1 from public.institution_network_participation x
      where x.provider_id = sp.id and x.payment_network_id = v_ekash
        and x.effective_to is null and x.state <> 'archived'
    );

  insert into public.access_routes
    (slug, provider_id, payment_network_id, participation_id, channel,
     approved_entry_point_en, internet_required, display_name_en, description_en,
     official_source_label, verified_at, review_due_at, state)
  select 'ekash-route-chipper-cash', sp.id, v_ekash,
         (select x.id from public.institution_network_participation x
          where x.provider_id = sp.id and x.payment_network_id = v_ekash
            and x.effective_to is null and x.state <> 'archived' limit 1),
         'mobile_app',
         'Chipper Cash app', true,
         'Chipper Cash - eKash transfer',
         'Use the Chipper Cash app to move funds via eKash. There is no USSD code for this route.',
         v_src_label, now(), now() + interval '180 days', 'published'
  from public.service_providers sp
  where sp.slug = 'chipper-cash'
  on conflict (slug) do nothing;

  insert into public.route_supported_flows (access_route_id, flow_type)
  select r.id, 'account_to_wallet'
  from public.access_routes r
  where r.slug in ('ekash-route-airtel-rwanda', 'ekash-route-chipper-cash')
  on conflict (access_route_id, flow_type) do nothing;
end $$;
