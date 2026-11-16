# Mobile API (`/api/mobile/*`)

Endpoints the OneLedger mobile app (`oneledger-mobile/`, ADR 0019) calls for
operations the web performs in server actions. Everything else the app does
is `supabase-js` under Row Level Security, the same as the web's session
client.

Status: **sign-in only (PR 2).** Dark unless `MOBILE_API_ENABLED=true`.

## Conventions

- Excluded from the session gate in `web/proxy.ts` (the app has no cookie).
  Each handler does its own auth.
- `404` when `MOBILE_API_ENABLED` is not exactly `true`.
- JSON in, JSON out, `cache-control: no-store`. Bodies are never logged.
- CORS only for origins listed in `MOBILE_API_CORS_ORIGINS` (exact match,
  for the Expo web development preview). Unset in production.
- Pure logic lives in `web/lib/mobile-api.ts` (`mobile_api_test.ts`).

## `POST /api/mobile/auth/sign-in`

Body: `{ "email": string, "password": string }`.

Runs `passwordSignIn` (`web/lib/auth/password-sign-in.ts`), the same helper
the web login action uses: per-account lockout (8 failures / 15 minutes),
`record_login_attempt`, lockout alert email, new-sign-in email.

| HTTP | Body | Meaning |
|---|---|---|
| 200 | `{ ok: true, access_token, refresh_token, mfa_required }` | Signed in. The app adopts the session with `supabase.auth.setSession` and stores it in the device keystore. `mfa_required` = a TOTP factor is enrolled and the session is not yet `aal2`; the app then verifies the code directly with Supabase (`mfa.challengeAndVerify`). |
| 400 | `{ ok: false, error: "invalid_request", message }` | Malformed body. No auth attempt made. |
| 401 | `{ ok: false, error: "invalid_credentials", message }` | Supabase's own message, passed through. |
| 429 | `{ ok: false, error: "locked_out" \| "rate_limited", message }` | Account lockout, or the coarse per-IP limiter (20 / minute / instance). |
| 404 | `{ ok: false, error: "not_found" }` | Flag off. |

## `GET /api/mobile/inbox`

The same prioritized Inbox the web renders (`lib/financial-inbox.ts`), for the
app's Inbox tab. Read-only.

- **Auth:** `Authorization: Bearer <Supabase access token>`. The route
  validates it with Supabase Auth (`getUser`), then requires the second factor
  to be complete: a user with a verified factor needs an `aal2` token, else
  `403 mfa_required`. (The web proxy has no MFA gate of its own; this is
  stricter on purpose.)
- **How it reuses the web code:** `lib/mobile-session-context.ts` keeps the
  validated token in an `AsyncLocalStorage` for the request, and
  `supabaseSession()` builds its client from it instead of the cookie. Outside
  a mobile request the store is empty and web behaviour is unchanged. All
  queries still run as the user under RLS; feature flags (payments,
  integrations, bills) are evaluated server-side. There is no session cookie,
  so the active workspace is the user's personal one (the web's cookie-less
  default).
- **Responses:** `200 { ok: true, inbox: { items, total, criticalCount,
  highCount, countsByKind } }`, `401 unauthorized`, `403 mfa_required`,
  `404` flag off, `429 rate_limited` (60 / minute / IP / instance), `500
  server_error`. `no-store`; the token and body are never logged.
- **In-app decisions:** only plain database functions the app already calls
  under the user's session (confirm / dismiss a category, merge / dismiss a
  duplicate). Every other item opens its web page.

## `GET /api/mobile/budgets`

The user's **active budgets** with their actuals, for the app's Budget screen
and Home card. Read-only; same guard as the Inbox (`lib/mobile-request.ts`:
flag, rate limit, bearer token validated with Supabase Auth, second factor
required, request-scoped session, `no-store`).

- The figures come from `getBudgetActuals`, the single canonical aggregation
  (`lib/budget-math.ts`); the app never recomputes them. `lib/mobile-budgets.ts`
  only reshapes them to JSON: alert amounts are `bigint` (not JSON-safe), so
  alerts are rendered to the same sentences the web shows
  (`lib/budget-alert-text.ts`, shared with `components/AlertsList.tsx`).
- `200 { ok: true, budgets: [...] }` (empty when there is no active budget; at
  most 3; budgets in a currency the apps cannot format are left out),
  `401`, `403 mfa_required`, `404` flag off, `429`, `500`.
- Scoped to the user's personal workspace (no session cookie, so the web's
  cookie-less default), like the Inbox.
- Amounts are integer minor units of the budget's currency.

## OneLedger 3.0 endpoints (dark; each behind its own opt-in flag)

All use the same guard as `/inbox` and `/budgets` (flag `MOBILE_API_ENABLED`, per-IP limit, bearer token validated with Supabase Auth, second factor required, `no-store`). Each additionally needs its feature flag (`<FLAG>_ENABLED=true`, optional `<FLAG>_WORKSPACE_ALLOWLIST`) or it answers `404 not_found` (indistinguishable from a missing route). A request may pass `workspace_id` to act on a workspace the caller is an active member of; otherwise it is the personal workspace. A workspace the caller isn't in is `404`, never `403`. Amounts are integer minor units sent as **decimal strings**. Errors: `{ ok:false, error:<code>, message? }` - `message` is only ever a fixed, user-facing sentence.

| Endpoint | Flag | Purpose |
|---|---|---|
| `GET /api/mobile/insights/overview?from&to[&account_id=…][&category][&counterparty][&tz][&granularity=day\|week\|month][&compare=previous]` | `INSIGHTS_CENTER` | Money in/out/net, categories, accounts, top counterparties, transfers excluded, pending, per currency. `from`/`to` are full ISO instants (`to` exclusive), max 400 days; `422 range_too_large` above 20,000 transactions. Every aggregate carries a `drilldown` filter. |
| `GET /api/mobile/insights/drilldown?kind&currency&from&to[&value][&limit<=100&offset]` | `INSIGHTS_CENTER` | The transactions behind one aggregate, classified exactly as the totals are. |
| `GET /api/mobile/accounts` | `BALANCE_PROVENANCE` | Accounts with `balance.status` = `confirmed\|estimated\|stale\|unavailable`, `amount_minor` (null when unavailable), `as_of`, `basis`, `reasons`. |
| `GET /api/mobile/counterparties?[q][&kind][&limit&offset]` | `COUNTERPARTIES` | People/merchants with sent/received/net/count/first/last per currency, plus `unresolved_transactions`. |
| `GET /api/mobile/counterparties/{id}` | `COUNTERPARTIES` | One counterparty, what was merged into it, and its transactions (paged). `409 merged_into:<id>` if it was merged away. |
| `POST /api/mobile/payment-requests` | `PAYMENT_REQUESTS` | Create a non-custodial payment request; returns `{ id, url, replayed }`. The link is returned **once** (`url` is null on an idempotent replay). Body: `amount_minor` (digit string), `currency`, `destination_type` (`momo_phone`\|`merchant_code`), `destination_value`, `recipient_display`, `reference?`, `expires_in_hours` (24/72/168/720/2160), `idempotency_key`. `422 payment_request_rejected` carries a safe `message`. |

**Mutations the app calls directly with supabase-js under RLS** (member+ checked and audited inside the function; no extra API needed): `record_manual_balance_observation(p_account_id, p_amount_minor, p_as_of, p_note)`, `backfill_counterparties(p_workspace_id)`, `update_counterparty(p_id, p_display_name, p_kind)`, `merge_counterparties(p_survivor, p_merged)`, `undo_counterparty_merge(p_event_id)`, `split_counterparty(p_counterparty_id, p_identifier_ids, p_transaction_ids, p_new_name)` (returns the split event id), `undo_counterparty_split(p_event_id)`, `cancel_payment_request(p_id)`, `mark_payment_request_paid_by_owner(p_id, p_note)`, `link_payment_request_transaction(p_id, p_transaction_id)`. Reads of `payment_requests_v` / `payment_request_events` are plain RLS selects.

## Rollout

1. Deploy web with the route (dark).
2. Set `MOBILE_API_ENABLED=true` in Vercel production, redeploy.
3. Point the app's `EXPO_PUBLIC_API_BASE_URL` at the production origin.

## Not yet covered

Sign-up, password reset and MFA enrolment stay on the web for now; the app
links out to them.
