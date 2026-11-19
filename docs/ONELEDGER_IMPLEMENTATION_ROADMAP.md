# OneLedger implementation roadmap

Baseline: **2026-11-18, main `36ad79b`**. Planning only. Dependencies refer to findings in the [current-state audit](ONELEDGER_CURRENT_STATE_AUDIT.md), capabilities in the [parity matrix](ONELEDGER_WEB_MOBILE_PARITY_MATRIX.md), and the [UI/UX assessment](ONELEDGER_UI_UX_ASSESSMENT.md).

## Execution rules

Refresh main, working-tree state, open PR heads/reviews/checks and deployed versions before starting a stage. Preserve unrelated local files and linked worktrees. Reuse open fixes rather than creating competing implementations. Final metadata shows #281 already merged remotely as `91baf55`; the local audit baseline predates it. Verify that work instead of opening another balance-policy fix. #282 now targets main; #283–#287 require refreshed mergeability/conflict checks, including #283's migration identifier against #281. PR descriptions must record exact baseline, data/contract compatibility, tests actually run and remaining deployment/device evidence.

Each numbered slice below is a small independently testable PR or explicitly separated PR pair. Do not combine security migrations, visual redesign and unrelated feature expansion. Database evolution is additive/forward-only; preserve old RPC signatures and old app behavior until a versioned replacement is proven. Assessment authorization is not deployment or merge authorization.

Priorities: **P0** blocks rollout of affected data/security scope; **P1** repairs core correctness/workflows; **P2** completes parity/design; **P3** expands only approved scope. No calendar estimate is reliable until hosted/device dependencies and actual owner availability are confirmed. Roles below are proposed responsibilities, not assignments to named people.

## Stage 0 — Establish reproducible evidence (P1)

| Slice | Change / owner | Dependencies | Tests and acceptance | Compatibility / rollback |
|---|---|---|---|---|
| 0.1 Build baseline | Release engineer: isolate a clean checkout; install lockfiles, regenerate framework route types; classify F11. Avoid altering dependency pins to make stale caches pass. | Current main and required framework docs; no hosted writes | Web lint/typecheck/build; native lint/typecheck/Jest; Expo compatibility check; record missing-dependency versus source errors. Current 1062/311/972/953 passing baselines remain visible. | Isolated build artifacts only; discard isolated environment if unsuccessful. |
| 0.2 Deployment/config ledger | Release engineer: read-only inventory of web SHA, applied migration identifiers, function revisions, EAS build SHA/version, flag/allowlist presence and scheduler health. Record sanitized boolean/status evidence. | Authorized connected project access; no secrets in docs | Show code/deployment mismatches explicitly; distinguish pending PRs from deployed features. Verify published Shortcuts and push setup status without creating payments. | Documentation only; no environment updates. |
| 0.3 Test fixture contract | Product + engineering: one golden dataset covering two Spaces, shared/private sources, roles, wallets/currencies and financial states. | Disposable test stack | Hand-computed expected totals and allowed reads; include >1,000 rows, lost response, revoked share and period boundary cases. | Test-only fixtures; never seed production. |

## Stage 1 — Privacy and financial integrity before rollout

| Slice | Change / owner | Dependencies | Tests and acceptance | Compatibility / rollback |
|---|---|---|---|---|
| 1.1 (P0) Balance source visibility verification | Backend security reviewer: verify remotely merged [#281](https://github.com/cybersafehills/personal-finance-engine/pull/281), F01, and deployment; no duplicate implementation PR. | Refresh actual `91baf55` merged diff and checks | PG17 complete chain plus household shared/private read/write/paused-share/guessed-ID tests. Hidden account and absent account indistinguishable. | Policy/function-only additive migration, no data rewrite. Do not roll back to weaker privacy as an operational shortcut; disable affected rollout while correcting forward. |
| 1.2 (P0) Counterparty source visibility | Backend security reviewer: reuse [#282](https://github.com/cybersafehills/personal-finance-engine/pull/282), F02. | 1.1; base now main, refresh current head/checks | Private-only identity/phone/events hidden; merge/split/undo denied for invisible participants; visible summaries still work; two-user HTTP journey as well as SQL. | Keep correction event history; shared helper/grant changes tested. |
| 1.3 (P1) Web active Space | Web engineer: review [#285](https://github.com/cybersafehills/personal-finance-engine/pull/285). | Golden multi-Space fixture | Every listed query/totals/budget/goals/account and legacy balance fallback obey selected Space; unresolved selection returns safe unavailable/empty state. | No schema rewrite. By-ID cross-Space access policy explicitly documented. |
| 1.4 (P1) Native active Space | Mobile engineer: pass validated selected scope into direct repositories and local SQL; key data by user/Space, clear stale context. | 1.3 contract; F03/F14 | Online/local list, Home, goals, requests, account picker, badge and totals; failed/slow switch never displays old-Space data under new label. | Add indexed filters without changing existing row IDs; mixed app versions can still use old APIs until retired. |
| 1.5 (P0) Shared offline visibility | Backend + mobile: define revocation/retention policy, then implement visibility reconciliation/tombstones/authorization lease, F04. Keep this rollout blocked until proven. | 1.1/1.2; product decision on offline retention | Download shared data, revoke membership/share, move/delete transaction; reconnect removes from list/detail/aggregates. A forever-offline device follows documented lease policy. Personal unsynced work retained. | Add versioned sync metadata; older clients cannot be assumed safe. Plan affected-client rollout/version restriction explicitly. A client opt-out does not delete previously cached data. |
| 1.6 (P0 non-RWF) Currency contract | Financial-domain engineer: currency-tagged minor units through legacy/natively displayed ledger and aggregates, F06. | Golden currency fixtures; supported currency registry | RWF integer, USD/EUR scale-2 exact amounts; no currency mixing; oversized values refused or represented safely; formatter/accessibility parity. | Preserve stored legacy columns/data; adapt at boundaries. No inferred FX conversion or destructive renaming. |
| 1.7 (P1) Transfer semantics | Financial-domain engineer: reuse [#283](https://github.com/cybersafehills/personal-finance-engine/pull/283), resolve overlap with #285, add native self-kind compatibility and linked-transfer feed. | 1.3/1.4/1.6; approved principal/fee policy | Linked/unlinked/self-merged counterparties, reversed/failed rows; all Home/budget/report/Insights/forecast totals agree, balance effects preserved, undo restores. | Versioned enums or backwards-compatible parser; migration identifiers reviewed for collisions with #281. No mass recategorization. |
| 1.8 (P1) Complete aggregates and explicit read failure | Backend/web: page or aggregate actual PostgREST reads; stop using zeros/empty transfer sets as success, F07/F13. | Scoped/currency semantics | 999/1000/1001/>20k fixtures, transfer-link read failure, partial pages and stable ordering; unavailable/truncated data clearly reported. | Preserve endpoint shapes where possible; add explicit coverage/freshness fields with safe older-client defaults. |
| 1.9 (P1) Identity verification and assurance guards | API/security engineer: real bearer endpoint verification and direct-RPC AAL/source policy, F10. F09 historical SDK explanation was not reproduced; do not create an identity refactor without new evidence. | Existing Auth/SQL permission model | No-cookie real-token calls to every mobile endpoint; enrolled MFA AAL1 denied sensitive operations, AAL2 allowed; viewer/removed/hidden-source denied through direct RPC too. | Preserve safe manual-paid/verified distinction. Tightened permissions may surface explicit denial in old apps; document upgrade requirements. |

Stage exit: no unresolved confirmed P0 in the intended rollout scope, golden financial totals agree, and negative permission tests exercise direct APIs/RPCs rather than only UI visibility. A passing broad migration suite alone does not satisfy this gate.

## Stage 2 — Complete the existing native core (P1/P2)

| Slice | Change / owner | Dependencies | Tests and acceptance | Compatibility / rollback |
|---|---|---|---|---|
| 2.1 (P1) Offline Home and sync lifecycle | Mobile: separate network-only widgets, scope/cancel workers per user/DB, prevent false complete at cap, improve key/open-error recovery; F08/F16. | Stage 1 scope and visibility protocol | Cold airplane-mode launch, process kill, lost acknowledgment, rapid user switch during push/pull, late commit and max-page tests; no wrong-user upload or silent pending-data discard. | Keep op IDs and conflict history stable; additive local schema upgrades transactional; test old DB upgrade. |
| 2.2 (P1) Wallet/Home parity and privacy | Mobile: reuse server provenance model in native Home, wallet selection/default/add as separate small PRs; persist privacy and cover raw/accessibility amounts. | 1.6 and 1.9; product mask policy | Multiwallet/no baseline/stale/manual/provider/mismatch cases; normal/full privacy across relaunch; hidden value absent from reader tree. | Keep older Wallets endpoint supported; avoid replacing provider balances with local estimates. |
| 2.3 (P1) Inbox and pay workflow closure | Mobile + backend: finish native decisions in priority order; coherent errors/config gates; activity/status return flow. | 1.9; per-domain capabilities | Every visible Inbox action has real completion or labelled browser path; double taps idempotent; dial/copy/return never settles intent; cancellation/timeouts tested. | Reuse existing intents/state machine/reconciliation; no new provider payment product. |
| 2.4 (P2) Ledger filters and splits | Mobile: account/currency/amount/neutral filtering, then split editor; each can ship separately. | 1.4/1.6/1.8 | Filter paging/reset exact; split sum/remainder/fee/currency and allocation totals reconcile. | Reuse existing split contract; no transaction duplication. |
| 2.5 (P2) Budget lifecycle | Mobile/API: list states first, create/edit allocations next, then activate/archive/duplicate/rollover. | Stage 1 financial contract | Same acceptance as web budget rollover and hand-computed allocations, viewer denied, repeat submit safe. | Reuse budget domain functions rather than copy calculation into RN. |
| 2.6 (P2) Goal contributions | Mobile/API: native create/contribute/remove/archive, then participant editing if required. | 1.4, goal capability contract | Contribution exactness and history, target reached, sparse pace, role denials, idempotent/repeat actions defined. | SQL progress remains authoritative; retain existing goal IDs. |
| 2.7 (P2) Category/rule authoring | Web: review [#284](https://github.com/cybersafehills/personal-finance-engine/pull/284). Mobile: category management, then authoring/preview/history in separate slices. | #283 history exclusions; scoped categorization | >500 uncategorized transactions; preview/apply approval; deterministic precedence and source-specific rules; toggle readback preserved. | No automatic application from starter proposals; preserve rule audit history. |
| 2.8 (P2) Analysis/documents | Mobile: native forecast read model; statement generation/job tracking; bill upload/review only after capability review, each separate PR. | Proven scoped aggregates, functioning workers/credentials | Same financial facts as web; document extraction remains unverified until approved; original URL fresh/audited; one approved posting. | Keep existing download/read paths; no bypass of document/ledger separation. |
| 2.9 (P2) Settings and link continuity | Mobile: persist native privacy/preferences; prioritize profile/region/report schedule; deep-link signup/reset/invite continuity. | Product scope; Auth redirects and fresh assurance | Each Settings row has truthful destination, browser reauth explained, no token in URL, return preserves Space; export/deletion discoverable. | Existing browser workflows stay usable during incremental native adoption. |

## Stage 3 — Shared design refinement (P2)

1. **3.1 DS contract:** extend amount/status/state primitives for currency, privacy, provenance and freshness; document web/native token mapping and state terminology. Preserve approved brand assets. Test accessibility and the financial examples from Stage 1.
2. **3.2 Density and Pay sheet:** review existing [#286](https://github.com/cybersafehills/personal-finance-engine/pull/286) against real iOS/Android and largest text. Native sheet/back/focus and target sizes must work; do not accept 1.25x text caps solely to resemble the web. Ship DS density separately from other screen rewrites where practical.
3. **3.3 Native navigation:** replace repeated Back chrome incrementally with native headers/gestures, safe areas and keyboard behavior. Tests cover pushed deep links, dirty forms, sheets and OS back independently.
4. **3.4 Reference journeys and performance:** fresh same-fixture screenshots/reader walkthroughs for Home/list/detail/Pay/Plan/Inbox/settings; measure cold/warm/offline launch, 5k-row scrolling and Space switching. Optimize measured bottlenecks, including goals N+1 and local balance full scans.

Stage exit: coherent hierarchy and language, no clipped sign/currency at larger text, no hidden amounts in assistive output, no inaccessible modal/back path, keyboard/axe checks on web and VoiceOver/TalkBack evidence. Keep native conventions; pixel-identical surfaces are not the objective.

## Stage 4 — Reliable offline expansion (P2/P3)

Do not expand offline storage to additional shared entities until Stage 1.5 and Stage 2.1 establish visibility, lifecycle and error guarantees.

| Slice | Scope | Preconditions and acceptance |
|---|---|---|
| 4.1 Read completeness and reconciliation | Per-entity full rescan/reconcile and cursor/late-commit recovery | Lost/deleted/hidden rows handled, cap never means complete, resumable long catch-up; pending edits never silently overwritten. |
| 4.2 Budget/goal read snapshots | Dated read-only cached plans and goals | Explicit stale/coverage labels, revoked data evicted, no offline entitlement granted from cached state. |
| 4.3 One write entity at a time | Only approved budget/goal edits | Stable op IDs, atomic outbox, field-level conflict policy, dependencies, permission changes and rollback tested on both native platforms. |
| 4.4 Recovery and support | Queue diagnostics, storage/key/full-disk handling | No payload/secret logs; export/recovery decision for pending work; deliberate discard confirmation; account erasure and sign-out policies coherent. |

Server/provider balances, payment initiation authority, settlement and security capabilities remain authoritative server/provider facts. Do not duplicate SMS parsing into local ledger writes: the native capture queue and server parser already own that path.

## Stage 5 — Release and approved extensions

**5.1 Android release proof (P1):** install a generated SQLCipher-enabled build; verify notification listener with app/JS killed, reboot and OEM restrictions; push/QR/biometric/offline journeys. Test legacy companion upgrade/signing and pending-queue/credential handling before retiring its release channel.

**5.2 iOS release proof (P1):** verify actual enrollment/signing status, device/TestFlight build, APNs/links, user-approved Shortcuts installation/pair/automation, local encrypted DB, biometric/background cover and reader journeys. The shared TS app is not an iOS release certificate.

**5.3 Operations (P1):** verify report/statement/capture/reconciliation/push/integration schedulers with observable success/retry/failure ownership. Compare deployment SHA/schema/function versions and consumer flags. Promote Safari functional smoke to required only after known failures are resolved; add independent native critical-journey coverage, not a renamed mobile browser project.

**5.4 Provider integration (P3):** choose one explicitly required accounting/cloud/workbook provider, then implement real sandbox read/write/revision/refresh/conflict tests. Stubbed adapter operations and OAuth configuration are not completed sync. Preserve safe export and manual-file functionality.

**5.5 Fee intelligence (P3):** review [#287](https://github.com/cybersafehills/personal-finance-engine/pull/287) only within documented scope. Require source-attributed validity windows and honest unknowns before enabling. A native screen is a later requirement decision; do not introduce automated split transfers or pretend provider tariffs exist.

## Final release acceptance and evidence bundle

- Full migration chain and adversarial role/source/AAL tests pass on disposable PG17; old-client RPC compatibility checked.
- Clean web/mobile builds, unit suites and scoped HTTP end-to-end journeys pass; actual failing/skipped checks recorded, not replaced by historical totals.
- Golden totals match by currency/Space/wallet across current web and independently installed iOS/Android, including >1,000 rows and own transfers.
- Offline save/replay/conflict/revocation/account-switch/key/full-disk scenarios demonstrated with no duplicate financial effects or residual unauthorized shared reads under the agreed policy.
- Android capture and iOS Shortcut journeys produce one server-processed record; provider handoff remains pending until correct evidence. No user PIN/OTP collection introduced.
- Fresh accessibility, responsive and device screenshots/traces include app/web SHA, device/OS, flags and test fixture; approved identity retained.
- Release owner records hosted migration/function/web versions, EAS build identifiers, credential/scheduler readiness and rollback/roll-forward procedure. Monitoring contains safe codes/counts, never tokens, raw payment messages or private values.

Unresolved production state, release signing, provider capabilities and retention requirements are tracked questions, not assumed completed work. Further implementation, migrations and deployment must proceed as separate reviewable tasks after this foundation.
