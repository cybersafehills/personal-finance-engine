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
   `app/settings/connections/page.tsx` builds it from
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

2. **In-app guide at `/settings/connections/setup`.** Server component
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

- `/settings/connections/setup` renders 7 steps + troubleshooting table;
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
