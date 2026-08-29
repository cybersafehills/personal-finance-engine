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
