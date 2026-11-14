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

## Rollout

1. Deploy web with the route (dark).
2. Set `MOBILE_API_ENABLED=true` in Vercel production, redeploy.
3. Point the app's `EXPO_PUBLIC_API_BASE_URL` at the production origin.

## Not yet covered

Sign-up, password reset and MFA enrolment stay on the web for now; the app
links out to them.
