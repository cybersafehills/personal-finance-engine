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

## `GET /api/mobile/statements`

The user's generated **statements**, newest first (at most 30), for the app's
Statements screen. Read-only; same guard as the others. Generating statements,
packs, schedules and provider documents stay on the web.

- `200 { ok: true, enabled, statements: [...] }`. `enabled: false` (and an
  empty list) when `FINANCIAL_STATEMENTS_ENABLED` is off, so the app can say so
  instead of showing an empty state. Otherwise `lib/mobile-statements.ts` reshapes
  the stored rows: a period label in the statement's own timezone, scope/type
  labels, status, and the **stored** totals per currency (opening, closing,
  credits, debits, fees, `reconciles`). The app does no statement maths and shows
  an unreconciled statement as such. Rows with an unknown status, timezone or
  currency are left out rather than shown wrongly.
- Scoped to the user's personal workspace (like the Inbox and Budgets); a bare
  query would also return households' statements.
- Amounts are integer minor units of each total's currency.

## `GET /api/mobile/statements/:id/document?format=pdf|csv`

A fresh, **five-minute signed download URL** for one ready statement, as JSON
(not a redirect: the app fetches with a bearer token, then opens the URL).

- `200 { ok: true, download: { url, filename, format } }`, or
  `200 { ok: true, download: null, reason }` with `reason` one of
  `unavailable` (flag off), `not_found` (no such statement for this user, or a
  malformed id), `not_ready` (still preparing / failed), `failed`. The guard's
  `401`, `403`, `404`, `429` apply as for the other endpoints.
- Ownership is checked with the caller's own session under RLS; only then does
  the service-role client render/sign (`lib/statement-download.ts`, shared with
  the web's redirecting route, which keeps its exact status codes). The download
  is audited (`statement.downloaded`); the audit passes the bearer token to
  `getUser` explicitly, since a bearer client has no stored session.
- The URL must never be stored or logged. The app asks again on every tap. It
  has its own rate-limit bucket because rendering a PDF is expensive.

## `GET /api/mobile/config`

Which optional features are switched on for the caller, so the app shows a screen
or button only when it will work. The flags live in server env, which the app
cannot read, so this runs the web's own gate functions (`lib/mobile-config.ts`).
Read-only; same guard as the others.

- `200 { ok: true, config: { pay, assistedPay, ussdDirectory, scanToPay,
  statements, insights, bills, spaces, integrations, businessSurfaces } }`, all
  booleans. No env values, allowlists or ids are exposed. `401`, `403
  mfa_required`, `404` flag off, `429`, `500` as for the other endpoints.
- Resolved for the user's personal workspace (no session cookie), like the Inbox.
- It reports availability only; the endpoints it describes still enforce their
  own gates, so a stale `config` can never grant anything.

## `POST /api/mobile/pay/intents`

Prepare a **draft payment** ("Pay X again") for the app. The first mobile
mutation that goes through a route rather than the database directly, because
the assisted-pay gate lives in server env and the web action has checks the
database does not enforce. It never charges anything: the result is a `draft`
plus the USSD instruction to hand off with.

- **Guard:** `mobilePost` in `lib/mobile-request.ts`, the same authentication as
  the GETs (flag, per-IP limit, token validated with Supabase Auth, **second
  factor complete**, which is exactly the web's `requireMfaForSensitiveAction`),
  a stricter limit (20/min/IP), and a JSON body of at most 8 KB. The handler runs
  under the caller's token, so RLS is still the boundary.
- **One code path:** `lib/pay/create-intent.ts` is shared with the web server
  action (`createDraftIntent`): validation, the directory's published service
  code, and the idempotent, membership-checked `create_payment_intent` RPC.
  On top of that this route checks the assisted-pay gate and that any
  `sourceAccountId` belongs to the workspace (the RPC does not).
- **Body:** `{ paymentType: pay_person | buy_airtime | pay_merchant | pay_bill,
  amountMinor, idempotencyKey (UUID, required), recipientMsisdn | merchantCode |
  billingReference (whichever the type needs), recipientName?, sourceAccountId? }`.
  Nothing else is read (no note, category, budget or trusted-recipient ids).
- **Double taps:** the client generates `idempotencyKey` once per attempt; the
  same key returns the same intent with `existed: true`.
- **Session freshness:** recorded on the intent from the access token's `iat`,
  as the web does from the session. It is advisory (never blocks), like the web.
- `200 { ok: true, intent, existed }` where `intent` is the shape below.
  Errors: `403 feature_disabled`, `422 invalid_request | invalid_account |
  could_not_prepare` (with a user-safe `message`), `400 invalid_request` (not
  JSON), `413 too_large`, plus the guard's `401`, `403 mfa_required`, `404`, `429`.
- Created in the user's personal workspace (no session cookie), like the others.

## `GET /api/mobile/pay/intents/:id`

A payment intent with its prepared instruction, for the review screen.

- `200 { ok: true, intent }` or `200 { ok: true, intent: null, reason }` with
  `reason` `unavailable` (pay surface off) or `not_found` (no such intent for
  this user, or a malformed id; RLS makes another user's id indistinguishable).
- `intent`: `id, state, paymentType, provider, currency, amountMinor,
  recipientName, recipientMasked, merchantCode, billingReference, expiresAt,
  createdAt, instruction`. `instruction` is `null` when there is no verified USSD
  route (the app must say so, not offer a dial), `{ ok: true, display, telHref }`
  (the filled string and a `tel:` link with `#` encoded), or `{ ok: false, error }`.
  The full phone number appears only inside the instruction, never as a field.
- The instruction is built by `lib/pay/instruction.ts`, the same function the
  web review panel uses (extracted from it), so the two cannot disagree.
- Recording the handoff (dialled / copied) is not here yet.

## Rollout

1. Deploy web with the route (dark).
2. Set `MOBILE_API_ENABLED=true` in Vercel production, redeploy.
3. Point the app's `EXPO_PUBLIC_API_BASE_URL` at the production origin.

## Not yet covered

Sign-up, password reset and MFA enrolment stay on the web for now; the app
links out to them.
