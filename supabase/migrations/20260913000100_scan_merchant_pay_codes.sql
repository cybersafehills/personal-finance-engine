-- Scan to pay - the OneLedger merchant-payment hand-off needs a
-- pay-a-merchant USSD code in the directory to fill. Phase M seeded only
-- send_money codes. This adds an MTN MoMo "pay with code" entry so a
-- scanned OneLedger merchant payment (RWF) can be mapped onto it
-- (web/lib/pay/scan/resolve.server.ts resolveMerchantPayCode).
--
-- VERIFICATION STATUS (checked 2026-08, public sources only):
--   CORROBORATED  - the pay-a-merchant-by-code entry point is *182*8*1#
--                   (multiple Rwanda MoMo guides + a post on MoMo
--                   Rwanda's official Facebook page), followed by
--                   prompts for the merchant code then the amount.
--                   Merchant codes are 5-6 digits.
--   NOT CONFIRMED - the CONCATENATED one-line form
--                   `*182*8*1*{merchant}*{amount}#`. Every source
--                   describes step-by-step prompts, not an inline dial;
--                   MTN's own site (mtn.co.rw/momo) does not surface the
--                   *182*8 branch at all. This is the same risk class as
--                   the already-shipped Phase M `mtn-momo-send` seed
--                   (`*182*1*1*{phone}*{amount}#`, also community-compiled).
--
-- So this row ships `state = 'published'`, `verified_at = null` - the
-- scanner review shows a prominent "Not officially verified" warning and
-- the full dial string before the user opens it, and the caution_text /
-- risk_text below are deliberately explicit about the concatenated tail.
--
-- BEFORE an admin marks it verified: confirm on a real MTN handset that
-- dialling `*182*8*1*<code>*<amount>#` goes straight through (not just
-- `*182*8*1#`). If MTN only accepts the step-by-step prompts, replace
-- this with the LITERAL `*182*8*1#` entry code + steps and the scanner
-- will present the code + amount for the user to type at the prompts.
--
-- Airtel Money is intentionally NOT seeded - its pay-code path is
-- unconfirmed (see 20260909000400_phase_p_ekash_bank_routes.sql). A
-- scanned Airtel OneLedger payload resolves to "hand-off unavailable".
--
-- Idempotent: on conflict (slug) do nothing; param/step inserts guard
-- on not-exists.

insert into public.service_codes (
  id, provider_id, slug, category, intent,
  display_name_en, description_en,
  ussd_template, accepts_parameters, supported_networks,
  official_source_url, official_source_label,
  verified_at, review_due_at, state, risk_text, caution_text
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
    'Entry point *182*8*1# is community-corroborated (incl. MoMo Rwanda social). The one-line *code*amount form is NOT MTN-documented and awaits a real-device check.',
    null, now() + interval '30 days', 'published',
    'The concatenated form *182*8*1*{merchant}*{amount}# has not been confirmed with MTN. If your phone shows step-by-step prompts instead of completing the payment, the amount may not have registered - stop and re-check.',
    'This pay-merchant path is community-compiled and NOT verified against MTN. If the dialled sequence does not match the menu your phone shows, stop, use the MTN MoMo menu (*182#) instead, and report the code.'
  )
on conflict (slug) do nothing;

insert into public.service_code_parameters (service_code_id, key, label_en, kind, required, position, format_regex, format_hint_en)
select v.service_code_id, v.key, v.label_en, v.kind, v.required, v.position, v.format_regex, v.format_hint_en
from (values
  ('c0000000-0000-4000-8000-0000000000d1'::uuid, 'merchant', 'Merchant / till code', 'merchant_code', true, 0, '^[0-9]{3,12}$', 'The numeric merchant or till code (usually 5-6 digits)'),
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
  ('c0000000-0000-4000-8000-0000000000d1'::uuid, 0, 'On the phone with your MTN SIM, open the dialer and enter *182*8*1#, then press call.'),
  ('c0000000-0000-4000-8000-0000000000d1'::uuid, 1, 'Enter the merchant code, then the amount, and check both against the merchant''s own display.'),
  ('c0000000-0000-4000-8000-0000000000d1'::uuid, 2, 'Enter your MoMo PIN on your phone. OneLedger never asks for it and cannot see it.')
) as v(service_code_id, position, instruction_en)
where exists (select 1 from public.service_codes c where c.id = v.service_code_id)
  and not exists (
    select 1 from public.service_code_steps s
    where s.service_code_id = v.service_code_id and s.position = v.position
  );
