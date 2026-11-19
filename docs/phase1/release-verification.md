# Release verification register

Observed 2026-11-18/19. **Phase 1 is partially complete; no release/deployment approval is implied.** Tests used synthetic/local data. No production records, flags, migrations or deployments were changed.

## Reproducible environment

Base `24247b3` archived into `/private/tmp/oneledger-phase1-clean`; committed web/mobile lockfiles installed with `npm ci --offline`, then changed source overlaid. No dependency pins or lockfiles were changed. The stale main workspace dependency installation was not used as evidence. Generated Next route types recover with `next typegen`; web now exposes that as `npm run typecheck`. Mobile typed routes regenerated through Expo tooling. Jest resolves shared module runtime dependencies from mobile node_modules; Metro watches root shared code while retaining the separate app lockfile.

## Automated checks

| Surface | Command (from repo root unless stated) | Result |
|---|---|---|
| Web unit/domain | `deno test --config web/lib/deno.json web/lib` | 1,080 passed, 0 failed |
| Edge/backend | `deno test supabase/functions` | 311 passed, 0 failed |
| Database | `PG_BIN_DIR=/opt/homebrew/opt/postgresql@17/bin bash supabase/migrations/tests/run_migration_tests.sh` | 996 passed, 0 failed; throwaway PG17 cluster only |
| Web lint | web: `npm run lint` | Passed, 4 existing warnings, no errors |
| Web types | web: `npm run typecheck` | Passed, generated route types first |
| Web production | web: `next build --webpack` via installed local binary | Passed; compiled, checked types, generated 65 static pages |
| Default web build | web: `npm run build` (Turbopack) | Environment failure: process/network binding EPERM; webpack result does not make this command pass |
| Native Jest | mobile: `npm test -- --runInBand` | 1,002 passed, 0 failed; 104 suites |
| Native lint/types | mobile: `npm run lint`, `npm run typecheck` | Passed, no reported warnings/errors |
| Expo compatibility | mobile: `EXPO_OFFLINE=1 npx expo install --check` | Passed with offline-reliability notice |
| Expo diagnostics | mobile: `npx expo-doctor` | 20/20 passed |
| Expo bundles | mobile: `EXPO_NO_TELEMETRY=1 ./node_modules/.bin/expo export --platform all --max-workers 2 --output-dir /private/tmp/oneledger-phase1-js-export-final` | Passed web, Android and iOS JS/Hermes exports |
| Diff hygiene | `git diff --check` | Passed |

The webpack build used placeholder Supabase public/server credentials and `SITE_URL=http://127.0.0.1:3417`; it proves compilation, not authenticated production rendering. Expo export is not an APK/AAB/IPA build, native module linking proof or device test. SQLite tests use Node's test adapter and report the expected experimental SQLite warning.

Raw session logs are `/private/tmp/oneledger-phase1-{web-test,edge-test,migration,mobile-test,web-check,mobile-check,web-build,expo-doctor,mobile-export-final}.log`. They are transient; the checked-in register preserves the measured outcomes, not CI attestations.

## Separate readiness gates

| Platform | Locally verified | Remaining release gate |
|---|---|---|
| Web | Deno, lint/types, webpack production artifact | Default Turbopack environment failure; authenticated Playwright/bearer API integration; deployment SHA/flag evidence |
| Backend | Complete PG17 chain, source/role/AAL/tenant checks; Edge tests | Review duplicate historical migration ledger; deploy 05/06/07 only after authorization; real signed-token endpoint coverage; downstream cron HTTP health |
| Android | Shared native tests/types, Expo Doctor, Hermes bundle | Signed native build, SQLCipher/Keystore on device, Kotlin capture regression, airplane mode/restart/revoke, back/sheets, accessibility, preview privacy and measured performance |
| iOS | Shared native tests/types, Expo Doctor, Hermes bundle | Signed native build, SQLCipher/Keychain on device, Shortcuts forwarding, airplane mode/restart/revoke, gestures/sheets, accessibility, preview privacy and measured performance |

Docker daemon was unavailable; `open -a Docker` timed out with -1712. No disposable local Supabase HTTP stack could be brought up, so Playwright and real bearer-only HTTP journeys were not executed. `xcrun simctl` was unavailable. No physical device was connected/tested. No performance numbers were measured and no accessibility compliance claim is made.

## Hosted and release metadata

Read-only Supabase evidence is in [security verification](security-verification.md). Nine configured scheduler jobs were active; 3,264 recorded job-level successes in the preceding 24 hours. That does not establish downstream HTTP success. No cron command/authorization header was copied into documentation.

Vercel project searches for OneLedger/personal-finance returned no visible project; web deployment commit and live flags remain unknown. Installed Android/iOS build IDs are unknown. Repository configuration declares app 2.0.0, Android versionCode 10/package me.oneledger.companion and iOS buildNumber 1/bundle me.oneledger.app. EAS production uses local versioning with autoIncrement false; submission/version bump must be reviewed before a later authorized release. Configuration is not installed-build evidence.

Hosted security advisors reported 26 mutable function search paths, pg_net in public, disabled leaked-password protection, 21 RLS/no-policy informational records, and executable definer surfaces (2 anonymous token resolvers, 134 authenticated). These are advisory review inputs, not 134 proven authorization vulnerabilities. The two anonymous functions are intentional token-based `invite_preview` and `resolve_payment_request`; do not remove their public contracts without reviewing callers. Remediation references: [function search paths](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [extension schema](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public), [definer execution](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). No hosted settings were changed.

## Wallet and household follow-up — 2026-11-19

Migration 08 adds the scoped wallet lifecycle RPC and shares the default-wallet transaction lock. The disposable PostgreSQL suite passed 1,002 checks. Native lint and types passed, with 1,005 Jest tests across 105 suites. Web Deno passed 1,080 checks.

Turbopack could not resolve the shared financial module outside the web directory. The explicit repository root fixed that resolution error. Default production build still fails on local PostCSS worker port binding with EPERM, including outside the sandbox. The new bearer-only wallet spec is discoverable through the Chromium project, but Docker Desktop did not make its local engine available after launch. Real signed-bearer HTTP, Android and iOS device journeys, and hosted deployment remain open.

The webpack production build and Expo JS/Hermes exports for web, Android and iOS passed using the isolated checkout. These checks used no hosted credentials or signed native builds.

## Native goal contributions follow-up — 2026-11-19

Migration 09 reuses the protected operation log for idempotency and serializes contribution total recomputation. PostgreSQL passed 1,011 checks, including exact USD minor units, payload mismatch, viewer and foreign Space rejection, concurrent contributions, replay after removal and archived-goal rejection.

Native lint and typecheck passed. Jest covers amount precision, same-request retry, restored retry, viewer history and failure to store a durable request. See the dated [parity matrix update](../ONELEDGER_WEB_MOBILE_PARITY_MATRIX.md) for remaining product scope. Real signed-bearer and device verification remain open. Migration 09 is local.

## Native budget allocation follow-up — 2026-11-19

Migration 10 adds the scoped preview and save RPC. PostgreSQL passed 1,023 checks, including deterministic rounding, exact 100% validation, delegated permissions, cross-Space denial, stale income, and a race between two saves using the same revision. Only one concurrent save succeeded. Preview left the persisted plan unchanged.

Native lint, typecheck, and 1,014 Jest tests passed. The new tests cover amount preview, save and refresh, conflict reload, and permissions on the Budget screen. The migration and clients remain local. Signed HTTP and physical-device verification remain open.

## Native budget creation and activation follow-up — 2026-11-19

Migration 11 adds the draft creation and activation functions. The disposable PostgreSQL suite passed 1,039 checks, including atomic rollback, delegated access, exact income normalization, creation replay, stale activation, and concurrent activation. Native lint, typecheck, and 1,024 Jest tests passed. Expo exports passed for Android, iOS, and web.

Migration 11 is local and must be present before releasing the feature. Signed builds and physical-device verification remain open. The Expo web preview does not offer offline-retry-backed draft creation.
