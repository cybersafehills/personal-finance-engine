-- Scan to pay - OneLedger merchant-payment hand-off needs a
-- pay-a-merchant USSD code in the verified directory to fill. Phase M
-- seeded only send_money codes. This adds an MTN MoMo "pay with code"
-- entry so a scanned OneLedger merchant payment (RWF) can be mapped onto
-- it (web/lib/pay/scan/resolve.server.ts resolveMerchantPayCode).
--
-- PROVENANCE: published-but-UNVERIFIED (verified_at is null), exactly
-- like the Phase M `mtn-momo-send` seed. The scanner review shows a
-- prominent "Not officially verified" warning for such codes and the
-- user sees the full dial string before opening it; the caution_text
-- below is deliberately strong. An admin promotes it to verified through
-- the existing directory admin flow once the path is confirmed against
-- MTN's own documentation.
--
-- Airtel Money is intentionally NOT seeded here - its pay-code path is
-- unconfirmed (see the note in 20260909000400_phase_p_ekash_bank_routes.sql).
-- Until it is added, a scanned Airtel OneLedger payload resolves to
-- "hand-off unavailable", which is the honest outcome.
--
-- Idempotent: on conflict (slug) do nothing, and the param/step inserts
-- guard on not-exists.

insert into public.service_codes (
  id, provider_id, slug, category, intent,
  display_name_en, description_en,
  ussd_template, accepts_parameters, supported_networks,
  official_source_url, official_source_label,
  verified_at, review_due_at, state, caution_text
)
values
  (
    'c0000000-0000-4000-8000-0000000000d1',
    'a0000000-0000-4000-8000-0000000000a1', 'mtn-momo-pay-merchant',
    'merchant_payment', 'merchant_payment',
    'MTN MoMo - pay a merchant (code)',
    'Prepares the MTN Mobile Money "pay a registered merchant / till" instruction from a merchant code and an amount. You confirm the amount and enter your PIN on your own phone - OneLedger never sees it.',
    '*182*8*1*{merchant}*{amount}#', true, array['mtn'],
    'https://www.mtn.co.rw/momo/',
    'Community-compiled - NOT officially verified. Confirm the dialled sequence matches what your phone shows before entering any amount.',
    null, now() + interval '14 days', 'published',
    'This pay-merchant menu path is community-compiled and has not been verified against MTN. If the dialled sequence does not match the menu your phone shows, stop, use the MTN MoMo menu (*182#) instead, and report the code.'
  )
on conflict (slug) do nothing;

insert into public.service_code_parameters (service_code_id, key, label_en, kind, required, position, format_regex, format_hint_en)
select v.service_code_id, v.key, v.label_en, v.kind, v.required, v.position, v.format_regex, v.format_hint_en
from (values
  ('c0000000-0000-4000-8000-0000000000d1'::uuid, 'merchant', 'Merchant / till code', 'merchant_code', true, 0, '^[0-9]{3,12}$', 'The numeric merchant or till code, 3-12 digits'),
  ('c0000000-0000-4000-8000-0000000000d1'::uuid, 'amount',   'Amount (RWF)',          'amount',        true, 1, '^[1-9][0-9]{1,6}$', 'Whole RWF amount, no decimals')
) as v(service_code_id, key, label_en, kind, required, position, format_regex, format_hint_en)
where exists (select 1 from public.service_codes c where c.id = v.service_code_id)
  and not exists (
    select 1 from public.service_code_parameters p
    where p.service_code_id = v.service_code_id and p.key = v.key
  );

insert into public.service_code_steps (service_code_id, position, instruction_en)
select v.service_code_id, v.position, v.instruction_en
from (values
  ('c0000000-0000-4000-8000-0000000000d1'::uuid, 0, 'On the phone with your MTN SIM, open the dialer and enter *182#, then press call.'),
  ('c0000000-0000-4000-8000-0000000000d1'::uuid, 1, 'Choose "Pay", then "Pay with code" (menu wording may differ).'),
  ('c0000000-0000-4000-8000-0000000000d1'::uuid, 2, 'Enter the merchant code, then the amount, and check both against the merchant''s own display.'),
  ('c0000000-0000-4000-8000-0000000000d1'::uuid, 3, 'Enter your MoMo PIN on your phone. OneLedger never asks for it and cannot see it.')
) as v(service_code_id, position, instruction_en)
where exists (select 1 from public.service_codes c where c.id = v.service_code_id)
  and not exists (
    select 1 from public.service_code_steps s
    where s.service_code_id = v.service_code_id and s.position = v.position
  );
