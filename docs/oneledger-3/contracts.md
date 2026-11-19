# OneLedger 3.0 — API contracts (S1, DRAFT — freeze after owner review)

Conventions follow `docs/mobile-api.md`: bearer Supabase token, `getUser` + MFA aal2, flag → 404 when off, `no-store`, rate-limited, bodies never logged, JSON. **The spec's candidate routes are adapted, not duplicated:** existing `/api/v1/{accounts,transactions,categories}` (developer API, API-key auth) are untouched; new app-facing routes go under `/api/mobile/*`; web uses server components calling the same `lib/insights` functions directly.

Common: money = `{ "amount_minor": "string-int64", "currency": "RWF" }` (string to stay JSON-safe for bigint). Timestamps ISO-8601 UTC plus `tz` echo. Pagination: opaque `cursor`, `limit` ≤100, stable sort `(effective_at desc, id desc)`. Errors: `{ok:false,error:<code>,message}` with codes `invalid_request|unauthorized|mfa_required|forbidden|not_found|rate_limited|conflict|server_error`. Scope param: `workspace_id` (validated against membership; default personal).

## Insights (flag INSIGHTS_CENTER_ENABLED)
`GET /api/mobile/insights/overview?from&to&account_id[]&category&counterparty_id&type&currency`
→ `{ period:{from,to,tz}, currency, money_in, money_out, net, counts:{in,out}, transfers_excluded:{amount,count}, pending:{amount,count}, by_category:[{category,amount,pct,drilldown}], by_account:[…], top_counterparties:[…], compare:{prev_period, delta}, freshness:{computed_at, latest_txn_at}, notes:[ "estimate"|"incomplete_data" codes ] }`
Every `drilldown` = a filter object accepted verbatim by `GET /api/mobile/transactions`.
`GET …/insights/trends?granularity=day|week|month` → series of `{bucket_start, in, out, net}`.
Multi-currency: one block per currency; no silent conversion.

## Accounts / balances (flag BALANCE_PROVENANCE_ENABLED)
`GET /api/mobile/accounts` → `[{id, alias, provider, masked_identifier, currency, visibility, balance:{status:"confirmed|estimated|stale|unavailable", amount?, as_of?, basis}, ingestion_state}]`
`POST /api/mobile/accounts/{id}/reconcile` body `{observed_amount_minor, as_of, note?}` + `Idempotency-Key` → creates a manual `balance_observation` + audit event; returns new status.

## Transactions
`GET /api/mobile/transactions` (filters = insights filters) ; `GET /…/{id}` (sensitive fields like Cash Power token returned only to roles with capability `view_sensitive_tokens`, else `redacted:true`); `PATCH /…/{id}/classification` `{category?, counterparty_id?}` → triggers aggregate invalidation (projections are computed on read in v1, so no rebuild needed).

## Counterparties (flag COUNTERPARTIES_ENABLED)
`GET /counterparties?q&kind&period` → `[{id, display_name, kind:"person|merchant|unknown", confidence:"user_confirmed|high|low", sent, received, net, count, first_at, last_at}]`
`GET /counterparties/{id}` (+ transactions via drill-down) ; `PATCH /counterparties/{id}` `{display_name?, kind?}` ;
`POST /counterparties/merge` `{survivor_id, merged_ids[]}` and `POST /counterparties/split` `{counterparty_id, identifier_ids[]}` — both write `counterparty_merge_events` and are reversible (`POST /counterparties/merge/{event_id}/undo`).
Same display name alone never auto-merges; auto-grouping only on normalised identifier (e.g. `2507XXXXXXXX`, merchant code).

## Payment requests (flag PAYMENT_REQUESTS_ENABLED; Stage 1 only)
`POST /payment-requests` `{amount_minor, currency, recipient_destination, reference?, expires_at}` + Idempotency-Key → `{id, public_url, status:"open"}` (token 128-bit random, only hash stored).
`GET /payment-requests`, `GET /payment-requests/{id}`, `POST /payment-requests/{id}/cancel`.
Public (no auth, rate-limited, no PII beyond need): `GET /r/{token}` → `{amount, currency, reference, recipient_display, expires_at, status, disclaimer:"unverified"}`. Never returns workspace/user data. Status set: `open|cancelled|expired|marked_paid_by_owner|matched` — `matched` only via a human-confirmed link to a real incoming transaction; link-open or payer claim never changes status.
Fee estimates (flag FEE_CALCULATOR; implemented, see `s10-fee-calculator.md`): `GET /api/mobile/fees/estimate?amount&currency[&type][&network][&workspace_id]` → `{workspace_id, computed_at, amount_minor, currency, transaction_type, history:{status:"estimate"|"not_enough_history"|"no_history", min_minor, max_minor, typical_minor, count, …}, published:null|{network, has_schedule, fee_type, estimate:{status:"exact"|"range"|"upper_bound"|"not_computable"|"not_in_effect", …}, source_label, source_url, effective_from, effective_to, limit_warnings[]}, disclaimer}`. Amounts are decimal strings. History (your own past fees) and the published schedule are reported separately, never blended; a tiered/unknown/varies fee returns no number, never 0; no split suggestion is ever returned.

## Notifications
Existing `notifications` table/API retained; `GET/PATCH /notifications` added to mobile API only if not already covered by supabase-js under RLS (**to verify in S6**).

## Contract enforcement
- JSON Schema files in `docs/oneledger-3/schemas/` (one per response) are the source of truth; a Deno test validates handler outputs against them and mobile client types are generated/checked from them in CI.
- Mocks used before APIs exist are labelled `__mock` in the response and fail the release checklist.
