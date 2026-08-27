# Application shell: production rollout & post-deployment smoke tests

Copy-pasteable checklist to take the shell/navigation/dashboard-privacy
modernization (PR #12) from "merged to `main`" to "verified working
end-to-end in production." Written the same way as `docs/reporting-
verification-runbook.md` and for the same reason: this session has no
live Vercel/production-browser session to run these checks itself - you
run this, in order, and stop at the first unexpected result.

Nothing here is destructive. No step deletes or mutates real financial
data; the checks that write anything only ever touch your own
`ui_preferences` row (nav order, balance/privacy toggles), which is
freely reversible from Settings at any time.

## 0. Before you merge

- [ ] CI is green on the PR: Deno quality, migration/RLS tests, and the
  e2e/accessibility/visual-regression suite (all three run in
  `ci.yml`'s `deno-quality`/`migration-tests`/`e2e-tests` jobs).
- [ ] `npx tsc --noEmit -p tsconfig.json`, `npm run lint`, and
  `npm run build` (from `web/`) are clean.

## 1. Migration order and state - already applied, out of band

Unlike the reporting engine's rollout, **both of this feature's
migrations are already applied to the linked production project** -
`20260904000000_phase_l_ui_preferences.sql` and
`20260905000000_phase_l_grant_is_valid_nav_order_execute.sql` were pushed
directly (with explicit approval) during development, to unblock e2e
testing against a real Supabase Auth/PostgREST stack. This is a
deliberate deviation from this repo's normal flow (`deploy-supabase.yml`
runs `supabase db push` automatically after CI passes on `main`) - not a
problem for merging: `supabase db push` tracks applied migrations by
version in its own history table, so when `deploy-supabase.yml` runs
after this PR merges, it will find both versions already recorded and
skip them - a safe no-op, not a re-application.

- [ ] Confirm both migrations show as applied: `supabase migration list`
  (or in the SQL editor,
  `select version from supabase_migrations.schema_migrations where version in ('20260904000000','20260905000000');`
  - expect both rows).
- [ ] Confirm the grant fix actually landed (this is the one that matters
  most - see "Incidents" in `docs/application-shell.md`):
  ```sql
  select grantee, privilege_type from information_schema.role_routine_grants
  where routine_name = 'is_valid_nav_order';
  -- expect authenticated and service_role rows with EXECUTE
  ```

## 2. Backend/frontend compatibility

- [ ] No new required environment variables - this feature reuses
  `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`/
  `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, all already configured in
  Vercel for existing features. Confirm Vercel's production env still
  has these set (Project Settings → Environment Variables) - nothing to
  add.
- [ ] Because the migration is already live and the frontend deploy
  happens separately (Vercel's own git integration, not gated by
  `deploy-supabase.yml`), there is no ordering risk here in either
  direction - the schema already supports the new frontend code, and the
  old frontend code (pre-merge) never referenced `ui_preferences` at all,
  so it was never broken by the schema existing early.

## 3. Users with invalid or missing preferences

- [ ] Sign in as an **existing** user who predates this feature (never
  had a `ui_preferences` row). Confirm the Home dashboard, header, and
  bottom nav all render normally with the default nav order
  (Transactions, Categories, Budgets, Settings) and balance visible
  (unmasked) - `getUiPreferences()`'s safe-default fallback, not an
  error state.
- [ ] In the SQL editor, temporarily corrupt a test row's `nav_order` to
  confirm the CHECK constraint still rejects invalid values server-side
  (defense in depth, independent of the client's own validation):
  ```sql
  update public.ui_preferences set nav_order = array['transactions','transactions','budgets','settings']
  where user_id = '<your test user id>';
  -- expect: ERROR - violates check constraint "ui_preferences_nav_order_shape"
  ```

## 4. Deep links and caching

- [ ] Confirm existing deep links still resolve: `/reports`,
  `/reports/<id>`, `/transactions/<id>`, `/settings/reports`,
  `/settings/security`, `/settings/workspace` - none of these routes
  moved or were renamed by this work.
- [ ] Confirm `/settings/appearance` and `/settings/privacy` (new routes)
  are reachable both directly by URL and via the Settings index/profile
  menu links.
- [ ] A saved nav-order/privacy change reflects immediately on the *same*
  device without a manual hard-refresh (`revalidatePath("/", "layout")`
  triggers this) - no separate cache-invalidation step needed.
- [ ] A client that loaded the app *before* this deploy and is still open
  in a browser tab: reloading (or navigating) picks up the new bundle
  normally, per Next.js's standard build-manifest behavior - this
  feature introduces no custom caching that changes that story either
  way.

## 5. Post-deployment smoke tests

- [ ] **Authentication** - sign in, confirm the shell (header, nav)
  appears only once signed in, not on `/login`/`/signup`.
- [ ] **Dashboard loading** - Home renders balance, today's totals, and
  (if applicable) budget-status/attention-items cards with real data.
- [ ] **Mobile and desktop navigation** - exactly 5 destinations, Home
  first, Reports absent, correct active-route highlighting on both the
  header nav (desktop) and bottom nav (mobile viewport or resized
  window).
- [ ] **Reports** - opens from the header's document icon, and from the
  "Reports" entry in Settings (distinct from "Daily reports").
- [ ] **Profile menu** - opens, shows your email, Escape closes it and
  returns focus to the trigger, clicking outside closes it too.
- [ ] **Navigation reordering** - Settings → Appearance and navigation:
  move an item, save, confirm the header/bottom nav reflect the new
  order immediately, sign out and back in, confirm it persisted.
- [ ] **Balance masking and first-paint privacy** - toggle the balance
  eye icon, reload the page, confirm the masked state is what you see
  immediately (no flash of the real number first).
- [ ] **Full privacy mode** - Settings → Privacy and security: enable it,
  confirm the balance, today's totals, and dashboard transaction preview
  all mask; confirm the balance eye toggle is now disabled with an
  accessible label explaining why.
- [ ] **Transactions, Categories, Budgets, Settings** - each still loads
  and functions normally (none of this feature touches their own logic).
- [ ] **Sign out and sign back in** - confirm nav order and privacy
  preferences are exactly as you left them.

## 6. Rollback strategy

No feature flag exists to flip (see `docs/application-shell.md`'s
"Feature flags and rollout" section for why). If something is
seriously wrong after deploy:

- **Frontend**: redeploy the prior Vercel production build (Vercel
  dashboard → Deployments → previous deployment → "Promote to
  Production"), or `git revert` the merge commit and push - either
  restores the old shell immediately.
- **Database**: both migrations are purely additive (`ui_preferences` is
  a new table nothing else depends on; the grant fix only adds a
  privilege). No down-migration exists, matching this repo's
  forward-only migration convention - the safe rollback is leaving the
  schema in place (it's inert without the new frontend code referencing
  it) rather than dropping it under a live database.

## 7. Monitoring after deploy

No dashboard/alerting exists for this (see `docs/application-shell.md`'s
"Analytics and monitoring" section) - manually check Vercel's function
logs in the hours after deploy for:

- [ ] `upsertUiPreferences (appearance) failed:` / `upsertUiPreferences
  (privacy) failed:` - would indicate the grant fix didn't take, or a
  new RLS/constraint regression.
- [ ] `getUiPreferences failed:` - would indicate a read-path regression.
- [ ] `Unhandled application-shell error:` - the new root-layout error
  boundary (`app/global-error.tsx`) firing at all means a real bug in
  the shell reached production; it should never fire in normal use.
