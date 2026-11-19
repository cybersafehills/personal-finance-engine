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
  digit merchant code), the transaction lives in the **active Space** (the server creates the draft in the Space named by `X-Workspace-Id`, else the personal Space, and checks the paying account against it), and a usable RWF paying account exists. A
  merchant needs an **MTN** account (the only merchant-pay code in the directory
  is MTN's, and the network comes from the paying account); a bank, cash or
  Airtel account would only lead to a draft with no route, so it is skipped.
  In a household only the user's **own** accounts count as the payer: the transaction's own account may be another member's (the web labels it "Amy's account"), and for a merchant the account also decides the network; an account whose owner can't be told is skipped, and in a personal Space every account is the user's. A household **viewer** is hidden from it, because `create_payment_intent` requires the `member` role and would refuse after an amount was typed. Airtime and bills are excluded for the reasons in the Pay intents note.
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

## Implementation notes (Categories)

- A read-only Categories screen (More -> Categories): all-time spending per
  category with a share bar and transaction count; tapping a category opens the
  Transactions list filtered to it ("Uncategorized" means no category, like the
  web), with a chip to clear the filter.
- The totals come from `GET /api/mobile/categories`, served by the web's one
  canonical aggregation (`getCategoryTotalsComplete`), not recomputed in the app.
  Like the web page it covers every Space the user belongs to.
- **The all-time totals can be silently wrong for a long history.** The old query
  read every settled outgoing transaction in one request, and the REST API
  returns at most `max_rows` per request (1000 in the repo config; production's
  value was not checked), so a longer history would drop everything past the cap
  with no error. The Categories page and this route now use
  `getCategoryTotalsComplete`, which pages (a stable `id` order, advancing by the
  rows actually received and stopping only on an empty page so a lower server cap
  cannot cut it short, 50 pages at most) and reports `truncated` if the cap is
  reached, which the screen turns into a visible warning. A failed read is an
  error the app can retry, never "no spending yet".
- **Not changed, on purpose:** Home's "top spending category" and the
  category-name suggestions on every transaction page still use the old
  one-request `getCategoryTotals`, because paging on those hot paths would add a
  full scan per load. They keep the row ceiling; other all-rows aggregations may
  too. This work does not audit them.
- Navigation: the tap-through uses `router.navigate` (Transactions is a tab) and
  the filter chip clears with `router.setParams({ category: undefined })`, both
  checked against the installed `expo-router` types.
- The tap-through filters on category only, as the web does. The totals count
  settled outgoing transactions, so the list can also include money in and
  unsettled rows for that category; the direction chip narrows it.

## Implementation notes (Reports)

- Read-only Reports screens (More -> Reports): a list of daily report runs and a
  detail with the closing balance, the day's activity, the spending breakdown,
  budget health, trends, watch-outs, the outlook, the AI commentary and a PDF
  download. A report is an immutable stored snapshot, so the app only displays it.
- The server renders every sentence and date (`lib/mobile-reports.ts`, using the
  web's shared `report-alert-messages.ts` and its timezone-aware formatters):
  the sentences are shared with the morning email so the two never word an alert
  differently, and the dates use `toLocaleString` with an IANA timezone, which a
  phone's JS engine may not support. The app maps a tone to a colour and also
  spells the tone out for screen readers, so colour is never the only signal.
- The PDF follows the statements pattern: the render, cache and signed URL moved
  into `lib/report-download.ts`, shared by the web's redirecting route and the
  mobile JSON route, so there is one ownership check and one render path. The app
  asks for a fresh five-minute link on every tap and only accepts `https`.
- Reports are not Statements: Statements (already in the app) are generated,
  period-scoped documents; Reports are the daily snapshots.

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
  more than one change) and Tags. Budget-allocation splits are not here yet; they stay on the web (the existing "Edit on the web" button).
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
- **Duplicates are a trail, as on the web**: flagged, merged away (opens the
  kept transaction) and what was merged in (each opens its own). Merging or
  dismissing stays where both candidates are visible; the detail screen never
  resolves one blind. A flagged transaction in the **active Space** offers "Review it" (the Inbox covers the Space the server is using); anything else offers the web's review queue, because the Inbox would not have the item.
- A tag removal asks the database for the rows it deleted: under RLS a delete the
  caller may not make is not an error, it removes nothing (a household viewer
  can see tags but not delete them), so zero rows is checked against the tag
  still existing before the chip is dropped.
- **Household attribution ("Whose spending")** is editable for a household
  transaction: shared, one member, a percentage split, or not sure yet. The web
  action is a thin wrapper over the `set_transaction_attribution` database
  function (no MFA step; it only adds an analytics event and revalidation), and
  that function enforces household-only, source visibility, the
  `transaction.categorize` capability, active members and the 10000-basis-point
  total, so the app calls it directly under RLS like tags and category changes. It
  changes how an expense is *counted* in household reports; no money moves. A
  split is edited as one percentage box per member (so a member cannot appear
  twice) and totalled in whole basis points (summing percentages as floats makes
  three equal thirds miss 100). The database's own refusals are plain sentences
  raised with `raise exception` (`P0001`) and shown as they are; any other error
  gets a generic message. If a split's rows cannot be read there is no panel
  rather than a false "Not decided yet". The web's analytics event
  (`transaction_attributed`) is not sent from the app.
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

### Bills (read-only first slice)

The Bills screens list and open the invoices and receipts of the active Space
(`GET /api/mobile/bills[/:id]`, docs/mobile-api.md). They ship dark with the web
feature (`BILLS_ENABLED`): the More-tab entry appears only when `GET
/api/mobile/config` says `bills` for the active Space. Two decisions worth
keeping: RLS on `bill_documents` is plain membership, so the routes filter on
the active Space explicitly (a document from another Space answers 404); and the
wording is shared with the web (`lib/bills/display.ts`) so the two never describe
a document differently. Not in this slice: upload or capture, review and
approval, supplier and duplicate handling and comments.

## Implementation notes (Pay button)

- The raised blue centre button in the bottom bar (the web's elevated Pay
  trigger) opens a native Pay & Services sheet. The bar slot is the `pay` tab; its
  `tabBarButton` opens the sheet instead of navigating. It appears only when
  `GET /api/mobile/config` says `pay` is on (any doubt: no button).
- Person and merchant payments are prepared in the app (`/pay-new`, then the
  existing review screen) only where `assistedPay` is on; otherwise those two
  tiles read "Coming later", as on the web. Bill, electricity, airtime and
  government payments, the USSD directory, activity and templates open the web:
  the app has no verified route for them (see "Pay intents").
- Not yet native: Scan to pay (needs a camera module and a new build, plus a
  `scanToPay` flag in the config response) and a native USSD directory.

### Pay button: USSD directory and saved recipients

- The USSD directory is native (`/ussd`, `/ussd/[slug]`) and reads `service_codes`,
  `service_favourites` and `service_code_reports` under RLS exactly as the web
  does; the fill/validation rules are a port of `web/lib/ussd/capability.ts`
  (same messages, tested against the same cases). Not ported: the payment
  networks list and recent-usage analytics.
- Saved recipients (`/recipients`) read and write `trusted_recipients` under RLS.
  Because the web gates writing behind a server flag, the app offers the screen
  only where `GET /api/mobile/config` says `trustedRecipients` is on. In the Pay
  form a saved recipient fills the number and name (sent as an ordinary
  recipient: the mobile intents route does not take a `trustedRecipientId`, so the
  intent is not linked to the saved row); a recent payee fills the name only, as
  on the web.

### Pay button: Scan to pay

- `/scan` uses `expo-camera` (a native module: needs a new build). The config
  plugin requests the camera only; the microphone and Android `RECORD_AUDIO` are
  switched off. The privacy policy and the Play Data safety answer were updated
  to say the camera is used only to read a QR code and nothing is kept.
- The scan is data, never authorization (ADR 0006). The app sends the decoded
  text to `POST /api/mobile/pay/scan/classify`; the server re-parses it with the
  same pipeline as the web (`lib/pay/scan`) and returns a redacted, display-ready
  model or a coarse rejection. One tap on `/prepare` creates the draft
  (`lib/pay/scan/prepare.ts`, shared with the web action, so one code path).
- Nothing is dialed on detection. Android has an explicit "Open phone dialer";
  iPhone shares/copies the code (same reason as the Pay review screen). The app
  never claims the payment settled.
- Provider links and EMV merchant QRs are explained but not continued (the web
  does the same: no verified route). Only the first code the camera reports in a
  scan is handled.

### Categorization rules (list, pause and resume)

The Categories screen links to the rules of the active Space
(`/api/mobile/categorization-rules`, docs/mobile-api.md). Live as soon as the
mobile API is, since the web has no flag for rules. A rule's condition sentence is
shared with the web (`lib/categorization/rule-summary.ts`). The write names its
Space and reads the changed row back, because RLS silently hides an UPDATE a
viewer is not allowed to make. Not in this slice: create, edit, reorder, apply to
history, suggestions, templates, history.

Bills: **View original** (`POST /api/mobile/bills/:id/original`) opens the stored
file through a fresh signed link, shown only to members with
`bill.download_original`. It is a POST because every ask is audited, and it
requires the document to be in the active Space because the audit function only
checks the document's own Space. Still not in the app: upload or capture, review
and approval, supplier and duplicate handling, comments.

### Pay: dialer on iPhone, and the live payment result

- iPhone now has an explicit "Open phone dialer" on the review screen, like Android
  and like the web (which has always offered it on iOS). It is still only ever an
  explicit tap, never automatic; iOS shows its own "Call?" confirmation for the USSD
  code. "Share or copy code" stays as the second option. (This reverses the earlier
  "no dial button on iPhone" note, which was caution, not a measured failure.)
- After the hand-off the review screen becomes **Payment status**, mirroring the web's
  `PaymentResultStatus`: a spinner while the payment waits (`initiated`,
  `awaiting_verification`, `processing`), a **blue tick** for `successful`, a **red
  cross** for `failed` / `expired` / `reversed`. The app asks the server every 4
  seconds while the app is in front. A tick is only ever drawn for the server's
  `successful` state, which is reached by the provider's own message matching the
  payment (`verified: true`, "Money sent") or by the person saying so ("Marked as
  sent"); opening the dialer is never a tick. This supersedes "the review screen
  never claims success": it still never claims it from a hand-off alone.
- After 90 seconds with no provider message the screen asks what happened: **I sent
  it** (the web's `manually_confirm_payment`) or **It didn't go through** (transition
  to `failed`), via `POST /api/mobile/pay/intents/:id/settle`. A provider message
  that arrives later still wins.
- The Pay sheet gains **Request payment** (opens the request form) with an info
  button that explains it in plain words, shown only where `paymentRequests` is on in
  `GET /api/mobile/config`. Close moved to the bottom centre of the sheet.

### USSD code page: built around dialing the code

- The page now leads with the code and a **Dial this code** button (iPhone and
  Android alike; iOS shows its own "Call?" prompt), a one-line summary, and the
  verification badge. Codes that need your details show them first ("Your details")
  and the code fills in as you type; the button stays off until it is valid, and
  never dials by itself. Share/copy is the secondary action.
- Everything explanatory (full description, caution, "How to use it" steps, source) is
  in a collapsed **About this code**; reporting a mistake is a quiet link at the
  bottom. The native header just says "USSD code"; the service's own name is the
  heading, so long names no longer truncate in the title bar.
- Unavailable services cannot be dialled; deprecated ones say so and link to the
  current code.

