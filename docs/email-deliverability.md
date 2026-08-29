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
   `/auth/callback`.
6. Note the Supabase Auth rate limit: `[auth.rate_limit] email_sent = 30`
   per hour once custom SMTP is on.

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
name. There is no `email_send_log` table yet; if per-recipient delivery
history is needed later, add one behind an admin viewer (out of scope
here — structured logs cover the "was it sent?" question).

## Local dev

`supabase/config.toml` `[local_smtp] enabled = true` runs an inbucket
mail catcher — open `http://127.0.0.1:54324` to read anything the local
stack "sent" (signup confirmations included). Real Resend is never hit
locally unless you set a real `RESEND_API_KEY` in `web/.env.local`.
