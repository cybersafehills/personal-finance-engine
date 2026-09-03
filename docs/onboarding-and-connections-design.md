# User onboarding & MoMo connection linking — design notes

Rolling design record for the work that makes the path from *"I just
signed up"* to *"my MoMo transactions are flowing in"* walkable by a
non-technical user. One section per phased PR. Task brief lives outside
the repo; the acceptance criteria it sets are restated per section.

Related: `docs/momo-ingest-contract.md` (the request contract),
`docs/application-shell.md` (the stale-connection nudge),
`docs/adr/0001-non-custodial-boundary.md`.

---

## PR1 — Ingest contract truth + surfacing it in the Connections UI

**Problem.** The one-time secret reveal showed only the key. A user could
not configure a Shortcut without also knowing the endpoint URL, method,
auth header, and JSON body — none of which appeared anywhere in the app.
Separately, `supabase/config.toml` had no `[functions.ingest-momo]` block,
so the repo did not record that the function runs with JWT verification
off.

**Decisions.**

1. **`verify_jwt = false` is now explicit** in `supabase/config.toml`
   (`[functions.ingest-momo]`), matching the already-deployed state. The
   key-only contract — `x-ingest-key`, no `apikey`/JWT — is confirmed and
   written down in `docs/momo-ingest-contract.md`.

2. **One module owns the endpoint string.** `web/lib/ingest.ts` exports
   `buildIngestEndpointUrl(base)` (pure, env-free, Deno-tested in
   `ingest_test.ts`) plus the contract constants (`INGEST_REQUEST`,
   `INGEST_BODY_EXAMPLE`, `INGEST_RESPONSE_HELP`). The `/functions/v1/…`
   path appears **only** here.

3. **Endpoint URL is resolved server-side, once.**
   `app/integrations/connections/page.tsx` builds it from
   `SUPABASE_URL ?? NEXT_PUBLIC_SUPABASE_URL` and passes it as a prop to
   `ConnectionItem` and `CreateConnectionForm`. No client component reads
   env; no dependency on `NEXT_PUBLIC_*` being set (it frequently isn't in
   this repo's `.env.local.example`). `null` renders an explicit
   "not available in this environment" state, never a broken URL.

4. **`ConnectionDetails` is shown on every connection**, not just at
   creation — a collapsible `<details>` panel (open by default only while
   the connection has never received anything). It carries the copyable
   endpoint URL, the request spec, the JSON body template, and a short
   "what to expect" list (`{"ok":true}` / `401` / `422`). It never renders
   the credential — only notes that the key starts `pfe_` and is shown in
   full solely at create/rotate time.

5. **The one-time reveal now finishes the job.**
   `ShortcutKeyInstructions` (same file) replaces the old
   header-only blurb inside `RevealedSecret` on both call sites, adding
   the endpoint URL and body shape so a Shortcut can be wired without
   leaving the page.

**Data model / flags.** None. No migration, no new feature flag (this is
corrective surfacing of an existing capability). `SCAN_TO_PAY`-style
gating is not warranted.

**Not in this PR.** The step-by-step Shortcut build guide (PR2), the
"Test this connection" live-verification action (PR3), the onboarding
checklist (PR4).

**Manual verification.**

- Settings → Connections → *Connect a device* → create: the reveal now
  shows endpoint + `x-ingest-key` + body; the row's *Connection details*
  panel shows the same, open by default.
- A connection that has ingested before shows the panel collapsed.
- With `SUPABASE_URL` unset at build, the panel shows the "not available"
  state and the app still renders.
- `deno test web/lib/ingest_test.ts` passes; `npm run lint`,
  `npx tsc --noEmit`, `npm run build` clean.

---

## PR2 — iPhone Shortcut build guide

**Problem.** Every instruction assumed the user already had a MoMo
forwarding Shortcut. There was no guide to building one, and no repo can
produce a signed `.shortcut` / iCloud link.

**Decisions.**

1. **One canonical source: `web/lib/shortcut-guide.ts`.** A pure,
   env-free, Deno-tested module exporting `shortcutGuideSteps({
   endpointUrl, mtnSender })` (ordered steps, each with plain-text body
   and optional copyable field values) and `SHORTCUT_TROUBLESHOOTING`
   (rows whose optional `responseKey` must exist in `INGEST_RESPONSE_HELP`
   — a test enforces this, tying the guide to PR1's contract module).

2. **In-app guide at `/integrations/connections/setup`.** Server component
   resolves the endpoint URL (same as the Connections page) and passes
   the built steps to `ShortcutGuide` (presentation only, reuses
   `CopyField` from `ConnectionDetails`). Linked from the Connections page
   header, the `ConnectionDetails` panel, and the one-time reveal.

3. **`docs/momo-shortcut-setup.md`** mirrors the steps for offline
   reading with an explicit "change the module, keep this in step" note.
   The cURL example is not duplicated — it points at
   `docs/momo-ingest-contract.md`.

4. **Two optional env vars, guide renders fine without either.**
   `MOMO_SMS_SENDER` (server) fills the real MoMo SMS sender into Step 2;
   until set, the guide shows `<MTN sender - confirm on device>` and a
   caveat box. `NEXT_PUBLIC_MOMO_SHORTCUT_URL` (browser) shows a "Get the
   ready-made Shortcut" button when a signed link exists.

**Data model / flags.** None. New route is not gated — it is static help
content with no side effects.

**Open item.** The real MTN Rwanda MoMo SMS sender ID is still
unconfirmed (placeholder + `MOMO_SMS_SENDER` override in place).

**Manual verification.**

- `/integrations/connections/setup` renders 7 steps + troubleshooting table;
  Step 3 shows the resolved endpoint URL with a copy button.
- With `MOMO_SMS_SENDER` unset: placeholder + caveat box shown. With it
  set: real sender in Step 2, no caveat.
- With `NEXT_PUBLIC_MOMO_SHORTCUT_URL` unset: no button. Set: button links
  out with `rel="noopener noreferrer"`.
- `deno test web/lib/shortcut-guide_test.ts` passes; lint / tsc / build
  clean.

---

## PR3 — "Is it working yet?" — readiness probe, not a synthetic send

**Problem.** A user who has just built the Shortcut has no feedback loop:
did it work? The brief's first choice was a "Test this connection" button
that POSTs a canned SMS to the live endpoint.

**Decision: live-poll, no synthetic send.** The brief sanctioned this
fallback, and here it is the *right* call, not just the easy one:

- `ingest-momo` accepts only `{ message, received_at }` — no test-message
  passthrough. Any synthetic POST that parses would create a **real
  ledger transaction**; one that doesn't parse lands in the **review
  queue**. Both pollute. Keeping them out needs an Edge Function change +
  deploy, which is out of scope for a web PR (and `main` CI is currently
  red, so functions don't deploy anyway).
- A synthetic POST also bypasses the user's Shortcut entirely, so it
  proves almost nothing about *their* setup.

**Implementation.**

- `probeConnectionReadiness(connectionId)` — read-only server action,
  returns `{ status, lastUsedAt }` (RLS-scoped). No writes, no
  `revalidatePath`.
- `ConnectionReadinessProbe` — client component rendered by
  `ConnectionItem` only while a connection is `active` with
  `last_used_at === null`. Polls every 5s, gives up after 3 min. On the
  first real message it flips to a success line and calls
  `router.refresh()` so the row re-renders as "Ready".
- Complements the existing `LiveDataSync` realtime refresh (which covers
  `transactions` but not `ingestion_connections`), so a `needs_review`
  first message still flips the UI.

**Data model / flags.** None.

**Manual verification.**

- Create a connection → the row shows "Waiting for the first forwarded
  message…" with a pulsing dot.
- Send a real MoMo SMS through a wired Shortcut → within ~5s the line
  becomes "First message received — this connection is live." and the
  badge turns "Ready".
- Leave it 3 min with nothing → it degrades to the "No message yet"
  hint linking the setup guide.
- lint / tsc / build clean.

---

## PR4 — Guided onboarding checklist

**Problem.** Signup → add account → connect device → build Shortcut →
verify was spread across four unrelated screens with nothing tying them
together.

**Decisions.**

1. **`web/lib/onboarding.ts`** — pure, Deno-tested `deriveOnboardingState`
   over four independent signals (email confirmed, account count, active
   connection count, live connection count). Four steps, stable order,
   each carrying its own CTA target. Step completion is **always derived
   live**, never stored.

2. **`getOnboardingState()` in `queries.ts`** — gathers the signals
   (`getUser().email_confirmed_at`, `accounts`, `ingestion_connections`)
   plus the stored dismissal, applies the feature gate, and returns an
   `OnboardingSnapshot` (`{ ...state, enabled, dismissed, showNudge }`).
   `showNudge = enabled && !dismissed && !complete`.

3. **Only the dismissal is persisted.** New column
   `ui_preferences.onboarding_dismissed` (migration
   `20261006000000_…`) — same shape/purpose as the existing
   `reports_relocation_notice_dismissed`, per `(workspace_id, user_id)`.
   The two existing `upsertUiPreferences` read-then-merge helpers
   (appearance, privacy) were updated to carry the new column through, so
   saving nav order / a privacy toggle can't reset it.

4. **Two surfaces.** `OnboardingCard` — compact dashboard nudge (progress
   bar, single next action, "See all steps", "Dismiss"), rendered on
   `web/app/page.tsx` only while `showNudge`. `/get-started` — the full
   walkthrough (server route); every step shows done/undone with a CTA;
   "Hide this checklist" at the bottom.

5. **Post-signup redirect.** `/auth/callback` sends a first-run user (no
   `next`, or `next === "/"`) to `/get-started`. Links that carry a real
   `next` (password reset, `/invite/<token>`) are followed verbatim.
   `/get-started` `redirect("/")`s when the flag is off, so the callback
   redirect is always safe — no 404 path.

6. **Flag:** `ONBOARDING_CHECKLIST_ENABLED` (on unless `"false"`) +
   `ONBOARDING_CHECKLIST_WORKSPACE_ALLOWLIST`, same convention as the Pay
   flags. Off ⇒ no nudge, `/get-started` redirects to the dashboard.

**Invitee note (PR6 will refine).** An invitee joining a Space that
already has accounts still sees "Add a financial account" as undone. PR6
decides whether members skip that step; for now the derive is
workspace-scoped and uniform.

**Manual verification.**

- Fresh user → dashboard shows "Finish setting up 1/4" (email confirmed
  only); `/get-started` lists 4 steps, step 1 ✓.
- Add an account → 2/4; create a connection → 3/4; first real forwarded
  SMS → 4/4, nudge disappears, `/get-started` shows "You're all set".
- "Dismiss" / "Hide this checklist" → nudge gone on reload, steps still
  reachable at `/get-started`. Changing nav order afterwards does not
  bring the nudge back.
- `ONBOARDING_CHECKLIST_ENABLED=false` → no nudge; `/get-started` →
  dashboard.
- `deno test web/lib/onboarding_test.ts`, lint, tsc, build all clean.

---

## PR5 — Email deliverability hardening

**Problem.** Signup confirmation (Supabase Auth SMTP) and invites /
notices / reports (`lib/emails.ts`) both go through Resend and both fail
**silently** for real recipients when the sender domain isn't verified or
`RESEND_FROM_EMAIL` is still a `resend.dev` sandbox address.

**Findings.** `lib/emails.ts` `send()` already returned a typed
`{ providerMessageId | errorCode }`, and `createInvite` already returns
`emailSent` which `CreateInviteForm` already renders ("We couldn't send
this by email — share it yourself."). So the invite-UX item was largely
done; the gaps were a *health check* and *observable send logging*.

**Decisions.**

1. **`web/lib/email-health-rules.ts`** — pure, import-free, Deno-tested
   `classifyEmailEnv({ RESEND_API_KEY, RESEND_FROM_EMAIL, SITE_URL,
   isProduction })` → typed `error` / `warn` issues (missing key/from/url,
   odd key shape, sandbox sender, relative or localhost-in-prod URL).
2. **`web/lib/email-health.ts`** — `checkEmailConfig()` layers a live
   Resend `domains.list()` lookup on top: a real sending domain that
   isn't in the account, or isn't `verified`, is an error.
3. **`GET /api/health/email`** — operator-only (`X-Report-Cron-Secret`,
   the existing cron gate). 200 when clean, **503** when any error-level
   issue, so a monitor / CI `curl --fail` catches a broken setup against
   a deployed environment. Body carries no key values.
4. **Send logging.** `send()` now emits one redacted structured line per
   attempt — `[email-send] outcome=sent|skipped|failed domain=<recipient
   domain only> subject=… messageId=…|code=…`. A failed invite /
   confirmation is no longer invisible.
5. **`docs/email-deliverability.md`** — the production checklist (verify
   domain, set the pair in Vercel *and* as Supabase secrets, real
   `SITE_URL`, the rate limit) and the local inbucket note.

**Not done / deferred.** No `email_send_log` table (structured logs
answer "was it sent?"; a per-recipient history table needs an admin
viewer — a separate effort). No new e2e: the suite doesn't currently
exercise the signup-email flow, and standing that up against inbucket is
its own task — noted for later.

_Both follow-ups landed in PR7 below._

**Manual verification.**

- `GET /api/health/email` with the cron secret: 200 + `ok:true` on a
  configured env; drop `RESEND_FROM_EMAIL` → 503 + a `missing_from`
  error issue.
- Create an invite with no `RESEND_API_KEY` → the form shows "couldn't
  send", and a `[email-send] outcome=skipped … code=missing_api_key`
  line is logged.
- `deno test web/lib/email-health-rules_test.ts`, lint, tsc, build clean.

---

## PR6 — Invite flow polish for households

**Audit (the RPC layer is sound).**
`supabase/migrations/20260827000000_organization_workspaces.sql`:

- **Expiry** — `accept_workspace_invite` and `invite_preview` both filter
  `status = 'pending' AND expires_at > now()`. The `'expired'` status
  value is never written (no cron), but a past-expiry `pending` row is
  already treated as invalid everywhere. ✓
- **Single-use** — accept flips `status = 'accepted'`; the
  `where status = 'pending'` guard fails a second attempt. ✓
- **Role** — taken from the invite row; the table CHECK forbids `owner`. ✓
- **Email match** — *deliberately none* (token-only bearer model,
  documented in the migration header). "Invite to an address that already
  has an account" / "accepted while logged in as someone else" ⇒ whoever
  holds the link and is authenticated joins. `CreateInviteForm` already
  says exactly this ("Anyone with this link can join…"). Left as-is.
- **Already a member** — `accept` does `ON CONFLICT (workspace_id,
  user_id) DO UPDATE`, re-activating and setting the invite's role.
  Low-risk (owner-issued); noted, not changed.
- **Workspace deleted before acceptance** — `workspace_id … on delete
  cascade` removes the invite row ⇒ `invite_preview` returns nothing ⇒
  the page 404s. ✓

**Changes (the gaps were small).**

1. **Resend.** `InviteItem` had only Revoke. The plaintext token was
   never stored, so `resendInvite(inviteId)` **rotates** it: new
   `token_hash`/`token_prefix`, expiry restarted, email re-sent, fresh
   link shown once via `RevealedSecret`. The old link dies immediately.
   `.eq("status","pending")` refuses to revive a revoked/accepted invite;
   RLS confines it to owned workspaces.
2. **"Expired" label.** `getWorkspaceInvites` now returns a
   server-evaluated `expired` boolean; `InviteItem` shows "expired" and
   relabels Resend → "Send a new link".
3. **Inviter named in the email.** `sendInviteEmail` takes an optional
   `invitedByEmail`; `createInvite` / `resendInvite` pass the caller's
   address. Links already used `siteUrl()` and stated the role.
4. **Invitee-scoped onboarding.** `getOnboardingState()` now reads the
   workspace kind + role: an **organization** `member`/`viewer` (shared
   ledger, nothing of their own to set up) gets the checklist **disabled**
   — no nudge, `/get-started` forwards to the dashboard. **Household**
   members, **personal** workspaces, and org **owners/admins** keep the
   full checklist. `acceptInvite` now redirects to `/get-started` (which
   self-forwards for the disabled case) instead of `/`.

**Decision to confirm with the maintainer.** The rule in (4) — org
member/viewer sees no checklist, household member sees the full one — is a
judgement call. If household members should also skip "Add a financial
account" (because they may already have one from personal signup), the
derive already reflects that: the step shows done when `accountCount > 0`.

**Manual verification.**

- `/settings/workspace` on a household you own: a pending invite shows
  Resend + Revoke; Resend produces a new one-time link and a "previous
  link no longer works" note; an expired invite shows "expired" +
  "Send a new link".
- Invite email names the inviter and the role, links to the real domain.
- Accept an org `member` invite → land on the dashboard (no checklist).
  Accept a household invite → `/get-started` with the checklist.
- e2e: `spaces-household.spec.ts` "household invites: create, then
  rotate the link with Resend".
- lint, tsc, build, `deno test web/lib` all clean.

---

## PR7 — `email_send_log` (PR5 follow-up)

**Why.** PR5 deferred a table ("structured logs cover 'was it sent?'"),
but a log line rolls off; a persisted, queryable trail of *failed*
invites / confirmations is worth the small table.

**Changes.**

1. **Migration `20261007000000_email_send_log.sql`** — `outcome` /
   `category` / `recipient_domain` / nullable `workspace_id` /
   `provider_message_id` / `error_code`. **No address, subject, or body.**
   RLS on with **zero** `authenticated`/`anon` policies; `service_role`
   gets `select, insert`. Two indexes (`created_at`, `outcome,created_at`).
2. **`web/lib/email-log.ts`** — `recordEmailSend()`, a lazy service-role
   client built the `resend.ts` way (no import-time throw, since
   `emails.ts` is on the login path). Fully best-effort: a missing key or
   an insert error is swallowed.
3. **`lib/emails.ts` `send()`** — new optional `meta: { category,
   workspaceId }`; each exit path fire-and-forgets a `recordEmailSend`
   alongside the existing `[email-send]` log line. The four wrappers pass
   their category; invite + daily-report also thread `workspaceId`
   (`createInvite` / `resendInvite` / `report-delivery.ts`).
4. **`GET /api/admin/email-log`** — operator route, same
   `X-Report-Cron-Secret` gate as `/api/health/email`. `?limit=` (1–200,
   default 50) and `?outcome=sent|skipped|failed`.

**Also in PR7: signup-email e2e.** `web/e2e/signup-email.spec.ts` — runs
unauthenticated (overrides the project storageState; the proxy bounces a
signed-in user off `/signup`), signs up a throwaway user through the real
form, polls the local mail catcher (Mailpit JSON API on
`[local_smtp] port` 54324) for the confirmation email, follows its link,
and asserts the redirect lands on `/get-started`. `afterEach` deletes the
user. CI-only (needs the local stack).

**Manual verification.**

- Create an invite with a working Resend config → a `sent` row with
  `category=invite` and the workspace id; unset `RESEND_API_KEY` → a
  `skipped` row with `error_code=missing_api_key`.
- `GET /api/admin/email-log?outcome=failed` with the cron secret returns
  `{ count, rows }`; without it, 401.
- tsc, build, eslint, `deno test web/lib` clean.
