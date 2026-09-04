# Email deliverability

Transactional email has two senders, both Resend:

| Path | Sender | Config |
|---|---|---|
| Signup confirmation, password reset | **Supabase Auth SMTP** | `supabase/config.toml` `[auth.email.smtp]` — `pass = env(RESEND_API_KEY)`, `admin_email = env(RESEND_FROM_EMAIL)` |
| Invites, sign-in / lockout notices, daily report | **`web/lib/emails.ts`** via `web/lib/resend.ts` | `RESEND_API_KEY`, `RESEND_FROM_EMAIL`; links use `SITE_URL` (`web/lib/site-url.ts`) |

Both fail **silently** for real recipients if the sender domain isn't
verified, or if `RESEND_FROM_EMAIL` is still a `resend.dev` sandbox
address (which only delivers to your own Resend account email).

## Production checklist

1. **Verify a domain in Resend** (e.g. `oneledger.me`) — add the DKIM /
   SPF / return-path DNS records Resend gives you and wait for
   `status: verified`.
2. Set **`RESEND_FROM_EMAIL`** to an address on that domain
   (`notifications@oneledger.me`), in Vercel **and** as a Supabase
   project secret (`supabase secrets set RESEND_FROM_EMAIL=…`) so
   `[auth.email.smtp]` picks it up.
3. Set **`RESEND_API_KEY`** in both places.
4. Set **`SITE_URL`** to the real apex/`www` origin — never a raw Vercel
   deployment URL, never `localhost`. Every emailed link is built from it.
5. Confirm `supabase/config.toml` `[auth.email.smtp] enabled = true` and
   that `site_url` / `additional_redirect_urls` list the real domain's
   `/auth/callback` **and** `/auth/confirm`.
6. Note the Supabase Auth rate limit: `[auth.rate_limit] email_sent = 30`
   per hour once custom SMTP is on.
7. **Manual, one-time, dashboard-only step** (this repo's CI only runs
   `supabase db push` — `config.toml`'s `[auth]` section, including email
   templates, is never synced to the hosted project automatically): in
   Authentication → Email Templates → "Confirm signup", replace the body
   with `supabase/templates/confirmation.html`'s content (link built from
   `{{ .TokenHash }}`, pointing at `/auth/confirm?token_hash=...&type=email`,
   not the default `{{ .ConfirmationURL }}`). See the comment on
   `[auth.email.template.confirmation]` in `supabase/config.toml` for why:
   the default link is a bare GET that some corporate mail-security
   scanners prefetch and spend before the recipient ever clicks it, which
   is what a "that link is no longer available" report on an otherwise
   fresh signup usually means. Also add `https://www.oneledger.me/auth/confirm`
   (and the apex/Vercel-fallback equivalents) to the redirect allow-list
   there, matching `additional_redirect_urls` above.

## Verifying it

`GET /api/health/email` (operator-only, `X-Report-Cron-Secret` header,
same gate as the cron routes) runs the check live: env shape **plus** a
Resend lookup of the sending domain's `verified` status. It returns
**200** with the report when clean, **503** when there's an error-level
issue — so a monitor or CI step can `curl --fail` it against a deployed
environment. The body never contains a key value.

```bash
curl --fail -H "X-Report-Cron-Secret: $REPORT_CRON_SECRET" \
  https://www.oneledger.me/api/health/email
```

The pure env-shape rules (`web/lib/email-health-rules.ts`) are unit-tested
(`email-health-rules_test.ts`).

## Send logging

`web/lib/emails.ts` emits one line per attempt:

```
[email-send] outcome=sent domain=oneledger.me subject="You've been invited to …" messageId=…
[email-send] outcome=failed domain=example.com subject="…" code=…
[email-send] outcome=skipped domain=… subject="…" code=missing_from
```

Recipient **domain only** — never the full address. `outcome=skipped`
means the provider isn't configured; `failed` carries the Resend error
name.

### `email_send_log`

The same attempts are also written to `public.email_send_log`
(`20261007000000_email_send_log.sql`) via `web/lib/email-log.ts` —
best-effort, never blocking a send. The row holds `outcome`, `category`
(`invite` / `sign_in` / `lockout` / `daily_report` / `other`),
`recipient_domain`, an optional `workspace_id`, and the provider message
id or error code. **No address, subject, or body.** The table is
`service_role`-only (RLS on, zero `authenticated`/`anon` policies).

Read it with the operator route (same `X-Report-Cron-Secret` gate):

```bash
curl -H "X-Report-Cron-Secret: $REPORT_CRON_SECRET" \
  "https://www.oneledger.me/api/admin/email-log?outcome=failed&limit=50"
```

## Local dev

`supabase/config.toml` `[local_smtp] enabled = true` runs an inbucket
mail catcher — open `http://127.0.0.1:54324` to read anything the local
stack "sent" (signup confirmations included). Real Resend is never hit
locally unless you set a real `RESEND_API_KEY` in `web/.env.local`.
