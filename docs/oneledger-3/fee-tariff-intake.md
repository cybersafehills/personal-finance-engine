# Fee tariff intake: what to supply, and how it gets loaded

The calculator can only say what a provider charges if a **verified, source-cited tariff** has been loaded. OneLedger will not publish a figure it has not checked against its source; the database refuses to show an unverified tariff to anyone. This page is the checklist for the person who owns the data (the product owner) and the procedure for the engineer who loads it.

## What to supply, per tariff
One tariff = one provider × one payment type × one recipient scope. MTN's "send money to an MTN number" and "send money to another network" are two tariffs.

| Field | Notes |
|---|---|
| **Provider** | `mtn-rwanda`, `airtel-rwanda`, or another `service_providers.slug` (a bank is fine) |
| **Payment type** | `send_money`, `merchant_payment`, `cash_withdrawal`, `bill_payment`, `airtime`, `bank_transfer` |
| **Recipient scope** | `any`, `same_network`, `other_network`, `unregistered` |
| **Currency** | `RWF` (others only if OneLedger knows their decimal places: EUR, USD) |
| **In effect from / to** | the date the provider says it applies from; leave "to" empty if it is current |
| **Source** | what it came from: the provider's published tariff document, its website page, or a regulator notice. A **label** is mandatory ("MTN Rwanda MoMo tariff, retrieved from <page>, <date>"); an **https link** if one exists. A screenshot of the document should be kept with the PR. |
| **Bands** | every amount band, in whole RWF: lowest amount, highest amount (blank for "and above"), and how the fee is expressed |
| **Per band: fee** | a fixed amount, **or** a percentage (with any stated minimum and maximum fee), **or** "no fee" |

Rules the data must follow (the database enforces them): bands are inclusive and must not overlap; a gap between bands is allowed and is treated as "outside the published bands" (no number is ever invented for it); a tariff needs at least one band before it can be verified.

**Do not supply** estimates, "typical" fees, figures from memory or from a forum, or a tariff you cannot cite. If a provider publishes only a range ("up to X"), say so; it is stored as a published maximum on the network/route fee table, not as a tariff band.

## How an engineer loads it (a reviewed migration)
Tariffs enter production as a **migration** so each figure and its source are code-reviewed and permanent in history. Use a fresh, unique version (never reuse one: see `migration-version-collisions`). Template (every value below is a FICTIONAL placeholder, not a real tariff):

```sql
-- <Provider> <payment type> tariff, <recipient scope>. Source: <label>, <link>, retrieved <date>.
with p as (select id from public.service_providers where slug = 'mtn-rwanda'),
t as (
  insert into public.provider_tariffs
    (service_provider_id, transaction_type, recipient_scope, currency, effective_from, source_label, source_url, note_en)
  select p.id, 'send_money', 'same_network', 'RWF', '2026-01-01',
         'EXAMPLE ONLY - replace with the real source label', 'https://example.invalid/replace-me',
         'EXAMPLE ONLY'
  from p
  returning id
)
insert into public.provider_tariff_tiers
  (tariff_id, min_amount_minor, max_amount_minor, fee_type, fixed_fee_minor, percentage_bps, min_fee_minor, max_fee_minor)
select t.id, v.min_amt, v.max_amt, v.fee_type, v.fixed_fee, v.bps, v.min_fee, v.max_fee
from t, (values
  (1::bigint,    1000::bigint, 'fixed',      100::bigint, null::int,  null::bigint, null::bigint),
  (1001::bigint, null::bigint, 'percentage', null::bigint, 100::int,  150::bigint,  5000::bigint)
) as v(min_amt, max_amt, fee_type, fixed_fee, bps, min_fee, max_fee);

-- Only after a human has checked EVERY band against the source:
update public.provider_tariffs set verified_at = now()
where source_label = 'EXAMPLE ONLY - replace with the real source label';
```
Keep the tariff and tiers in one migration and verify at the end; once `verified_at` is set the tiers are frozen. To correct a published figure later, a new migration clears `verified_at`, fixes the band, and sets it again (or adds a new tariff with a later `effective_from`, which then wins).

## After loading
1. The harness proves the safety rules; a CI run proves nothing about *your numbers*, so compare 3-5 amounts by hand against the provider's own table.
2. In `/pay/fees`, pick the provider and try an amount in each band, on each band edge, and one in any gap.
3. Compare with your own history: the "What you've paid before" section should agree with the tariff for the same amounts. A disagreement means the tariff changed, or a band is wrong. Investigate before relying on either.
4. Enable `FEE_CALCULATOR_ENABLED` with the allowlist set to your own workspace first.
