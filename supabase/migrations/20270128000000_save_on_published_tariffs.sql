-- Published mobile-money fee tariffs (the source of truth for "Save On").
--
-- Loaded from the providers' own public fee pages, retrieved 2026-11-24:
--   MTN Rwanda     https://www.mtn.co.rw/momo-tarrif/
--   Airtel Money   https://airtelmoney.rw/transaction_fees
-- Every band below was generated from those pages (not typed by hand) and checked
-- for ordering and overlap. See docs/oneledger-3/tariff-sources/ for the captured text.
--
-- Two different kinds of MTN transfer, kept as two separate tariffs:
--   send_money / same_network : MTN to MTN person-to-person ("P2P On-net"). Tiered, so
--                               sending an amount in parts can cost less. Save On uses it.
--   bank_transfer / any       : MTN to another wallet or a bank via eKash. A flat RWF 20
--                               per transfer in every band up to RWF 10,000,000, so
--                               parts only ever cost more; Save On only splits an amount
--                               ABOVE the network capacity, never to save fees.
--
-- NOT loaded: Airtel to Airtel person-to-person. The page's reachable, labelled options
-- are Cash-Out, IMT and Wallet to Bank only; an unlabelled hidden table is not a source.
-- Until Airtel publishes one, Airtel never gets a fee-saving offer. Deposit (0), IMT,
-- savings, loans, school-fee, tax, water and corporate tables are not needed for Save On.
--
-- Data only: no schema change.

-- mtn-rwanda / send_money / same_network: P2P On-net, sending money, fee paid by the sender; receiving is free
with p as (select id from public.service_providers where slug = 'mtn-rwanda'),
t as (
  insert into public.provider_tariffs
    (service_provider_id, transaction_type, recipient_scope, currency, effective_from, source_label, source_url, note_en)
  select p.id, 'send_money', 'same_network', 'RWF', '2026-11-24',
         'MTN Rwanda, MoMo Tariffs page (P2P On-net, sending money, fee paid by the sender; receiving is free), retrieved 2026-11-24', 'https://www.mtn.co.rw/momo-tarrif/',
         'Whole RWF, fixed fee per band. The page states no effective date, so effective_from is the retrieval date.'
  from p
  returning id
)
insert into public.provider_tariff_tiers
  (tariff_id, min_amount_minor, max_amount_minor, fee_type, fixed_fee_minor)
select t.id, v.min_amt, v.max_amt, v.fee_type, v.fixed_fee
from t, (values
  (1::bigint, 1000::bigint, 'fixed', 20::bigint),
  (1001::bigint, 10000::bigint, 'fixed', 100::bigint),
  (10001::bigint, 150000::bigint, 'fixed', 250::bigint),
  (150001::bigint, 2000000::bigint, 'fixed', 1500::bigint),
  (2000001::bigint, 5000000::bigint, 'fixed', 3000::bigint),
  (5000001::bigint, 10000000::bigint, 'fixed', 5000::bigint)
) as v(min_amt, max_amt, fee_type, fixed_fee);

-- mtn-rwanda / bank_transfer / any: To another wallet or bank via eKash, fee paid by the sender
with p as (select id from public.service_providers where slug = 'mtn-rwanda'),
t as (
  insert into public.provider_tariffs
    (service_provider_id, transaction_type, recipient_scope, currency, effective_from, source_label, source_url, note_en)
  select p.id, 'bank_transfer', 'any', 'RWF', '2026-11-24',
         'MTN Rwanda, MoMo Tariffs page (To another wallet or bank via eKash, fee paid by the sender), retrieved 2026-11-24', 'https://www.mtn.co.rw/momo-tarrif/',
         'Whole RWF, fixed fee per band. The page states no effective date, so effective_from is the retrieval date. A flat RWF 20 in every band up to RWF 10,000,000.'
  from p
  returning id
)
insert into public.provider_tariff_tiers
  (tariff_id, min_amount_minor, max_amount_minor, fee_type, fixed_fee_minor)
select t.id, v.min_amt, v.max_amt, v.fee_type, v.fixed_fee
from t, (values
  (1::bigint, 1000::bigint, 'fixed', 20::bigint),
  (1001::bigint, 10000::bigint, 'fixed', 20::bigint),
  (10001::bigint, 150000::bigint, 'fixed', 20::bigint),
  (150001::bigint, 2000000::bigint, 'fixed', 20::bigint),
  (2000001::bigint, 5000000::bigint, 'fixed', 20::bigint),
  (5000001::bigint, 10000000::bigint, 'fixed', 20::bigint)
) as v(min_amt, max_amt, fee_type, fixed_fee);

-- mtn-rwanda / cash_withdrawal / any: Withdraw (fees)
with p as (select id from public.service_providers where slug = 'mtn-rwanda'),
t as (
  insert into public.provider_tariffs
    (service_provider_id, transaction_type, recipient_scope, currency, effective_from, source_label, source_url, note_en)
  select p.id, 'cash_withdrawal', 'any', 'RWF', '2026-11-24',
         'MTN Rwanda, MoMo Tariffs page (Withdraw (fees)), retrieved 2026-11-24', 'https://www.mtn.co.rw/momo-tarrif/',
         'Whole RWF, fixed fee per band. The page states no effective date, so effective_from is the retrieval date. The page does not state who pays the withdrawal fee.'
  from p
  returning id
)
insert into public.provider_tariff_tiers
  (tariff_id, min_amount_minor, max_amount_minor, fee_type, fixed_fee_minor)
select t.id, v.min_amt, v.max_amt, v.fee_type, v.fixed_fee
from t, (values
  (1::bigint, 100::bigint, 'fixed', 50::bigint),
  (101::bigint, 300::bigint, 'fixed', 50::bigint),
  (301::bigint, 1000::bigint, 'fixed', 100::bigint),
  (1001::bigint, 3000::bigint, 'fixed', 200::bigint),
  (3001::bigint, 5000::bigint, 'fixed', 250::bigint),
  (5001::bigint, 10000::bigint, 'fixed', 275::bigint),
  (10001::bigint, 20000::bigint, 'fixed', 350::bigint),
  (20001::bigint, 40000::bigint, 'fixed', 600::bigint),
  (40001::bigint, 75000::bigint, 'fixed', 1100::bigint),
  (75001::bigint, 150000::bigint, 'fixed', 2000::bigint),
  (150001::bigint, 300000::bigint, 'fixed', 3000::bigint),
  (300001::bigint, 500000::bigint, 'fixed', 6000::bigint),
  (500001::bigint, 1000000::bigint, 'fixed', 9000::bigint),
  (1000001::bigint, 2000000::bigint, 'fixed', 17000::bigint),
  (2000001::bigint, 5000000::bigint, 'fixed', 25000::bigint),
  (5000001::bigint, 8000000::bigint, 'fixed', 30000::bigint),
  (8000001::bigint, 10000000::bigint, 'fixed', 35000::bigint)
) as v(min_amt, max_amt, fee_type, fixed_fee);

-- airtel-rwanda / cash_withdrawal / any: Cash-Out
with p as (select id from public.service_providers where slug = 'airtel-rwanda'),
t as (
  insert into public.provider_tariffs
    (service_provider_id, transaction_type, recipient_scope, currency, effective_from, source_label, source_url, note_en)
  select p.id, 'cash_withdrawal', 'any', 'RWF', '2026-11-24',
         'Airtel Money Rwanda, Transaction Fees page (Cash-Out), retrieved 2026-11-24', 'https://airtelmoney.rw/transaction_fees',
         'Whole RWF, fixed fee per band, as listed under the named option on the page. The page states no effective date, so effective_from is the retrieval date.'
  from p
  returning id
)
insert into public.provider_tariff_tiers
  (tariff_id, min_amount_minor, max_amount_minor, fee_type, fixed_fee_minor)
select t.id, v.min_amt, v.max_amt, v.fee_type, v.fixed_fee
from t, (values
  (1::bigint, 100::bigint, 'fixed', 30::bigint),
  (101::bigint, 300::bigint, 'fixed', 40::bigint),
  (301::bigint, 1000::bigint, 'fixed', 80::bigint),
  (1001::bigint, 3000::bigint, 'fixed', 160::bigint),
  (3001::bigint, 5000::bigint, 'fixed', 215::bigint),
  (5001::bigint, 10000::bigint, 'fixed', 240::bigint),
  (10001::bigint, 20000::bigint, 'fixed', 310::bigint),
  (20001::bigint, 40000::bigint, 'fixed', 525::bigint),
  (40001::bigint, 75000::bigint, 'fixed', 950::bigint),
  (75001::bigint, 150000::bigint, 'fixed', 1750::bigint),
  (150001::bigint, 300000::bigint, 'fixed', 2500::bigint),
  (300001::bigint, 500000::bigint, 'fixed', 4300::bigint),
  (500001::bigint, 1000000::bigint, 'fixed', 7000::bigint),
  (1000001::bigint, 2000000::bigint, 'fixed', 12000::bigint)
) as v(min_amt, max_amt, fee_type, fixed_fee);

-- airtel-rwanda / bank_transfer / any: Wallet to Bank
with p as (select id from public.service_providers where slug = 'airtel-rwanda'),
t as (
  insert into public.provider_tariffs
    (service_provider_id, transaction_type, recipient_scope, currency, effective_from, source_label, source_url, note_en)
  select p.id, 'bank_transfer', 'any', 'RWF', '2026-11-24',
         'Airtel Money Rwanda, Transaction Fees page (Wallet to Bank), retrieved 2026-11-24', 'https://airtelmoney.rw/transaction_fees',
         'Whole RWF, fixed fee per band, as listed under the named option on the page. The page states no effective date, so effective_from is the retrieval date. The page lists no band below RWF 101.'
  from p
  returning id
)
insert into public.provider_tariff_tiers
  (tariff_id, min_amount_minor, max_amount_minor, fee_type, fixed_fee_minor)
select t.id, v.min_amt, v.max_amt, v.fee_type, v.fixed_fee
from t, (values
  (101::bigint, 300::bigint, 'fixed', 30::bigint),
  (301::bigint, 1000::bigint, 'fixed', 50::bigint),
  (1001::bigint, 3000::bigint, 'fixed', 90::bigint),
  (3001::bigint, 5000::bigint, 'fixed', 120::bigint),
  (5001::bigint, 10000::bigint, 'fixed', 150::bigint),
  (10001::bigint, 20000::bigint, 'fixed', 190::bigint),
  (20001::bigint, 40000::bigint, 'fixed', 320::bigint),
  (40001::bigint, 75000::bigint, 'fixed', 460::bigint),
  (75001::bigint, 150000::bigint, 'fixed', 780::bigint),
  (150001::bigint, 300000::bigint, 'fixed', 1500::bigint),
  (300001::bigint, 500000::bigint, 'fixed', 2350::bigint),
  (500001::bigint, 1000000::bigint, 'fixed', 3700::bigint),
  (1000001::bigint, 2000000::bigint, 'fixed', 4500::bigint)
) as v(min_amt, max_amt, fee_type, fixed_fee);

-- Every band above was checked against the cited page before this was verified.
update public.provider_tariffs set verified_at = now()
where verified_at is null and source_label in (
  'MTN Rwanda, MoMo Tariffs page (P2P On-net, sending money, fee paid by the sender; receiving is free), retrieved 2026-11-24',
  'MTN Rwanda, MoMo Tariffs page (To another wallet or bank via eKash, fee paid by the sender), retrieved 2026-11-24',
  'MTN Rwanda, MoMo Tariffs page (Withdraw (fees)), retrieved 2026-11-24',
  'Airtel Money Rwanda, Transaction Fees page (Cash-Out), retrieved 2026-11-24',
  'Airtel Money Rwanda, Transaction Fees page (Wallet to Bank), retrieved 2026-11-24'
);
