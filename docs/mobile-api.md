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

## Active Space (`X-Workspace-Id`)

The web picks the active Space from an `active_workspace_id` cookie; the app has
no cookie, so every request below (`GET` and `POST` alike) may carry `X-Workspace-Id: <workspace uuid>`.

- It is a **request, not a grant.** `getActiveWorkspaceId()` (`lib/queries.ts`)
  still requires an active membership in that workspace and otherwise falls back
  to the user's personal Space, exactly as for the cookie. A malformed value is
  ignored (same as no header).
- With no header the endpoints below use the personal Space (unchanged).
- When the header is sent, the response carries `workspace_id`: the Space actually
  used. An app talking to a server that predates this header (or whose membership
  was revoked) sees a different `workspace_id` or none, and must not present the
  data as that Space's.
- Only what the web scopes by the active Space follows it (Inbox read models,
  config flags, ...). The transaction, balance and budget list queries are
  **not** filtered by Space on the web (RLS is the boundary), and are not here.
- CORS allows the header for allowlisted development origins.

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

## Space & members (`POST /api/mobile/spaces/...`)

Writes the web guards with a second-factor step-up in the server action (not in
the database), so the app reaches them **only** through these routes: the bearer
guard (flag, per-IP limit, token validated with Supabase Auth, second factor
complete when the user has one) is that step-up. Reads (members, pending
invites, names via `space_member_directory`) are plain `supabase-js` under RLS.

Every write names its Space explicitly in the body (`workspaceId`) and **never**
falls back to the personal Space: unlike a read, a write landing in the wrong
Space would be silent. A Space the caller is not an active member of is `404`.
A personal Space is `422 personal_space` (it has no other members).

| Route | Body | Authority |
|---|---|---|
| `members/role` | `{ workspaceId, membershipId, role }` (`owner`/`admin`/`member`/`viewer`) | `set_member_role`: owners only; never leaves a Space without an owner |
| `members/remove` | `{ workspaceId, membershipId }` | `remove_member`: owners only; never the last owner |
| `invites` | `{ workspaceId, email, role }` (`admin`/`member`/`viewer`; never owner) | `workspace_invites` insert policy (a manager of that Space, `invited_by` = caller) |
| `invites/revoke` | `{ workspaceId, inviteId }` | `workspace_invites` update policy; must be pending in that Space |

- `200 { ok: true }`; `invites` also returns `{ link, emailSent }`. **The link is
  shown once** (only its hash is stored); the app must not keep or log it.
- Errors carry a fixed sentence in `message`, never database text:
  `403 owner_only`, `409 last_owner`, `404 not_found`, `403 could_not_invite`,
  `422 invalid_request`, `403 could_not_revoke`, `422 could_not_update`.
- Invites share `lib/spaces/invites.ts` with the web action (one code path).
- Not included: resending an invite (it rotates the token; later).

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
- Scoped to the active Space (`X-Workspace-Id`, else the personal Space), like the Inbox.
- Amounts are integer minor units of the budget's currency.

## OneLedger 3.0 endpoints (dark; each behind its own opt-in flag)

All use the same guard as `/inbox` and `/budgets` (flag `MOBILE_API_ENABLED`, per-IP limit, bearer token validated with Supabase Auth, second factor required, `no-store`). Each additionally needs its feature flag (`<FLAG>_ENABLED=true`, optional `<FLAG>_WORKSPACE_ALLOWLIST`) or it answers `404 not_found` (indistinguishable from a missing route). A request may pass `workspace_id` to act on a workspace the caller is an active member of; otherwise it is the personal workspace. A workspace the caller isn't in is `404`, never `403`. Amounts are integer minor units sent as **decimal strings**. Errors: `{ ok:false, error:<code>, message? }` - `message` is only ever a fixed, user-facing sentence.

| Endpoint | Flag | Purpose |
|---|---|---|
| `GET /api/mobile/insights/overview?from&to[&account_id=…][&category][&counterparty][&tz][&granularity=day\|week\|month][&compare=previous]` | `INSIGHTS_CENTER` | Money in/out/net, categories, accounts, top counterparties, transfers excluded, pending, per currency. `from`/`to` are full ISO instants (`to` exclusive), max 400 days; `422 range_too_large` above 20,000 transactions. Every aggregate carries a `drilldown` filter. |
| `GET /api/mobile/insights/drilldown?kind&currency&from&to[&value][&limit<=100&offset]` | `INSIGHTS_CENTER` | The transactions behind one aggregate, classified exactly as the totals are. |
| `GET /api/mobile/accounts` | `BALANCE_PROVENANCE` | Accounts with `balance.status` = `confirmed\|estimated\|stale\|unavailable`, `amount_minor` (null when unavailable), `as_of`, `basis`, `reasons`. |
| `GET /api/mobile/counterparties?[q][&kind][&limit&offset]` | `COUNTERPARTIES` | People/merchants with sent/received/net/count/first/last per currency, plus `unresolved_transactions` (all not yet linked) and `sortable_transactions` (the subset with a name or number that sorting can link). |
| `GET /api/mobile/counterparties/{id}` | `COUNTERPARTIES` | One counterparty, what was merged into it, and its transactions (paged). `409 merged_into:<id>` if it was merged away. |
| `POST /api/mobile/payment-requests` | `PAYMENT_REQUESTS` | Create a non-custodial payment request; returns `{ id, url, replayed }`. The link is returned **once** (`url` is null on an idempotent replay). Body: `amount_minor` (digit string), `currency`, `destination_type` (`momo_phone`\|`merchant_code`), `destination_value`, `recipient_display`, `reference?`, `expires_in_hours` (24/72/168/720/2160), `idempotency_key`. `422 payment_request_rejected` carries a safe `message`. |
| `POST /api/mobile/transactions/{id}/reveal-token` | `UTILITY_TOKEN_CAPTURE_ENABLED` | Show a prepaid-electricity token (once, `no-store`). Every call is audited and limited to 20/hour/user; requires member+ and visibility of the transaction's source. `404 not_found` for anything the caller may not see (no oracle); `422 reveal_failed` with a safe `message` otherwise. Decryption uses the server-only `SENSITIVE_DATA_KEYRING`. |

**Mutations the app calls directly with supabase-js under RLS** (member+ checked and audited inside the function; no extra API needed): `record_manual_balance_observation(p_account_id, p_amount_minor, p_as_of, p_note)`, `backfill_counterparties(p_workspace_id)`, `update_counterparty(p_id, p_display_name, p_kind)`, `merge_counterparties(p_survivor, p_merged)`, `undo_counterparty_merge(p_event_id)`, `split_counterparty(p_counterparty_id, p_identifier_ids, p_transaction_ids, p_new_name)` (returns the split event id), `undo_counterparty_split(p_event_id)`, `cancel_payment_request(p_id)`, `mark_payment_request_paid_by_owner(p_id, p_note)`, `link_payment_request_transaction(p_id, p_transaction_id)`. Reads of `payment_requests_v` / `payment_request_events` are plain RLS selects.

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
- Scoped to the active Space (like the Inbox and Budgets); a bare query would
  also return every other Space's statements.
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
- Resolved for the active Space (`X-Workspace-Id`, else the personal Space), like the Inbox. The pay flags are per Space, so this is the answer for the Space a draft would be created in.
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
- **Body:** `{ paymentType: pay_person | pay_merchant, amountMinor,
  idempotencyKey (UUID, required), recipientMsisdn (person) | merchantCode
  (merchant), recipientName?, sourceAccountId (required for a merchant) }`.
  Nothing else is read (no note, category, budget, provider or
  trusted-recipient ids). Only these two types have a genuine verified USSD
  route: airtime is deliberately not offered (the directory resolves
  `buy_airtime` to the *send-money* code, which would transfer money rather than
  buy airtime) and bill payments have no route yet.
- **Which network to dial:** a person payment uses the recipient's number; a
  merchant has no number, so the **paying account's own network** decides. It is
  read from the account row server-side (`providerNetworkForAccount`), never from
  the client, exactly the fallback the web form applies in the browser.
- **Double taps:** the client generates `idempotencyKey` once per attempt; the
  same key returns the same intent with `existed: true`.
- **Session freshness:** recorded on the intent from the access token's `iat`,
  as the web does from the session. It is advisory (never blocks), like the web.
- `200 { ok: true, intent, existed }` where `intent` is the shape below.
  Errors: `403 feature_disabled`, `422 invalid_request | invalid_account |
  could_not_prepare` (with a user-safe `message`), `400 invalid_request` (not
  JSON), `413 too_large`, plus the guard's `401`, `403 mfa_required`, `404`, `429`.
- Created in the **active Space** (`X-Workspace-Id`, else the personal Space): the `POST` honours the header like the reads, and the paying account is checked against that Space. The app therefore only offers "Pay again" for a transaction that lives in the active Space.

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

## `POST /api/mobile/pay/intents/:id/handoff`

Record that the user opened the dialer or copied the code. Moves the intent
`draft -> initiated -> awaiting_verification` so the payment SMS can later be
matched to it; without this an app-created intent would stay a draft forever.
A navigation event, never a claim the payment succeeded.

- **Body:** `{ method: "dialer", outcome: "dialer_opened" | "dialer_unsupported" }`
  or `{ method: "copy", outcome: "copied" | "fallback_shown" }`. `qr` is not
  accepted from the app, and an outcome that doesn't fit the method is refused.
- `200 { ok: true, intent }` (the refreshed intent), `404 not_found` (unknown id,
  or one in a workspace the user is not in; the first database call is checked so
  this is reported), `422 invalid_request`, `403 feature_disabled`, plus the
  guard's usual codes. Same guard as the create route (own rate-limit bucket).
- Shares `lib/pay/handoff.ts` with the web action (the optional SMS-reconciliation
  step uses the service role there; the web's behaviour is unchanged).

## `GET /api/mobile/categories`

Where the money has gone, all time, per category: the web's Categories page, for
the app's Categories screen. Read-only; same guard as the others.

- `200 { ok: true, categories: [{ category, totalRwf, transactionCount }],
  truncated }`, largest total first. `"Uncategorized"` stands for a null
  category. The figures come from `getCategoryTotalsComplete`
  (`lib/category-totals.ts` holds the pure parts); the app never recomputes them.
- Covers every Space the user belongs to (no Space filter), exactly like the web
  page; settled outgoing transactions only, merged duplicates excluded.
- **Why it pages:** the REST API returns at most `max_rows` per request (1000 in
  `supabase/config.toml`; production's value was not checked), so reading all rows
  in one request would silently drop everything past the cap and show wrong totals
  with no error. It reads a page at a time, advancing by the rows it actually
  received and stopping only on an empty page (so a lower server cap cannot cut it
  short), in a stable `id` order, 50 pages at most. `truncated` is true only if that
  cap was reached, so the app can say the totals are incomplete. The web Categories
  page uses the same function.
- **Errors are errors:** a failed read throws, so this answers `500` and the app
  offers a retry, instead of a 200 that says "no spending yet".
- Home's "top spending category" and the category-name suggestions still use the
  old one-request `getCategoryTotals` on purpose (they run on every load and must
  stay one cheap request), so they keep the old row ceiling.
- Amounts are whole RWF.

## `GET /api/mobile/reports`, `GET /api/mobile/reports/:id`, `GET /api/mobile/reports/:id/document`

The user's **daily financial reports** (the web's Reports page), for the app's
Reports screens. Read-only; same guard as the others.

- **A report is an immutable snapshot** (`report_runs.report_payload`) that the
  web, the PDF and the morning email all render; nothing here recomputes a
  figure. A report belongs to its recipient (`report_runs_select_own`), across
  every Space they get reports in, exactly like the web page.
- **Why the server renders the words:** alerts are sentences shared with the
  email (`lib/report-alert-messages.ts`), and dates are formatted in the report's
  own IANA timezone with `toLocaleString`, which a phone's JS engine may not
  support. `lib/mobile-reports.ts` renders both, with the web's own functions, so
  the app only displays. An unknown status or an unrecognised timezone drops the
  row rather than showing it wrongly.
- **Errors are errors:** these routes use the throwing reads
  (`getReportRunsStrict`, `getReportRunByIdStrict`, and `createReportDownload` with
  `strict`), so a failed database read answers `500` and the app offers a retry,
  never "No reports yet", "not found" or a missing PDF. The web's own callers keep
  their long-standing behaviour (a failed read shows nothing), and the web PDF route
  is unchanged.
- **List:** `200 { ok: true, reports: [{ id, dateLabel, status, statusLabel,
  generatedLabel }] }`, newest first, at most 30.
- **Detail:** `200 { ok: true, report }` with `snapshot` (closing balance may be
  `null`), `categories`, `budget` (`null` = no active RWF budget), `trends` (only
  those with history, each with a `tone`: spending/fees up are unfavourable,
  income up is favourable, a count is neutral), `alerts` (report alerts then
  budget alerts, each with a `tone`), `forecast`, `insights` (AI commentary,
  separate from the snapshot) and `hasDocument`. `200 { ok: true, report: null,
  reason: "not_found" }` for an unknown, malformed or someone else's id (RLS makes
  them indistinguishable). A report that failed or isn't generated yet has no
  snapshot and carries the (capped) failure reason.
- **Document:** `200 { ok: true, download: { url } }` or `{ download: null, reason:
  not_found | not_ready | failed }`. A fresh **five-minute signed URL** for the
  PDF, as JSON (not a redirect: the app fetches with a bearer token, then opens
  the URL). Ownership is the caller's own RLS session; the service role is used
  only afterwards to render, cache and sign (`lib/report-download.ts`, shared with
  the web's redirecting route, whose status codes are unchanged). The app asks
  again on every tap; the URL must never be stored or logged. Its own rate-limit
  bucket, since rendering a PDF is expensive.

## `GET /api/mobile/bills[?status=...]`, `GET /api/mobile/bills/:id`

The invoices and receipts of the **Space the app is viewing** (the web's
`/bills`), for the app's Bills screens. Read-only; same guard as the others.
Uploading, reviewing, approving and the original file stay on the web.

- **Per-Space gate.** The web's own gate (`BILLS_ENABLED` plus the optional
  workspace allowlist) runs for the active Space; when Bills is off the answer is
  `404 not_found`, like the web page's `notFound()`. `GET /api/mobile/config`
  carries `bills` for the same Space, and the app shows its entry point only when
  that is true.
- **Scoped to one Space explicitly.** RLS on `bill_documents` is plain
  membership, so a query without a workspace filter would return documents from
  every Space the user belongs to under the active Space's gate and permissions.
  The list filters on the active Space, and a document that is in another Space
  answers `404`, exactly like one that does not exist.
- **List:** `{ bills: [{ id, filename, status, statusLabel, tone, uploadedLabel,
  pageCount }], hasMore, pageSize }`, newest 50 (`hasMore` when older exist).
  `status` must be a real status (`400 invalid_status` otherwise; never silently
  "all").
- **Detail:** `{ bill }` with the details, then, **only when automated extraction
  is on for the Space**, `extraction` (fields and line items; corrected value
  beats normalised beats raw) and `checks` (findings, worst first; `outOfDate`
  when a field was corrected after they ran). `history` is `null` for a member
  without `bill.audit.view` (a different answer from `[]`). Raw provider
  payloads, `reason`/`error` JSON, model names, the checksum and the storage key
  are never returned.
- **Rendered on the server.** Status, event and field wording is the web's
  (`lib/bills/display.ts`, shared with the web components), dates are Kigali time
  and amounts use the currency's own minor digits, so the phone formats nothing.
- Failed reads are `500`, never an empty list that would read as "no documents".
- **`canViewOriginal`** on the detail is the caller's `bill.download_original`
  capability in the active Space; the app offers "View original" only when it is `true`.

### `POST /api/mobile/bills/:id/original`

A fresh, short-lived signed URL for the document's immutable original, as JSON
(`{ download: { url } }`); the app fetches with its bearer token and opens the
URL. The web's `/api/bills/:id/original` does the same behind a cookie.

- **A POST, because it is not read-only:** `record_bill_original_download` writes
  an audit row and a processing-journal event on every ask, as on the web. The app
  asks once per tap (double taps are one request), opens the link at once and never
  stores or logs it. POST rate limit applies (20 a minute).
- **Active Space first.** That function checks membership and the capability for the
  document's *own* Space, not the one the app is viewing, so the route requires the
  document to be in the active Space (otherwise it is `404`, like an unknown id).
- `403 forbidden` without `bill.download_original`; `404 not_found` for an unknown,
  malformed or other-Space id, or when Bills is off for the Space.

## `GET /api/mobile/categorization-rules`, `POST /api/mobile/categorization-rules/active`

The rules that automatically categorize transactions in **the Space the app is
viewing** (the web's Categorization rules page), in the order they are checked.
Same guard as the others. The app lists them and can **pause or resume** one;
creating, editing, reordering, applying to history and suggestions stay on the web.

- **List:** `{ rules: [{ id, title, categoryLabel, summary, active, originLabel,
  scopeLabel, matchedLabel }] }`. `summary` is the web's condition sentence
  (`lib/categorization/rule-summary.ts`, shared with the web component) with en-US
  numbers, so the phone formats nothing. Scoped to the active Space explicitly; a
  failed read is `500`, never an empty list that would read as "no rules".
- **Pause or resume:** body `{ workspaceId, ruleId, active }`. The Space is named
  explicitly and never defaults to Personal: a Space the caller is not in is `404`,
  a rule that is not in the named Space is `404`, a viewer is `403` (RLS only lets
  a member or above update, and an UPDATE that RLS hides returns no rows and no
  error, so the changed row is read back rather than trusted). The answer is the
  rule as it now is. There is no delete: pausing is how a rule is retired.

## Rollout

1. Deploy web with the route (dark).
2. Set `MOBILE_API_ENABLED=true` in Vercel production, redeploy.
3. Point the app's `EXPO_PUBLIC_API_BASE_URL` at the production origin.

## Not yet covered

Sign-up, password reset and MFA enrolment stay on the web for now; the app
links out to them.

## `POST /api/mobile/pay/scan/classify`

Scan to pay, step 1. Body `{ "raw": "<decoded QR text>" }` (1 to 8192 characters).
Dark unless `scanToPay` is on in `GET /api/mobile/config` (403 `feature_disabled`).
Returns `{ ok: true, result }` where `result` is the web's `ScanResult`: either
`{ ok: true, model }` (class `verified_ussd`, `provider_link` or
`oneledger_payment`, with masked identifiers and warnings) or `{ ok: false,
class, reason }` with a coarse reason. Read-only: nothing is stored or dialed.
The text is re-parsed server-side (a scan is data, never authorization); the
reply never echoes the scanned text.

## `POST /api/mobile/pay/scan/prepare`

Scan to pay, step 2. Body `{ "raw": "...", "amountMinor"?: 1500 }`; the amount is
only for a code that carries none (whole RWF, re-validated). Returns `{ ok:
true, outcome }` with `outcome.status`: `prepared` (`intentId`, `telHref`,
`existed`: a draft with source `qr_scan`), `info_only` (`telHref`, a menu or
balance code, nothing recorded), `amount_required`, `currency_unsupported`,
`unsupported`, `feature_disabled` or `error`. Idempotent on the code and amount.
Never charges anything and never dials. Recording that the user opened the
dialer uses `POST /api/mobile/pay/intents/:id/handoff`.

## `POST /api/mobile/pay/intents/:id/settle`

Body `{ "outcome": "sent" | "failed" }`. The person who dialled says what happened
when no provider message has settled a handed-off payment: `sent` runs the web's
`manually_confirm_payment` (the intent becomes `successful` with `verified: false`),
`failed` transitions it to `failed`. 404 for an unknown or foreign id, 409 when the
current state does not allow it, 422 for a bad outcome. Returns the refreshed
`intent`. Never marks a payment provider-verified.

The pay intent payload now also carries `updatedAt` (when it last changed) and
`verified` (true only when the provider's message confirmed it). `GET
/api/mobile/config` gains `paymentRequests`.


## Documents creation and report schedules

The native Documents console uses the existing bearer/MFA/Space guard for these endpoints:

- `GET /api/mobile/statements/generate`: authorized financial-source options and the profile timezone. Requires the Statements feature flag and the same `statement.generate` capability as the web form.
- `POST /api/mobile/statements/generate`: `{ action: "preview" | "generate", request: StatementRequest }`. The bounded transport parser delegates to the canonical web preview/generator. Preserve `clientToken` across generation retries. Currency totals, coverage warnings, account authorization and immutable storage remain server responsibilities. Large requests use the existing statement worker.
- `GET /api/mobile/reports/preferences`: saved settings for the caller and selected Space. A failed read is an error, never a default form that can overwrite existing settings.
- `POST /api/mobile/reports/preferences`: explicit schedule/email edits. The handler reloads and preserves the current AI and alert preferences before calling the web preference validator and save action.

Both POST routes use the existing rate limit, bounded JSON body, no-store responses and second-factor checks. No privileged key is embedded in the app. PDF/CSV downloads continue to use fresh short-lived links on each tap. Report lists are scoped to the selected Space; the web's cross-Space history remains unchanged.

Native statements show compact summaries with expandable details and poll while queued documents prepare. The create flow separates editable criteria from an authoritative preview, then requires explicit Generate. Unknown opening/closing balances are shown as unavailable. Account/Space changes discard the old form and preview. Read requests have a 30-second network deadline; generation allows 75 seconds and retries use the same idempotency token.
