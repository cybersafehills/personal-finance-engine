# OneLedger subscription billing: design

Status: **designed and implemented as a staff-run ledger** (migration `20270124000000`, console pages under `/revenue/*`). No payment provider is integrated; nothing here moves money. Date: 2026-11-20.

## Decisions (defaults I chose, please overrule where wrong)

| # | Decision | Why |
|---|---|---|
| D1 | **Commercial plans are a new catalog** `billing_plans`: Personal, VIP, Business, prices RWF 2,500 / 5,000 / 10,000 monthly and 30,000 / 60,000 / 120,000 yearly. A check constraint enforces `yearly = monthly x 12`: **no annual discount**, as specified. | The spec's tiers do not match the stored `workspace_plans` tiers (`free`, `personal_plus`, `household`, `business`). Keeping them separate avoids rewriting the entitlement system. |
| D2 | **Billing never changes entitlements.** A subscription records what a workspace *paid for*; `workspace_plans` (what it can *use*) is untouched. A nullable `entitlement_tier` on each plan holds the proposed mapping, unused until you approve it. | Entitlement changes affect customer features and `web/lib/entitlements/plans.ts`; that is a product decision and a customer-app change. Proposed mapping (not applied): Personal -> `personal_plus`, VIP -> `household`, Business -> `business`. |
| D3 | **Subscriptions belong to a workspace**, not a user. | Matches how plans are already stored (a Household Space carries the household plan). |
| D4 | **Initiation is not settlement.** A payment has `status` (`initiated`, `succeeded`, `failed`, `reversed`) separate from `reconciliation_state` (`unreconciled`, `matched`, `exception`). Only `succeeded` counts as cash. | Required by the spec: never equate a started payment with money received. |
| D5 | **Payments can only be recorded at the plan's exact price** for the chosen interval, and are **idempotent** on `(provider, provider_reference)`. | No arbitrary balance or amount editing; a retried webhook or double click cannot double-count. |
| D6 | **Recorded by staff for now** (`source = 'staff_recorded'`), e.g. a Mobile Money receipt matched by hand. A future provider webhook will insert through the same function with its own source. | There is no provider integration to trust yet. |
| D7 | **Refunds are four-eyes and never automatic.** Request (needs `manage_subscriptions`) -> approve/reject by a different person holding `approve_refunds` (Finance Administrator only; the Platform Owner deliberately cannot) -> staff marks it processed with the external payout reference. The console does **not** pay anyone. Total refunds per payment can never exceed the payment. | Spec: refunds need authorization, idempotency, no arbitrary money movement. |
| D8 | **Period rules:** a settled payment extends the subscription from `max(now, current period end)` by one month or one year, so early renewal never loses days. Cancel is *at period end* by default; an immediate cancel needs a reason. | Standard, predictable, auditable. |
| D9 | **Privacy:** workspace is shown by masked reference and type only. No names, emails, transaction data or balances. Platform Owner sees revenue metrics but cannot approve refunds. | Minimum necessary disclosure. |

## Definitions (shown in the UI)

- **MRR (estimate)** = sum over `active` subscriptions of monthly price, plus yearly price / 12 for yearly ones. **ARR** = MRR x 12. These are *recurring revenue estimates*, not cash.
- **Collected** = sum of `succeeded` payments in the range minus `processed` refunds in the range. This is the only "money received" figure.
- **Successful payment rate** = succeeded / (succeeded + failed) for payments initiated in the range.
- **Churn (period)** = subscriptions that became `cancelled` or `expired` in the range / subscriptions active at the start of the range.
- Anything with no underlying rows shows "No data", never a zero that looks like a measurement.

## Out of scope (needs a decision or an integration)

1. A real provider (MTN MoMo collections, Airtel, card): webhooks, signature checks, settlement files.
2. Customer-facing checkout / self-serve upgrade in the customer app.
3. Entitlement sync from billing (D2).
4. Tax/VAT invoices and receipts (Rwanda requirements to be confirmed).
5. Trials and proration (none exist; the schema has no trial concept).

## Lifecycle

```
subscription: pending --(first settled payment)--> active --(period ends unpaid)--> past_due --> expired
                         |                           |--(cancel at period end)--> active until end, then cancelled
                         |--(cancel)--> cancelled
payment:      initiated -> succeeded | failed ;  succeeded -> reversed
refund:       requested -> approved -> processed ; requested -> rejected
```

`past_due` and `expired` transitions are applied by `console_billing_roll_periods()` (staff-triggered; a scheduled job can call it later).
