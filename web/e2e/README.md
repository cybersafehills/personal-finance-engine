# e2e / visual-regression suite

Playwright suite covering the application-shell/navigation/dashboard-privacy
modernization: the unified header, the 5-item primary nav (Reports removed),
user-configurable nav ordering, and balance/dashboard privacy mode. See
`docs/application-shell.md` for what the feature actually does and why -
this file is about running and maintaining the test suite itself.

## What it never does

Like `supabase/migrations/tests/run_migration_tests.sh`, this suite is built
around one hard rule: **it never touches the linked production Supabase
project.** `e2e/production-guard.ts` refuses to run if the resolved Supabase
URL looks production-shaped in any way, regardless of what env vars happen to
be set. The suite only ever creates its one throwaway test user
(`e2e/test-users.ts`) against a disposable local Supabase stack started fresh
by `supabase start`.

## Running locally

```bash
supabase start
cd web
npm run test:e2e
```

`e2e/auth.setup.ts` resolves the local stack's URL/service-role key via
`supabase status --output json` automatically - no env vars needed for a
normal local run. It creates (or reuses) the seeded test user directly via
the Supabase Admin API, bypassing the real email-confirmation flow (this is
test setup with privileged access, not a re-verification of signup itself),
then logs in through the actual `/login` UI so every dependent test exercises
a real session, not a fabricated cookie.

Two projects don't need any of that: `setup` (the step above) and
`unauthenticated` (login/signup page checks) - the latter can run standalone
against nothing but a built Next.js server, which is what CI's PR-gating job
actually exercises today (see below).

## Updating visual-regression baselines

Playwright snapshot filenames are automatically platform-suffixed
(`-darwin`, `-linux`, ...), so macOS and Linux baselines coexist in the same
`*-snapshots/` directories without conflicting. Both are committed today -
macOS from local development, Linux (what CI actually compares against) from
a run of `.github/workflows/generate-e2e-baselines.yml`.

To regenerate baselines after an intentional visual change, dispatch that
workflow (Actions tab → "Generate e2e visual-regression baselines" → Run
workflow), download the `e2e-visual-baselines-linux` artifact it produces,
and commit the updated `*-linux.png` files - or do the equivalent locally on
Linux/in a container with Docker + the Supabase CLI:

```bash
supabase start
cd web
npm run test:e2e:update-snapshots
git add e2e/**/*-snapshots/*-linux.png
git commit -m "test: update Linux e2e visual-regression baselines"
```

CI's required gate (`ci.yml`) runs the full suite, including `@visual`,
against the committed Linux baselines - a real, intentional visual
difference fails the build like any other regression test.

## Layout

- `production-guard.ts` - the hard safety gate described above.
- `test-users.ts` - the one fixed, disposable test-user identity.
- `auth.setup.ts` - the `setup` project: creates/confirms the test user and
  saves a real logged-in `storageState` for the other projects to reuse.
- `unauthenticated.spec.ts` - login/signup shell checks, no auth dependency.
- `shell-navigation.spec.ts` - the 5-item nav, Reports relocation (header +
  Settings), active-route state, profile menu keyboard behavior.
- `nav-reorder.spec.ts` - keyboard-only reordering, Home fixed, persistence
  across reload, restore-default.
- `privacy.spec.ts` - the balance eye/eye-off control, full privacy mode,
  persistence, and optimistic-update rollback on a failed save.
- `accessibility.spec.ts` - automated axe scans (serious/critical only) plus
  manual touch-target/zoom checks, scoped to the pages this task changed.
- `responsive-matrix.spec.ts` - the full §19 breakpoint matrix (320 through
  1920) against the authenticated Home dashboard, plus prefers-reduced-
  motion/forced-colors emulation - see `unauthenticated.spec.ts` for the
  pre-auth (login page) equivalent, kept in a separate file so each set
  of tests runs in the right project.
- `visual.spec.ts` - screenshot baselines for the dashboard (empty/hidden-
  balance/privacy-mode states) and the new Settings pages.
