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

## Rollout

1. Deploy web with the route (dark).
2. Set `MOBILE_API_ENABLED=true` in Vercel production, redeploy.
3. Point the app's `EXPO_PUBLIC_API_BASE_URL` at the production origin.

## Not yet covered

Sign-up, password reset and MFA enrolment stay on the web for now; the app
links out to them.
