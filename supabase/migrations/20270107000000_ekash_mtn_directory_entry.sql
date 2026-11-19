-- The MTN eKash entry code, taking the receiver's ID: *182*1*2*{receiver}#.
--
-- eKash is the interoperable payment network that links banks and Mobile Money
-- wallets, so from this code a person can send money to a bank account or to a
-- wallet. The directory already has the bare menu code (*182*1*2#, slug
-- ekash-mtn-rwanda, one of the per-institution "eKash transfer" rows); this adds
-- the version that carries the receiver's ID, so the code is built for the person
-- being paid. The menu-only row is left exactly as it is: the network and route
-- pages point at it.
--
-- Honest about provenance: no verified_at (the exact continuation after the ID is
-- chosen in the provider's own menu, and it can change), a short review window,
-- and the caution that says what to do if the phone shows something different.
-- Idempotent (on conflict / where not exists); a database without the MTN
-- provider row makes this a no-op.

insert into public.service_codes
  (provider_id, slug, category, intent, display_name_en, description_en,
   ussd_template, accepts_parameters, supported_networks,
   official_source_url, official_source_label, verified_at, review_due_at, state, caution_text)
select sp.id,
       'ekash-mtn-send',
       'mobile_money',
       'ekash_transfer',
       'eKash - send money to a bank account or Mobile Money wallet',
       'Sends money through eKash, the interoperable payment network that links banks and Mobile Money wallets, to the receiver whose ID you enter: a bank account or a Mobile Money wallet. The code is built with their ID; you choose the rest, and the amount, in your provider''s own menu and approve it with your own PIN on your phone - OneLedger never sees it.',
       '*182*1*2*{receiver}#', true, array['mtn'],
       null, 'Community-compiled - pending official verification',
       null, now() + interval '14 days', 'published',
       'The exact menu path can change. If what your phone shows does not match, stop and use your provider''s main menu (*182#) instead, then report the code.'
from public.service_providers sp
where sp.slug = 'mtn-rwanda'
on conflict (slug) do nothing;

insert into public.service_code_parameters
  (service_code_id, key, label_en, kind, required, position, format_hint_en)
select c.id, 'receiver', 'Receiver''s ID', 'account_reference', true, 0,
       'The receiver''s phone number or account number (letters, digits and dashes).'
from public.service_codes c
where c.slug = 'ekash-mtn-send'
  and not exists (
    select 1 from public.service_code_parameters p
    where p.service_code_id = c.id and p.key = 'receiver'
  );
