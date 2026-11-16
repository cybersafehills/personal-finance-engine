# Manual verification guide — OneLedger 3.0 (PR stack #195, #196, #198, #199, #202, #204, #209, #211, #212, #213, #214, #215, #217, #221, +E7)

**Goal:** prove on a *throwaway* environment that what was built works with a real database, real login and real phones, **before any flag is turned on in production.** Nothing below touches production. Do it in order; tick each box; write down anything unexpected.

**Ground rules**
- 🚫 **Never run `supabase db push`, `functions deploy`, `set-eas-env.sh`, or `vercel deploy --prod` while linked to the production project** (ref `zttxsaiywkfrbdxgzbjd`). Before every Supabase command run `supabase projects list` and confirm the linked project is your **test** project.
- Use **synthetic data only** — invented names, numbers, tokens. Never put a real Cash Power token or real customer data in the test project.
- Test with **two separate accounts** (A and B) in different workspaces; most checks are about *not* leaking between them.

---
## Part 1 — Build the test environment (≈ 1–2 hours)

### 1.1 A test Supabase project
Option A (recommended, free): create a **new, empty Supabase project** named `oneledger-test` (dashboard → New project). Note its URL, anon key, service-role key, DB password and project ref.
Option B: a Supabase *branch* of production (requires the Pro plan; branches start empty of production data).

### 1.2 Get the code
```bash
git fetch origin
git checkout claude/oneledger-e7-utility-receipts   # top of the stack: contains everything below it
```
(The stack branches contain each other. If the PRs are already merged to `main`, use `main`.)

### 1.3 Apply the database
```bash
supabase link --project-ref <TEST_PROJECT_REF>     # confirm it is the TEST ref!
supabase db push                                   # applies every migration, incl. 20261223–20261228
```
Check: dashboard → Table editor shows `balance_observations`, `counterparties`, `counterparty_identifiers`, `counterparty_merge_events`, `counterparty_split_events`, `payment_requests`, `payment_request_events`, `transaction_sensitive_details`.
Also run the automated suite once more locally (needs PostgreSQL 17): `PG_BIN_DIR=/opt/homebrew/opt/postgresql@17/bin bash supabase/migrations/tests/run_migration_tests.sh` → expect **0 failed**.

### 1.4 Auth settings (test project)
Authentication → Providers → Email: **disable "Confirm email"** so test accounts work instantly (test project only). Create **user A** and **user B** later through the web sign-up.

### 1.5 The web app
Payment links must be **https**, and phones must reach the app, so use a **Vercel preview deployment** (not localhost):
1. In the Vercel project, add these **Preview-scoped** environment variables (never Production):
   `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` (test URL), `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (test keys), `SITE_URL` = the preview's https origin, plus the flags:
   ```
   MOBILE_API_ENABLED=true
   INSIGHTS_CENTER_ENABLED=true
   BALANCE_PROVENANCE_ENABLED=true
   COUNTERPARTIES_ENABLED=true
   PAYMENT_REQUESTS_ENABLED=true
   UTILITY_TOKEN_CAPTURE_ENABLED=true            # only for Part 6
   SENSITIVE_DATA_KEYRING=k1:<output of: openssl rand -base64 32>   # test key only
   ```
2. Deploy a **preview** (not production) from the checkout: `cd web && npx vercel deploy` (this repo deploys with the Vercel CLI; Git integration is off). Copy the preview URL into `SITE_URL`, then redeploy once.
3. Open the preview URL, sign up **user A**, then in a private window **user B**.

### 1.6 Edge Functions (only needed for Part 6 — token capture)
```bash
supabase functions deploy ingest-momo --project-ref <TEST_PROJECT_REF>
supabase secrets set UTILITY_TOKEN_CAPTURE_ENABLED=true SENSITIVE_DATA_KEYRING='k1:<same key as Vercel>' --project-ref <TEST_PROJECT_REF>
```

### 1.7 Seed synthetic data (as user A)
Create a few transactions so there is something to analyse: web → **Transactions → New** (manual entry) or import a small CSV statement. Make **at least**:
- 1 salary-like money-in (e.g. 500,000 RWF "Employer"),
- 3 payments to the *same phone number* with different labels ("Sam", "Samuel N", "S. Nshimiyimana"),
- 2 payments to a *name with no number* (e.g. "Alex Mugabo") from two different people if you can,
- 1 cash withdrawal, 1 refund, 1 payment to a merchant code,
- 2 transactions that are **transfers between your own wallets** — create a second account/wallet, then link them in **Transactions → Transfers**.
Keep a note of the totals you entered; you will compare them.

---
## Part 2 — Web checks (≈ 45 min)

| # | Do this | Expected |
|---|---|---|
| 2.1 | **Transfers excluded (#195):** compare Home "today", category totals, a generated daily report, and Budgets for the day with the linked transfer | Linked transfer legs are **not** counted as income or spending anywhere; all four surfaces agree |
| 2.2 | **Nav (#212):** with `PAYMENT_REQUESTS_ENABLED=true` open **More → Pay & Services** | "Payment requests" is listed. Remove the flag → entry disappears and `/pay/requests` shows "isn't available yet" |
| 2.3 | **Create a request (#204):** `/pay/requests/new` — 5,000 RWF, your own number, name, 7 days | A link + QR appear **once**. Reload the page → the link is **not** shown again. Copy the link |
| 2.4 | **Public page (#202):** open the link in a private window, **logged out** | Shows amount, name, number, "not verified by OneLedger". No workspace/owner info. Wrong/mistyped link → "not found" |
| 2.5 | **Tamper:** change one character of the token; open `http://` instead of `https://`; add `?x=1` | Not found / redirected; never shows a request |
| 2.6 | **Never falsely paid:** open the link repeatedly, refresh, share it | Status stays **Open**. Nothing marks it paid |
| 2.7 | **Link a payment:** add an incoming 5,000 RWF transaction, open the request | It appears under "Link the payment you received"; confirm → **Matched**. Try a 5,001 transaction → not offered |
| 2.8 | **Mark paid yourself / Cancel** on two other requests | "Marked paid by you" (explicitly unverified) / "Cancelled"; the public link then shows no number |
| 2.9 | **Expiry:** create a request, then in the SQL editor `update payment_requests set created_at=now()-interval '2 days', expires_at=now()-interval '1 hour' where id='<id>'` | Public page: "expired", no number |
| 2.10 | **Isolation:** as user B open `/pay/requests/<A's request id>` | Not found. B's list shows only B's requests |

## Part 3 — Mobile API checks (≈ 30 min, needs a terminal)
Get user A's access token (browser dev tools → Application → local storage `sb-…-auth-token` → `access_token`; **treat it like a password**, don't paste it anywhere shared).
```bash
B=https://<preview-origin>/api/mobile; T=<token>
curl -s -H "Authorization: Bearer $T" "$B/accounts"
curl -s -H "Authorization: Bearer $T" "$B/insights/overview?from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z&compare=previous"
curl -s -H "Authorization: Bearer $T" "$B/counterparties"
```
Expected: `ok:true`; amounts are **strings**; the Insights figures equal your hand totals from 1.7 (money in/out/net; transfers listed as *excluded*; cash withdrawal split out; refund not counted as income). Without the token → `401`. With a flag unset → `404 not_found`. Run the same with **user B's** token — B must never see A's rows.

## Part 4 — Android phone (≈ 1–2 hours)
The app has native modules, so it needs a **development/preview build** — Expo Go cannot run it.
1. **Create a test build profile** so the test build points at the *test* backend, not production. In `oneledger-mobile/eas.json` add (do not commit this change):
   ```json
   "test": { "extends": "preview", "env": {
       "EXPO_PUBLIC_API_BASE_URL": "https://<preview-origin>",
       "EXPO_PUBLIC_SUPABASE_URL": "https://<TEST_REF>.supabase.co",
       "EXPO_PUBLIC_SUPABASE_ANON_KEY": "<test anon key>" } }
   ```
   (The anon key is public by design. **Do not run `scripts/set-eas-env.sh`** — it copies production values.)
2. `cd oneledger-mobile && npx eas-cli build -p android --profile test` → install the APK from the link on the phone. (If the old OL Shortcuts companion is installed, uninstall it first — see `docs/mobile-release.md`.)
3. Sign in as user A. **More** now lists Insights, People and merchants, Payment requests, Wallets.

| # | Do this | Expected |
|---|---|---|
| 4.1 | **Insights:** switch This month / Last month / Last 30 days; pick a wallet | Numbers match the web; changing the wallet changes everything; "no earlier period" wording when there is none; own-wallet transfers noted as not counted |
| 4.2 | Tap **Money out**, a category, **cash withdrawals** | The list adds up to the number you tapped |
| 4.3 | **Wallets:** read each label; tap **I checked my balance**, enter a number | Label is **Estimated** (never Confirmed) after you type one; a wallet with no data says **Not available** with **no number** |
| 4.4 | **People:** search, filter, open the three "Sam" payments | One person (same number). The two same-name people appear as **one "matched by name only"** entry |
| 4.5 | **Separate** the second Alex's transactions into "Alex (Kigali)" | Two people now; **Undo** restores one |
| 4.6 | **Combine** two people; check **Insights** | Insights shows them merged under one name; **Undo** reverses it |
| 4.7 | **Payment request:** create one, **Share link** and scan the **QR** from another phone | Link opens the public page; QR scans to the same link; shown once only |
| 4.8 | Turn on airplane mode, open each new screen | A clear "couldn't load" message with **Try again**; no crash, no stale totals |
| 4.9 | Text size **Largest** + **TalkBack** on | Nothing clipped; every tappable row has a spoken label; chips announce "selected" |
| 4.10 | Rotate, background/foreground the app mid-load | No crash, no duplicate request created |

## Part 5 — iPhone
**A native iPhone build is blocked** until the Apple Developer Program membership is paid (`docs/mobile-release.md`). Until then you can still check layout and logic **in Safari on the iPhone** by serving the Expo web build over your Wi-Fi: `cd oneledger-mobile && EXPO_PUBLIC_API_BASE_URL=… EXPO_PUBLIC_SUPABASE_URL=… EXPO_PUBLIC_SUPABASE_ANON_KEY=… npx expo start --web`, then open the printed LAN address on the phone. This is **not** a substitute for a real iOS build (no native storage, push, or share sheet behaviour). Record "iOS native: not tested".

## Part 6 — Electricity tokens (only with **synthetic** messages)
See `docs/oneledger-3/e7-utility-receipts.md`: the real vendor SMS is a **separate message** and the capture of it is **not wired in yet**, so the end-to-end token flow cannot be exercised on real messages today. What you *can* check now:
- Post a synthetic MoMo SMS that contains `… to EUCL with token 0000-1111-2222-3333-4444 was completed …` to the test `ingest-momo`; the transaction's **name must be "EUCL" with no digits anywhere** (list, detail, export, PDF statement).
- In the SQL editor: `select * from transaction_sensitive_details;` shows **only ciphertext** (no digits resembling the token).
- On the transaction page click **Show token** → the token appears for ~30 s and hides; every click adds a row in `space_audit_events` (`transaction.sensitive_revealed`); as user B the same call is refused; the 21st reveal in an hour is refused.

## Part 7 — Erasure and export
As a disposable user C: create a counterparty, a balance statement and a **matched** payment request, then in the SQL editor `select public.execute_account_deletion('<C id>')` (service role). Expected: succeeds; C's rows in all 3.0 tables are gone; other users' data untouched. As user A, **Settings → Privacy → Export my data** → the JSON includes `counterparties`, `balanceObservations`, `paymentRequests` (and **no** token hash).

---
## Sign-off checklist (all must be true before any production flag)
- [ ] Part 1.3 migration suite: 0 failed; test project has all new tables
- [ ] 2.1 own-wallet transfers excluded and surfaces agree
- [ ] 2.4–2.6 public page shows the minimum and can never show "paid"; 2.10 isolation holds
- [ ] Part 3 numbers match hand totals; user B sees nothing of A
- [ ] 4.x pass on **at least one Android phone** (iPhone web-only noted as such)
- [ ] 6 token never appears in any display field; reveal is audited and limited
- [ ] 7 erasure works; export contains the new data
- [ ] Rwandan data-protection / payments review done (counsel) before enabling Payment requests beyond your own account
- [ ] Key backup decided (`SENSITIVE_DATA_KEYRING`), and the decisions in E5/E7 made
**Then** enable in production **one flag at a time**, with `*_WORKSPACE_ALLOWLIST` set to your own workspace first, watching errors for a day before widening.

## Cleanup
Delete the test Supabase project (or branch), the Vercel preview and its Preview env vars, and the test APK; revoke any access token you copied.
