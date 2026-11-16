# ADR 0019: OneLedger mobile app (Expo) replaces the Android companion

- **Status:** Accepted (PR 0 scaffold landed; capture module is PR 3)
- **Date:** 2026-11-14
- **Supersedes:** ADR 0010 §1 ("a thin native Kotlin app, not a second
  OneLedger") and its "Expo + native modules" rejected alternative. The rest
  of ADR 0010 (least privilege, device-held secret, bounded idempotent queue,
  health vocabulary, flags) remains authoritative and carries over unchanged.
- **Builds on:** ADR 0008/0009 (pairing + `/capture`), ADR 0013 (iOS
  direction), ADR 0001 (non-custodial boundary).

## Context

`android/` ships a capture-only client. The product now needs one installable
app that also gives members a real mobile experience (home, transactions,
inbox, notifications), biometric unlock, push, and guided onboarding for both
platforms. Maintaining a Kotlin capture app plus a separate mobile app plus a
future Swift app is three codebases for one product.

ADR 0010 rejected Expo because the capture path is a native-surface concern
(`NotificationListenerService` binding, Doze/OEM kills, WorkManager). That
reasoning is correct and is **kept**: it is a reason to keep capture native,
not a reason to keep the whole app native.

## Decision

1. **One Expo (React Native, TypeScript) app, `oneledger-mobile/`**, Expo
   Router, development builds + EAS Build (not Expo Go).
2. **Capture stays native Kotlin, inside a local Expo module**
   (`modules/oneledger-capture`). Listener, matchers, Room queue, WorkManager
   drain and health derivation run with no JS runtime, so capture works while
   the app is killed. JS only reads health/events and triggers pairing. The
   `pfe_` device secret never enters JS.
3. **Matchers are not literally shared.** They must run in Kotlin with no JS
   engine. Parity is enforced by one shared fixture,
   `supabase/functions/_shared/tests/provider-cases.json`, run against
   `providers.ts` by the Deno suite and against the Kotlin port by the
   module's `ProviderCasesTest`. `providers.ts` stays the source of truth.
4. **Protocol unchanged.** Same `/capture` (`pair` → `test` → `capture`),
   same `DEVICE_PAIRING_V2` flag, same `capture_url` handling. No server
   change is needed for Android capture.
5. **Android identity is kept: `me.oneledger.companion`.** The native module
   keeps the existing prefs file name and Keystore key alias so, with the same
   package and signing key, an upgrade preserves existing pairings. iOS bundle
   id: `me.oneledger.app`.
6. **Auth & lock.** `supabase-js` with a chunked `expo-secure-store` adapter.
   Biometric unlock is an app-lock gate (`expo-local-authentication`), not a
   replacement for the Supabase session; capture never depends on it.
7. **Data.** Reads via `supabase-js` under RLS (mirroring `web/lib/queries.ts`).
   Writes that are server actions today (with MFA/capability checks) get thin
   bearer-JWT Route Handlers under `web/app/api/mobile/*` sharing extracted
   logic, so authorization is not duplicated in the client.
8. **Push.** New `push_devices` table + register RPC; push drain alongside
   the existing email outbox in `send-notifications`; Expo Push service
   (FCM v1 + APNs credentials).
9. **iOS.** iOS cannot observe other apps' notifications. v1 is an in-app
   Shortcuts guide plus pairing handoff; an App Intent ("Send to OneLedger",
   ADR 0013) follows. ADR 0013's "allow notification access" step does not
   apply to iOS.

## Implementation notes (PR 3)

- The module's Kotlin packages stay `me.oneledger.companion.*` (its Gradle
  `namespace` is `me.oneledger.capture`). Android stores the user's
  notification-access grant against the listener's component name, so the
  class name must not change across the upgrade.
- The service, boot receiver and permissions are declared in the module's own
  `AndroidManifest.xml` and merged by Gradle; no config plugin is needed.
- `FOREGROUND_SERVICE*` and `POST_NOTIFICATIONS` are not requested: the upload
  worker is plain WorkManager. (`CAMERA` returns with QR pairing in PR 4.)
- JSON is built with `org.json` instead of kotlinx-serialization, so the
  module needs no serialization compiler plugin. Wire shape is unchanged and
  pinned by `CaptureWireTest`.
- `android.allowBackup` is `false`: the device secret is in
  `EncryptedSharedPreferences`, which cannot be decrypted after a restore.

## Implementation notes (PR 4)

- **Connecting from inside the app needs no code.** The signed-in app calls
  `create_device_pairing_session` itself (the database function enforces
  "workspace owner only") and hands the one-time token straight to the native
  engine. The token is generated on the device, held only in memory, and
  never displayed. A typed/pasted code and the `oneledger://pair?c=` deep
  link remain as fallbacks for the web wizard.
- **No camera permission.** QR scanning existed to carry a code from the web
  to the phone; with in-app connect it is unnecessary.
- The connect flow's step is derived from the engine's real state, not
  stored, so it resumes after a trip to system settings or a restart.
- A prominent disclosure is shown before pairing or notification access.
- The browser development preview uses an in-memory demo engine (`__DEV__`
  on web only) so the flow can be reviewed without a phone.

## Implementation notes (PR 6)

- The iPhone guide mirrors the web pairing wizard's iOS branch: add the two
  Shortcuts, connect (the app creates the pairing session and runs "Connect
  to OneLedger" with the code via `shortcuts://run-shortcut`), create the
  Messages automation (Message Contains `RWF`, Sender empty), then verify.
- Progress is confirmed from the server, not from the Shortcut: the app polls
  its own `pairing_sessions` row and the device's `last_used_at` under RLS.
- Unlike Android, the one-time code is visible in JS and on screen here;
  that is inherent to handing it to a Shortcut. The device secret is still
  generated and held by the Shortcut, never by the app.
- The install buttons need `EXPO_PUBLIC_MOMO_SHORTCUT_URL` (and optionally
  `EXPO_PUBLIC_MOMO_CAPTURE_SHORTCUT_URL`). Until the Shortcuts are published
  (docs/oneledger-capture-shortcut.md "Publishing") the guide says so.
- Off an iPhone the screen is a walkthrough that creates nothing server-side.

## Implementation notes (review actions)

- Accepting or rejecting a category suggestion calls the same database
  functions as the web's server actions (`confirm_transaction_category`,
  `dismiss_suggested_category`) directly with the user's session. They check
  workspace membership themselves and are granted to `authenticated`, so no
  `/api/mobile` route is needed for them. A route is only added when the
  logic lives in a server action with checks the database does not enforce
  (MFA, capability gates).
- A conflict can only be cleared, never confirmed: nothing is applied on the
  user's behalf when rules disagree.
- Picking or typing a category calls `apply_manual_category_correction` under
  the session, like the web's "Correct category". The optional "remember for
  this merchant" rule is written to `categorization_policies` under RLS,
  scoped by the transaction's `workspace_id`, matched in code rather than with
  `ilike` (PostgREST treats `*` as a wildcard). Still no `/api/mobile` route.

## Implementation notes (Inbox)

- The Inbox is computed by the web app and served at `GET /api/mobile/inbox`
  (docs/mobile-api.md). It aggregates ~10 domains behind server-side feature
  flags, so re-implementing it in the app would duplicate that logic and the
  flags. The route makes the existing read models run under the caller's
  bearer token (request-scoped `AsyncLocalStorage`, honoured by
  `supabaseSession()`); RLS remains the boundary.
- The route requires a completed second factor, which the web proxy does not.
- The Inbox tab falls back to the direct category-review queue when the
  endpoint is off or the app is not configured, so category checks never
  depend on the server route.
## Implementation notes (Goals)

- A read-only Goals screen (More → Goals). It reads `financial_goals` under RLS
  and calls the database's `goal_progress()` per active goal (SECURITY DEFINER,
  checks Space membership itself, granted to `authenticated`), so the percent,
  the required monthly saving and the projected date are the database's, not
  client maths, and no `/api/mobile` route is needed.
- Like the web's goals list there is no workspace filter, so goals from a
  household Space the user belongs to are listed with their own.
- A failed progress call drops only that goal's pace lines. Creating goals and
  adding contributions stay on the web.

## Implementation notes (Pay intents)

- Preparing a payment is the first mobile **mutation through a route**: the
  assisted-pay flags live in server env (a direct RPC call would bypass them)
  and the web action carries an MFA step-up. `mobilePost` shares the GET guard's
  authentication, whose completed-second-factor rule is the same condition as
  `requireMfaForSensitiveAction`, so a mobile mutation is never weaker than its
  server action.
- `lib/pay/create-intent.ts` (creation) and `lib/pay/instruction.ts` (the USSD
  string) were extracted from the web action and review panel so web and app
  run one implementation. `pay-assisted`, `pay-again` and `pay-merchant` e2e
  are the safety net for that refactor.
- The app never builds a USSD string itself: it shows and dials what the server
  returns, and treats `instruction: null` as "no verified route".
- Only person and merchant payments are offered. Airtime is excluded because the
  web directory maps `buy_airtime` to the send-money code (it would transfer
  money, not buy airtime; a web-side quirk, left unchanged), and bills have no
  verified route. A merchant's network comes from the paying account's row.
- Recording the handoff has its own route so an intent leaves `draft`; it reuses
  the web action's logic via `lib/pay/handoff.ts`.

## Implementation notes (iPhone health)

- iOS gives the app no view of the Shortcut, so the only honest health signal
  is the server's record of the device credential (`status`, `created_at`,
  `last_used_at`). The setup guide remembers the credential id it learns when
  pairing completes (device store; the id is not a secret, the Shortcut holds
  the secret) and the More tab shows working / waiting / quiet / disconnected
  from it. Quiet means no message for 7 days, or none ever after 3 days; that
  is normal for a light MoMo user, so the copy says to check, not that it is
  broken.
- Reopening the guide with a still-active connection resumes at "check it
  works"; "Connect this iPhone again" forgets the old connection.
- The troubleshooting list only states things the capture spec
  (docs/oneledger-capture-shortcut.md) guarantees (exact Shortcut names,
  Run Immediately, trigger word RWF, one-time codes).

## Implementation notes (Pay again, app)

- "Pay {name} again" on a transaction's detail, only for `send_money` (a person)
  and `merchant_payment` (a business). It is **absent** unless every check holds:
  `GET /api/mobile/config` says assisted pay is on (any failure hides it), the
  reference passes the server's own rules (a Rwandan mobile number or a 3-12
  digit merchant code), the transaction lives in the user's personal Space (the
  server creates intents there), and a usable RWF paying account exists. A
  merchant needs an **MTN** account (the only merchant-pay code in the directory
  is MTN's, and the network comes from the paying account); a bank, cash or
  Airtel account would only lead to a draft with no route, so it is skipped.
  Airtime and bills are excluded for the reasons in the Pay intents note.
- **Deep links:** the app registers the `oneledger` scheme, so every route is a
  link target. `/pay-again` therefore takes only a transaction id and rebuilds
  the recipient, name and paying account from that transaction (re-checked each
  time); a crafted link cannot choose a recipient. The form shows the whole
  number, not a masked one: it is the one place to check it before paying.
- The amount is never prefilled. The request id sent with "Prepare payment" is
  bound to the recipient, account and amount: a retry or double tap returns the
  same draft, an edited amount gets a new id (otherwise it would silently return
  the old draft).
- The review screen shows the code the server built and never claims success
  (states the app doesn't recognise read "In progress"). It never dials by
  itself. Android: an explicit "Open phone dialer" tap opens the `tel:` link.
  iPhone: no dial button; share or copy the code and dial it in the Phone app,
  because the app has not been run on an iPhone to verify `tel:` USSD handling.
- Copy uses React Native's built-in share sheet (its "Copy" action), not
  `expo-clipboard`, so no native module or new build was added. On iPhone a
  hand-off is recorded only when the share completes; **Android always reports
  "shared"** (React Native's own docs), so there a dismissed sheet is recorded
  as well. That is no worse than the web, which records a copy click whether or
  not the clipboard write worked, and a hand-off only ever means "awaiting
  verification", never that anything was paid.
- Not yet run on a physical device.

## Implementation notes (Budgets)

- Budget figures are computed by the web's canonical `getBudgetActuals`
  (explicitly never to be reimplemented), so the app reads them from
  `GET /api/mobile/budgets` and only displays them. The Inbox and Budgets
  routes share one guard (`lib/mobile-request.ts`); new read-only mobile
  endpoints should use it.
- Creating and editing budgets stays on the web; the app is read-only here.
- The Home budget card loads independently of the rest of Home and respects
  privacy mode, so a slow or unavailable budget service never delays Home.

## Implementation notes (Add transaction)

- **Signed-in users cannot INSERT into `transactions`.** Phase B made
  ingestion (service_role) the only direct writer; the only authenticated write
  is the owner's category correction. Phase E relaxed `momo_message_id` for
  manual rows "for the web manual-entry action" but never granted the insert,
  so that action's direct insert was denied by Postgres. Rather than open
  INSERT on a financial table (a user could then set any column, including
  dedupe/decision/provenance), migration `20261222000000` adds one audited
  entry point, `create_manual_transaction(...)`: owner of the account's
  workspace only, workspace and currency derived from the account, the same
  validation as the web action, effects computed exactly as the accounting
  check constraints expect. The web action and the app both call it; the
  migration tests assert direct INSERT stays denied.
- Household members cannot add by hand yet (owner-only, like the category
  correction); widen with a capability check when Spaces needs it.
- The app validates first (`features/manual/input.ts`) for friendly messages;
  the function re-checks everything. Dates are Kigali time and a time more than
  five minutes in the future is refused. There is no de-duplication: the button
  is disabled while saving, but a deliberate second entry is a second
  transaction.
- Category is chosen afterwards on the transaction's detail screen (the web
  form's optional category is applied through the existing category-correction
  function after creation).
## Implementation notes (Transaction detail parity)

- The detail screen follows the web page's block order: a centred hero (who, how
  much, when), the Pay-again button, an attention banner, Duplicates, "Where this
  came from", the detail rows, Category (with why, and history once there is
  more than one change) and Tags. Splits and the household attribution panel are
  not here yet; they stay on the web (the existing "Edit on the web" button).
- Reads are plain queries under the signed-in user's RLS, ported from the web
  queries (`getTransactionSpaceContext`, `getCategoryHistory`,
  `getTransactionDuplicateContext`, tags, and the `space_member_directory`
  function for household names): no new `/api/mobile` route. Each part loads and
  fails on its own (`loadDetailExtras`), so a failed read removes only its own
  block, never the whole screen.
- **Tags are editable** (add, remove, one-tap suggestions from the Space). The
  web does these as plain inserts and deletes with no MFA step, and the policies
  enforce the `member` role, `created_by = auth.uid()` and a matching workspace,
  so the app writes directly under RLS as well; the only server-side rule
  (1-40 characters) is also a table check. The web's character rule uses a
  Unicode property escape (`\p{L}`), which the app avoids (not verified on
  Hermes), so ASCII symbols are rejected and accented letters pass; that is
  slightly looser than the web for non-ASCII symbols.
- **Duplicates are a trail, as on the web**: flagged ("Review it" opens the
  Inbox, which shows both candidates side by side), merged away (opens the kept
  transaction) and what was merged in (each opens its own). Merging or
  dismissing stays in the Inbox, where the candidates are visible; the detail
  screen never resolves one blind.
- Household lines ("Paid by", "Added by", whose account) show real member names
  when the directory loads and fall back to "You" / "A member" like the web.

## Implementation notes (Statements)

- A read-only viewer: list the statements and download a PDF/CSV. The list is
  `GET /api/mobile/statements` (stored totals, personal workspace, behind
  `FINANCIAL_STATEMENTS_ENABLED`); a download is a fresh five-minute signed URL
  from `GET /api/mobile/statements/:id/document`, opened with the system
  (`expo-linking`), so no new native module and no build is needed.
- The document logic was extracted from the web route into
  `lib/statement-download.ts` so there is one ownership check, one render
  path and one audit event for both clients.
- Generating statements, packs, schedules and provider documents stay on the
  web; the screen links there when there are none.
## Implementation notes (Transaction filters)

- The Transactions tab filters by direction, period and "needs review" on top
  of the existing text search. All of it is a read under RLS (`direction`,
  `occurred_at`, `category_decision_status`), so there is no `/api/mobile`
  route. Periods are Kigali calendar days (last 7 days = today plus six);
  the bounds live in `features/transactions/filters.ts` and are unit-tested.
- Filters are screen state, not persisted: reopening the tab shows everything.

## Consequences

- `android/` is retired only after the new app reaches parity and one stable
  release cycle; both speak the same protocol so they coexist safely.
- Android-specific onboarding must handle Android 13+ "restricted settings"
  for sideloaded builds and OEM background kills (battery/autostart).
- iOS device builds, TestFlight and APNs push require an Apple Developer
  Program membership (`docs/mobile-apple-developer-setup.md`). Android and
  all non-iOS work are unaffected.
- Expo SDK upgrades are a recurring cost; CI runs `expo-doctor`.

## Rejected alternatives

- **Keep Kotlin app + build a second mobile app.** Two apps for one user.
- **Pure-JS notification capture.** Cannot run when the app is killed.
- **Expo Go.** Cannot load the custom native module.
