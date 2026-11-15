# OneLedger mobile ↔ web parity: build brief for Claude Code

Paste this whole file into Claude Code in VS Code, opened at the **repo root**
(steps touch both `oneledger-mobile/` and `web/`).
Read `oneledger-mobile/AGENTS.md` first. Its rules apply: Expo Router only,
`npx expo install` for packages, run `npx expo lint` and `npx tsc --noEmit`
before declaring any step done, and never hand-edit `ios/` or `android/`.

## 0. How this was produced, and what is NOT verified

- Sources: (a) the **live production site**, signed in as the same account as the
  phone (n-yves@cybersafehills.com, Personal Space), viewed at a 390px-wide frame
  (same-origin iframe, so the phone CSS breakpoints applied); (b) the web code in
  `web/` on `origin/main` (7820f96), read for the files named in each step (not
  every file); (c) the six phone screenshots.
- Live-verified, read-only (no action buttons pressed): Home, Transactions
  (+Filters panel), Transaction detail, Inbox, Plan (/budgets), More sheet,
  profile menu, Pay launcher, Settings, Review queue. **Not** opened live: Reports,
  Categories, Notifications page, Pay sub-flows, Integrations, Budget detail.
- This account has Pay, Insights/forecast and Reconciliation turned on. The
  More sheet shows **no** Bills, Space & members or Advanced group for this
  account (hidden by experience mode/flags), so those rows must be conditional.
- Not available to the app today: feature flags. Anything flagged must either
  come from a new mobile endpoint that reports flags, or be left out of v1.
- The floating blue gear in every screenshot is the Expo dev-menu button of a
  development build. It is not part of the app; ignore it.
- This is production data. Verify read-only: never press Confirm, Merge,
  Dismiss, Sign out, or the balance eye on the live site.

## 1. Executive summary: why the app doesn't look like the web

The app's data layer and design tokens already mirror the web
(`src/theme/tokens.ts` matches `web/app/globals.css`). What differs is the
**shell and the screen composition**:

| Area | Web (phone width) | App today |
|---|---|---|
| Header | Sticky: logo mark left; Pay trigger (if enabled), Inbox icon with red count badge, Reports icon, profile menu (email, Space switcher, settings, sign out) right | None. Each screen has only a title |
| Bottom bar | Home · Transactions · (Pay, centre, flag-gated) · Plan · More. Inbox is a header icon | Home · Transactions · Inbox · More. No Plan, no Pay |
| Home balance | Solid accent-blue card, "Current balance", eye toggle on the card, "MTN Mobile Money", "Updated {day}, {time}" | White card "MoMo balance", "As of … from your last MoMo message"; Hide/Show text button in the page header |
| Home tiles | "Received today", "Spent today" | "In today", "Out today" |
| Home extras | Budget status card, Intelligence card (flagged), onboarding/first-run cards, Space spending card (households), "Recent transactions" with "See all" (6 rows) | Recording-off card, budget card, review card, "Recent activity" (8 rows) |
| Transactions | Header actions: Review queue (n), Transfers, Add transaction; yellow lifetime chips (sent / received); search + Filters panel; grouped by Today/Yesterday/date | Title + "Add"; search only; grouped by day |
| Inbox | Back link, attention card, forecast link (flagged), Notifications section (8 + "View all"), summary tiles, priority-grouped cards (Resolve first / Next up / When ready), badge toggle | Summary tiles + flat card list. **Currently erroring** (section 3) |
| More | Grouped sheet: Manage money / This Space / Account / Advanced / Pay & Services | One flat screen of cards (account, recording, notifications, budget, security, sign out) |

### 1.1 Live findings at 390px (these override anything below that conflicts)

- **Header (every signed-in page):** logo mark left; right: Inbox icon with red
  badge ("2" for this account), Reports (document) icon, profile (person) icon.
- **Bottom bar:** Home · Transactions · **Pay** (elevated blue circle, centre) ·
  Plan · More. Active item = accent blue. Inbox is NOT in the bar.
- **Home order:** balance card (blue, eye on card, "MTN Mobile Money", "Updated
  Today, 07:54 PM") → Received today / Spent today (+35,000 / −3,420 RWF) →
  **Budget status** (On track, 194,280 of 500,000 used, Remaining 305,720) →
  **Insights** card (flagged; "See the full forecast →", projected balance in 30
  days with a yellow warning, spending this month vs pace, unusually large
  payments, recurring payments detected, each with "Why am I seeing this?") →
  Recent transactions + "See all".
- **Transactions:** title; row of "Review queue", "Transfers" links and the blue
  "Add transaction" button; two yellow chips with only an amount and an "i"
  (3,830,678 RWF sent, 28,950,556 RWF received); search box + "Filters" button;
  Filters panel = Direction, Account, Min amount, Max amount (Currency appears
  only with >1 currency). Day headers TODAY / YESTERDAY / NOVEMBER 13.
- **Transaction detail:** centred hero (name, big signed amount, full date) →
  "Pay {name} again" blue button → "WHERE THIS CAME FROM" (Space, From: Bank,
  Imported via: My Phone) → rows (Amount, Direction "Money out", Balance after,
  Type "merchant payment") → CATEGORY ("Transport · Moto", "Matched your \"Evening
  Bike Transport\" policy.", "Correct category") → TAGS ("No tags yet", Add) →
  BUDGET ALLOCATION ("Split across allocations").
- **Inbox:** "← Home", title, subtitle → NEEDS ATTENTION card ("Budget
  categories need attention", badge 2) → Cash-flow forecast link → Notifications
  (View all, "1 unread", Mark all read, card with Mark read, "Show 7 earlier") →
  tiles Open 49 / Resolve first 14 / Next up 34 → "Resolve first (14)" collapsed
  into one "Reconciliation (14)" card with "Review all 14", "Next up (34)" likewise,
  "When ready (1)" budget alert. The 14 + 34 are payment reconciliation items.
- **Plan:** "Budgets / Your 50/15/5/30 budgets, from draft to archived", links
  Goals, Categories, blue "New budget"; a card "September Budget · Active · Sep 1,
  2026 – Sep 30, 2026 · RF 500,000 / month". (The web prints "RF" instead of
  "RWF" here: a web formatting quirk. Do not copy it; the app should say RWF.)
- **More sheet (bottom sheet with "Close" button):** MANAGE MONEY: Categories,
  Reports, Connected sources · ACCOUNT: Settings, Notifications · PAY & SERVICES:
  USSD directory, Trusted recipients, Payment templates. Rows have a leading icon.
- **Profile menu (popover):** email; SPACE list with kind tags (Personal,
  Dolton's Household, Dol, Sash & Kenia, Cielo, Cielo, "Create a Space");
  Integrations; Settings; Appearance and navigation; Privacy and security;
  Sign out.
- **Pay sheet:** "Pay & Services / Prepare a payment or find a verified USSD
  code." → "Scan to pay" (green, "Scan a merchant payment QR code.") → grid: Pay
  a person, Pay a merchant, Pay a bill, Buy electricity, Buy airtime or data,
  Government services → blue "Open USSD directory →" → View payment activity,
  Use a payment template → "Close". One tap never executes a payment.
- **Settings:** seven groups, each with a one-line purpose and rows with a
  title + description (Profile & Preferences, Accounts & Connections, Spaces &
  Members, Reports & Notifications, Data & Integrations, Security & Privacy,
  Billing & Plan).
- **Review queue:** "Review queue / Categorizations made with less than full
  confidence, and household transactions still waiting on an attribution",
  empty = "Nothing to review".

### 1.3 DECISIONS LOCKED BY THE USER (supersede 1.2 and any "open the web" / "defer" wording below)

1. **Nav: mirror the web.** Header with Inbox icon + badge; bar = Home ·
   Transactions · Pay · Plan · More.
2. **Pay: v2, behind a config endpoint.** v1 ships without the Pay slot. Add
   `GET /api/mobile/config` (flags: pay, scan, insights, bills, members,
   integrations, experience mode), then the Pay sheet (USSD directory first).
   The same endpoint drives which More/Settings rows show.
3. **Spaces: full switcher now.** Required design (verified in
   `web/lib/queries.ts:880`): the web picks the active Space from the
   `active_workspace_id` **cookie**, validated against an active
   `workspace_memberships` row, falling back to the personal Space. Mobile has no
   cookie. Build:
   - a per-request header `X-Workspace-Id` read by `web/lib/mobile-request.ts`,
     stored in `mobile-session-context.ts`, and honoured by
     `getActiveWorkspaceId()` when no cookie exists (same membership check, same
     personal fallback). Never trust the header without the membership check.
   - app: `ActiveSpaceProvider` (persisted choice, SecureStore/AsyncStorage per
     AGENTS.md), `GET` the Space list from `workspace_memberships` joined to
     `workspaces` (name, kind: personal / household / organization), and a
     **workspace filter on every direct Supabase query** in
     `src/features/*/queries.ts` (today they have none and rely on RLS across all
     memberships, which mixes Spaces once the user is in several; confirm against
     the web's per-query workspace filtering before choosing `.eq("workspace_id", …)`).
   - switcher UI as in the profile menu: Personal, households, organizations with
     kind tags, "Create a Space" (native create form; see step 10).
   - invalidate every cached query on switch; re-register push per Space if needed.
   - Household-only surfaces appear when the active Space is a household: Home
     Space-spending card, attribution on detail, Review queue attributions.
   - This changes the data contract of every step: do it as **Step 1b, right
     after the shell**, before Home/Transactions work, so the rest builds on it.
4. **Build native, no "open the web" fallbacks in v1.** Every item previously
   marked "open the web" (Transfers, splits, attribution, tags, Reports,
   Categories + rules, Settings groups, Integrations, Connections & devices,
   Import a statement, Budget create/edit, Goals, Bills, Space & members) becomes
   a native screen. Treat this as a multi-release program. Order after Steps 1-8:
   10 Spaces & members (create, invite, roles) · 11 Settings group screens ·
   12 Categories + rules + insights · 13 Reports + statements · 14 Budgets
   create/edit + Goals · 15 Bills · 16 Transfers, splits, attribution, tags ·
   17 Integrations/Connections & devices/Import · 18 Pay (v2). Each needs its
   data path chosen per ground rule 1 and its web server action mapped to an RPC
   or a new mobile route. Mutations that are only server actions on the web need
   new authenticated `POST /api/mobile/...` routes with MFA + rate limiting, not
   Supabase-direct shortcuts, unless an RPC with membership checks already
   exists.

### 1.2 (superseded by 1.3) Product decisions that were proposed

1. Mirror the web bar (Home · Transactions · Pay · Plan · More, Inbox in header)?
   Recommended: yes, with Pay as a **disabled-looking placeholder is NOT allowed**;
   either ship the Pay sheet (it only prepares USSD codes) or hide the slot.
2. Space switching: the app reads personal-workspace data only (bearer routes and
   direct queries have no workspace filter), so a switcher needs a design pass.
   Recommended: show the current Space name read-only in v1.
3. Which "open the web" fallbacks are acceptable for v1 (Transfers, splits,
   attribution, Integrations, Reports).

## 2. Ground rules (apply to every step)

1. **Data path decision per feature.** Two paths exist and nothing else:
   - **Direct Supabase under RLS** via `src/features/*/queries.ts` (what Home,
     Transactions, detail, notifications, category changes use). Web server
     actions are Next.js actions; the app cannot call them. Port the
     underlying query or RPC instead (see `src/features/review/actions.ts`,
     which calls the same RPCs the web actions call).
   - **A new read-only `GET /api/mobile/<name>` route** in `web/app/api/mobile/`
     wrapping the existing web read model with `mobileGet(request, "<name>", …)`
     from `web/lib/mobile-request.ts`. It is dark unless `MOBILE_API_ENABLED=true`
     and returns 404 otherwise. Document it in `docs/mobile-api.md`, add a
     parser + test under `src/features/<name>/parse.ts` like
     `features/inbox/parse.ts`. Use this when the web read model uses the
     service role, cross-domain aggregation, or feature flags
     (`getFinancialInbox`, `getAttentionItems`, `getHouseholdSpendingBreakdown`).
   Caveat: bearer requests have no cookie, so the active Space is the user's
   personal workspace (docs/mobile-api.md).
2. **Never hardcode hex.** Use `colors`, `space`, `radii` from `src/theme/tokens.ts`.
   Add missing tokens in `web/app/globals.css` and `tokens.ts` in the same PR.
3. **Money rules (copy exactly).** Outgoing money is NOT red: primary-text
   colour with a "−" sign. Incoming is `moneyPositive` with "+". Zero is
   `textMuted`. Sign always present. Masked amounts render "••••••" and the
   real value must never reach an accessibility label.
4. **Masking.** Home masks via privacy mode; Transactions and detail are never
   masked ("deliberate destination").
5. **Touch targets** ≥ 44 (`MIN_TOUCH_TARGET`). Safe-area aware bottom bar.
6. **Every screen has four states:** loading, empty, error-with-retry, data.
   Copy below is the web's wording; keep it.
7. **Icons.** The web has its own SVG set (`web/components/icons.tsx`); the app
   uses Feather. Keep Feather and map: Home→home, Transactions→list,
   Inbox→inbox, Plan→target, More→menu, Eye→eye/eye-off, Notifications→bell,
   Categories→tag, Reports→file-text, Sources→link, Bills→file (receipt),
   Members→users, Settings→settings, Integrations→grid, Developer→code,
   USSD→phone, Recipients→shield, Templates→bookmark, Profile→user.
8. One PR per step below, each independently shippable, each with unit tests for
   pure logic (`display.ts` / `parse.ts` style) and a note of what was verified
   on a real device vs not.

## 3. Broken now (fix first)

### 3.1 Inbox says "Couldn't load your inbox. Check your connection and try again."

What is proven: an unauthenticated `curl` to `/api/mobile/inbox` and
`/api/mobile/budgets` returns **401 `{"ok":false,"error":"unauthorized"}` as
JSON**, so both routes are deployed, the `MOBILE_API_ENABLED` flag is on, and
`web/proxy.ts` does not intercept `api/mobile/` (excluded in its matcher). The
failure is therefore with the **authenticated** call. `parseInboxResponse`
(`src/features/inbox/parse.ts`) returns the exact on-screen sentence ("Couldn't
load your inbox. Check your connection and try again.") for: any status other
than 200/404/401/403 (500 `server_error`, 429 `rate_limited`, 5xx), **and also**
a 200 whose body is non-JSON or has `ok !== true`. A 404 would have shown the
`ReviewList` fallback, a dropped connection says "the full inbox", and a
malformed 200 body says "wasn't understood". The same web read model renders
fine on the site for this account (49 items, mostly payment reconciliation), so
the suspect is the bearer-only request context, not the data.

Most likely: `getFinancialInbox()` throws when run under the bearer-only session
(`runWithMobileSession` in `web/lib/mobile-session-context.ts`), for example a
code path that reads the cookie/active-workspace, or one of the cross-domain
read models failing; the route swallows the error (`catch { 500 }`).

Do this, in order:
1. Vercel runtime logs for `/api/mobile/inbox` on the production project
   (Vercel MCP `get_runtime_errors` / `get_runtime_logs`, or the dashboard).
   Find the real exception.
2. Reproduce locally: call the handler with a real access token, log the
   caught error in `web/lib/mobile-request.ts` (message only, never the token or
   body), fix the read model so it works without a cookie.
3. Make the app degrade instead of dead-ending: in `inbox.tsx`, treat
   `reason: "error"` like `"unavailable"` (show the direct `ReviewList` with a
   small "Showing category checks only" note plus a Retry), so the tab is never
   empty when the server hiccups.
4. Same check for `/api/mobile/budgets`: Home shows no budget card in the
   screenshot; confirm that's "no active budget" and not the same 500 swallowed
   (`features/budgets` + Home ignore failures silently by design).

### 3.2 Shortcuts step: "One-tap setup isn't available yet. The Shortcuts haven't been published"

`src/app/(app)/shortcuts.tsx:138` sets `hasLinks = config.connectShortcutUrl !== ""`.
(Confirmed in code: the "isn't available yet" notice is the `!hasLinks` branch.)
`EXPO_PUBLIC_MOMO_SHORTCUT_URL` (and optionally
`EXPO_PUBLIC_MOMO_CAPTURE_SHORTCUT_URL`) is unset in the build's `eas.json`
env. This is **configuration, not a code bug**: publish the iCloud Shortcut
links (docs/momo-shortcut-setup.md, docs/oneledger-capture-shortcut.md), add
them to the build profile env, rebuild. Optionally add a clear in-app fallback
(the manual steps) so the wizard is usable without the links.

## 4. Step 1: App shell (header + 4-slot bottom bar)

Web reference: `web/components/AppShell.tsx`, `web/lib/navigation.ts`,
`ProfileMenu.tsx`, `InboxButton.tsx`, `ReportsButton.tsx`, `MoreSheet.tsx`.

Build:
- `src/components/shell/AppHeader.tsx`, shown on the four tab roots only (not
  on pushed detail screens, which keep their own Back). Layout: left = brand
  mark (use `assets` logo from `brand-source/`, 28px) → taps Home; right = Inbox
  icon button (44×44, round) with red count badge, Reports icon (opens Reports,
  step 9), profile icon. Border-bottom `borderSubtle`, surface background.
- Badge: `colors.notificationBadge` bg, white 10px text, "99+" cap, min 16px.
  Count = unread notifications + open attention rows (web `inboxBadgeCount`).
  Respect `ui_preferences.show_inbox_badge` (0 when off). Accessible label:
  "Inbox, N items need your attention" / "Inbox".
- Profile menu: signed-in email, current Space name (read-only in v1; see 1.2),
  Settings, Appearance and navigation, Privacy and security (these open the web
  or native screens per step 8), Sign out (last). Close on outside tap/back.
- Tab bar: Home · Transactions · (Pay) · Plan · More. Add a `plan` tab showing the
  Budget screen (Step 7). Hide `inbox` from the bar and open it from the header
  icon. **Expo Router's way to hide a tab (`href: null`, or `tabBarButton`) is from
  memory: verify against the docs for the installed Expo SDK before using it**
  (AGENTS.md rule). Keep `More` highlighted for routes under settings /
  categories / reports / bills / pay (`MORE_MENU_PREFIXES`).
- Pay: live on the web for this account, but its availability is a flag the app
  cannot read yet. Proposal: v1 ships without the centre slot; v2 adds a tiny
  `GET /api/mobile/config` returning `{ payEnabled, scanEnabled, insightsEnabled,
  billsEnabled, ... }` and the app renders the Pay sheet (USSD directory first).
  Never render a Pay button that does nothing.
- Data paths for the header: badge count = unread notifications (direct Supabase
  `notifications` read, already in `features/notifications/queries.ts`) + open
  attention rows (only available from `getAttentionItems`: add
  `attentionCount` to the Inbox endpoint response, or fall back to the Inbox
  `total`). `show_inbox_badge` lives in `ui_preferences`: read/update it via
  Supabase if RLS allows, otherwise add `GET/PATCH /api/mobile/preferences`.
- Keep first-run/onboarding routes chrome-free (web hides header and bar there).

Acceptance: header + bar appear on Home/Transactions/Plan/More; Inbox badge
matches web for the same account; no layout shift on tab change.

## 5. Step 2: Home (`(tabs)/index.tsx`)

Web reference: `web/app/page.tsx`, `BalanceCard.tsx`, `SummaryMetric.tsx`,
`BudgetStatusCard.tsx`, `DashboardTransactionItem.tsx`. Order on phone:

1. (Households only) Space name `h1` + `HouseholdSpendingCard`. Needs a new
   `/api/mobile/household-spending` (reads `getHouseholdSpendingBreakdown`).
2. First-run card (checklist / first review / first insight): **skip in v1**,
   flagged (`ONBOARDING_JOURNEY_ENABLED`).
   **Phone order observed live: balance → tiles → Budget status → Insights →
   Recent transactions** (the budget card sits right under the tiles, not beside
   them as on desktop).
3. **Balance card**: full-width, `accent` background, `accentForeground` text,
   radius `card`, padding 24×28. Top row: "Current balance" (80% opacity) and a
   44×44 eye button (eye / eye-off) **on the card** (replace the page-header
   text button). Amount: 36–48px semibold tabular, "••••••" when masked,
   "—" when null. Footer row: "MTN Mobile Money" left; "Updated {Today|Yesterday|Mon D},
   {HH:mm}" right (never masked; Kigali time). The eye is disabled with the
   label "Balance hidden by full privacy mode" when full privacy mode is on.
   On the web the toggle **persists** (saved preference). The app's
   `PrivacyProvider` is **in-memory only** (its own comment says persistence "arrives
   with settings"), so persist it (SecureStore/AsyncStorage per AGENTS.md package
   rules, or the same `ui_preferences` field the web uses).
4. **Two tiles**, 2 columns: "Received today" and "Spent today" (rename from
   In/Out). Spent is shown negative (`−3,420 RWF`). Masked by dashboard mask.
5. **Budget status card** (only if an active budget exists; omit otherwise):
   header "BUDGET STATUS" (uppercase 12px muted) + badge; 6px progress bar;
   "{used} of {target} used"; large "Remaining" (or "Over by"); right "N days
   left" / "1 day left" / "Last day". Whole card taps to the budget. Badge copy:
   healthy "On track", watch "Approaching limit", at_risk "Near limit",
   exceeded "Over budget", insufficient_data "Not enough data". **Never red.**
6. **Insights card** (this account has it; allowlist-gated): needs a new
   `GET /api/mobile/insights` wrapping `getIntelligenceInsights()` and flag
   reporting. v2. Contents are listed in 1.1.
7. **Recent transactions** card: header "RECENT TRANSACTIONS" + "See all" link;
   6 rows with date+time; empty state "No transactions yet / New MoMo
   transactions will appear here automatically."
- Keep the app-specific cards (recording needs setup, review count) but place
  them **below** the web order, since they have no web equivalent on Home.

Acceptance: side-by-side with web at 390px, same order, same copy, balance card
blue with eye on the card.

## 6. Step 3: Transactions (`(tabs)/transactions.tsx`)

Web reference: `web/app/transactions/page.tsx`, `TransactionSearchBar.tsx`,
`LifetimeFlowBadge.tsx`, `TransactionList.tsx`, `TransactionItem.tsx`.

- Header actions: "Review queue (n)" link (count from `getReviewQueueCount`),
  "Transfers" link (open web for v1), "Add transaction" primary button
  (already built: `add-transaction.tsx`; rename "Add" → "Add transaction" or
  keep compact on small widths).
- **Lifetime chips** under the header, hidden when there are 0 transactions:
  two pill chips, `lifetimeBadgeBg` (#f5c518) with `lifetimeBadgeText`, 12px
  semibold tabular amount + circled "i" (14px). Tap "i" → popover text:
  "Total money sent through OneLedger since your account was created on
  DD/MM/YYYY." and the same for received. First chip = sent, second = received.
  Data (read in `web/lib/queries.ts:178`): one `transactions` select of
  `direction, principal_effect_rwf, fee_effect_rwf` with `settlement_state =
  'settled'` and `dedupe_state != 'merged'`, plus `auth.getUser().created_at`.
  Sent = Σ|principal+fee| for out; received = Σ(principal+fee) for in; count
  excludes neutral rows. Plain RLS query: **port directly with supabase-js, no
  new endpoint**. Live values for this account: 3,830,678 sent / 28,950,556
  received (use as an acceptance check). Page through rows if > 1000.
- **Search + Filters:** the search box stays (placeholder: "Search by name,
  reference or category" on web; the app's shorter text is fine). Add a
  **Filters** button toggling a panel: Direction (Any / Money out / Money in /
  Neutral), Account (Any account + accounts with a financial source), Currency
  (only if >1 currency), Min and Max amount (RWF, whole numbers ≥ 0). Show
  "Showing the first 100 matches" / "N match(es)" when any filter is active
  and "Clear search & filters". Page size is 50 in the app (web 100); keep 50 with
  "Show more".
- Row: name (14px medium), meta line = time · category (or "Uncategorized"
  badge), "Failed" badge, "Review" badge when category decision status is
  provisional/suggested/conflict. Amount right, signed, 0 for failed. This
  already matches (`features/transactions/TransactionItem.tsx`).
- Empty copy: with filters "No transactions match your search"; otherwise "No
  transactions yet". Group headers uppercase 12px muted: Today / Yesterday /
  "November 13".
- Category-filtered view (`?category=`): title becomes the category with a
  "Clear filter" link; needed for Step 8 (Categories).

## 7. Step 4: Transaction detail (`transaction/[id].tsx`)

Web reference: `web/app/transactions/[id]/page.tsx` (read to line 200; the order
below is the **live order** from 1.1: hero → Pay again → Where this came from →
Amount/Direction/Balance after/Type → Category → Tags → Budget allocation). Code
order of the remaining blocks (duplicates, attribution, splits, history) was not
read past line 200: check the file before building them. Original notes:
1. Centred card: counterparty, big signed amount (xl), full date-time, Failed badge.
2. **"Pay {name} again"** primary button (only when assisted Pay is enabled and
   the type has a reusable target). Defer with Pay.
3. Pay-link card, household attribution warning, duplicate section.
4. Category (`CategoryCorrectionForm`), splits (outgoing + settled + supported
   currency only), attribution panel (households), tags, history.
- App today has the data rows + "Change category" + "Edit on the web". Bring the
  hero card to the web's centred layout, then add in order: duplicates
  (`dismiss_possible_duplicate`, `merge_duplicate_transaction` RPCs already wired),
  tags, category history. Splits and attribution: open the web (`Edit on the web`).

## 8. Step 5: Inbox (`(tabs)/inbox.tsx`, opened from the header icon)

Web reference: `web/app/inbox/page.tsx`, `InboxList.tsx`, `NotificationList.tsx`,
`AttentionItemsCard.tsx`, `ds/ActionRequiredItem`, `docs/financial-inbox.md`.
After fixing 3.1:
- "← Home" back link, title "Inbox", subtitle "One prioritized place for every
  decision and problem across your ledger".
- Attention card (if any), forecast link card **[CONFIRM LIVE]** (flagged:
  "Cash-flow forecast / Your 30-day outlook, recurring payments and spending
  baseline →"), Notifications section (latest 8, "View all", grouped by title with
  "Show N earlier"), summary tiles (Open / Resolve first / Next up), then groups
  with headings "Resolve first (n)", "Next up (n)", "When ready (n)". More than
  4 same-kind items with the same drill-in collapse to one card "{Kind} (n)" with
  "Review all n". Empty: "You're all caught up".
- Inline actions the app can run itself stay as built (confirm/dismiss category,
  dismiss/merge duplicate). Others open the web item.
- "Show inbox badge" toggle at the bottom (`ui_preferences.show_inbox_badge`).

## 9. Step 6: Notifications

`web/app/notifications/page.tsx`, `NotificationList.tsx`. Deep links per
`resourceType`: workspace→settings/workspace, budget→budgets, goal→goal,
transaction→its detail. "Mark read" / "Mark all read". The app's
`notifications.tsx` exists; align grouping and links.

## 10. Step 7: Plan tab (Budgets)

`web/app/budgets/page.tsx`: title "Budgets", subtitle "Your 50/15/5/30 budgets,
from draft to archived"; actions Goals, Categories, New budget; list of cards
(name + status badge, "{start} – {end}", "{monthly income} / month"); empty "No
budgets yet / Create a budget to start planning with the 50/15/5/30 model.".
Today the app shows only the active budget via `/api/mobile/budgets`. Make the
Plan tab the budget screen; Goals/Categories/New budget open the web for v1.

## 11. Step 8: More sheet and Settings

`web/lib/navigation.ts` (`MORE_GROUPS`), `MoreSheet.tsx`, `web/lib/settings-navigation.ts`.
Live, this account's sheet is a bottom sheet with a "Close" button, group
captions in small uppercase, and rows = leading icon + label (no chevron seen).
Groups/rows hide per experience mode and flags (Bills, Space & members and
Advanced are absent for this account), so the list must come from data or a
config endpoint, not be hardcoded. Rebuild `(tabs)/more.tsx` as grouped rows:
- **Manage money:** Categories, Reports, Connected sources, Bills
- **This Space:** Space & members
- **Account:** Settings, Notifications
- **Advanced:** Integrations, Developer platform **[CONFIRM LIVE, flagged]**
- **Pay & Services:** USSD directory, Trusted recipients, Payment templates **[flagged, defer]**
Keep the app-only items (Automatic recording status, Phone alerts toggle, App
lock, Sign out) in a "This phone" group at the bottom. Settings groups (each row
= title + one-line description): Profile & Preferences, Accounts & Connections,
Spaces & Members, Reports & Notifications, Data & Integrations, Security &
Privacy, Billing & Plan. For v1 rows open the web; build native screens only for
Notifications, Security (exists), Privacy toggle.

## 12. Step 9: Categories and Reports (after the above)

Categories (`/categories`, `/categories/rules`, `/categories/insights`) and
Reports (`/reports`, statements) are read-heavy; start with Categories totals
list → taps into Transactions filtered by category. Reports: open web in v1.

## 13. Out of scope (inventory only)

Integrations (connections, imports, exports, reconciliation, marketplace,
sync, developer), Pay (suggest, recipients, templates, USSD, activity, scan to
pay), onboarding wizard, admin, billing, invite/verify flows, MFA setup. All
open the web or stay dark.

## 14. Suggested PR order

1. Fix 3.1 (server) + degrade gracefully (app); 3.2 (config).
2. Step 1 shell. 3. Step 2 Home. 4. Step 3 Transactions (chips, filters).
5. Step 5 Inbox polish + notifications section. 6. Step 4 detail.
7. Step 7 Plan. 8. Step 8 More/Settings. 9. Step 9.

Each PR description: the web file(s) it mirrors, data path used (Supabase vs new
mobile route), screenshots at 390px next to the web, and what was verified on a
real iPhone.
