# Phase 1 implementation handover

Status: **partially complete, locally implemented and automated checks passing with explicit external gates**. Evidence date 2026-11-19. Start with [release verification](release-verification.md), [financial contract](financial-contract.md), [security verification](security-verification.md) and [offline contract](offline-contract.md).

## 1. Repository baseline

Local branch `codex/phase1-foundation`, HEAD/base `24247b3`. Previous assessment at `36ad79b` is historical. Remote metadata refreshed without resetting/rebasing local work. Existing assessments were read and preserved. Applicable web/mobile AGENTS and architecture records guided implementation. No worktree deletion or unrelated file cleanup occurred.

Current inspected PR state: #281 balance visibility, #282 counterparty visibility, #283 own-account exclusion, #284 starter-history coverage and #286 density/Pay sheet are merged into the newer baseline. #285 scope (`ed800de` inspected head), #287 fee calculator, #288 self-kind repair (`d6ab649`) and #289 native headers (`35008be`) were open when inspected. Metadata can change after this observation.

Reuse: selected query and E2E files from #285, self-kind repair and associated migration guards from #288, without merging either PR. #287 fee feature and #289 headers deferred; no duplicate feature built. Existing #286 native sheets retained; font scaling caps were removed from reusable text primitives for accessibility. Migration 20270104000000 collision was retained as a historical exception with an exact-file allowlist, then repaired forward in 06. This does not automatically repair a hosted ledger.

## 2. Implementation summary

Corrected selected-Space reads and stale response handling, added shared currency/coverage calculations, guarded sensitive RPC execution, implemented approved seven-day shared offline leases and visibility reconciliation, retained pending data on database failure, and extended native Home/Wallets/privacy using existing services. Existing Kotlin capture, iOS Shortcuts, branding, main tabs, ingestion and settlement architecture were retained.

## 3. Review slices and evidence

| Slice | Principal files/contracts | Automated evidence | Status / remaining risk |
|---|---|---|---|
| 0.1 baseline | web/package.json, native package Jest config, metro.config.js | Clean lockfile install; lint/types/build/export/Doctor | Local pass; default Turbopack blocked by environment |
| 0.2 PR/hosted evidence | This log, release/security registers | Read-only Git/GitHub/Supabase/Vercel metadata | Live web/build/flags unknown |
| 1.1–1.2 source privacy | Existing 04/05, new 06, migration harness | Source/role/undo/tenant SQL assertions | Local; 05 not in observed hosted ledger |
| 1.3–1.4 Space | web/lib/queries.ts; native selected-space, repositories, useQuery, provider/root reset | Local cross-Space reads, reversed responses, failures, query types; imported E2E spec | HTTP E2E not run |
| 1.5 offline access | migration07 snapshots; offline/visibility.ts, schema v3 | Exact lease expiry, revoke/delete, pending quarantine, mid-pull revoke, cap/cancellation | User approved seven days; old-client rollout gate |
| 1.6–1.8 finance | shared/financial*, own-accounts, report-generation, Insights, amount/lifetime/Home primitives | 999/1000/1001/20001 pagination; currency/transfer/state vectors in Deno/Jest | Full seeded HTTP/device comparison pending; Insights fails closed beyond ceiling |
| 1.9 assurance | migration07 payment-request/helper/link and wallet guards | AAL1/AAL2, anonymous ACL, foreign IDs, owner/default/foreign mutation SQL | Real signed bearer endpoint tests pending |
| 2.1 sync/recovery/Home | transport, sync-engine, OfflineProvider, expo-db, balance, outbox | Originating bearer, cancelled worker, no destructive recovery, optional widget failure | Physical airplane-mode/restart/native error tests pending |
| 2.2 Wallets/Home | SelectedWallet, wallet actions/screen, Home | Currency parsing/display and scoped action tests; bundles/types | Workflow/device E2E and selection persistence failure UX incomplete |
| 3.1 primitives/privacy | PrivacyProvider, MoneyAmount, Text/Button/PrivatePressable | Per-user masking, full override, accessible label vectors | All-screen editable-field/privacy audit and real screen readers pending |
| 3.2 interaction | Existing sheet patterns retained, text scale cap removed | Native suite and export | Gestures/back/keyboard/unsaved forms/contrast/motion need devices |

Changes share foundational dependencies and remain uncommitted on one local integration branch. This table gives review order; it is not a claim that independent PRs have been created. Split coordinated migrations/shared contracts from dependent UI during review, preserving compatibility across intermediate deployments.

## 4. Financial and security validation

See the linked contracts for exact semantics. Shared amounts use RWF0/USD2/EUR2 scales and explicit codes; no FX. Own-account principal and fees are excluded from spending/income under existing web semantics but remain wallet movements. Unsettled/reversed/merged facts are excluded. Unsafe values/read failures cannot become fabricated totals. Server RLS remains authoritative; a workspace selector never grants access. Snapshot and new wallet grants are authenticated only. Direct PostgreSQL tests use synthetic JWT claims, not actual signed HTTP authentication.

## 5. Mobile parity improvements

Native Home offers selected-wallet/Space context, server-derived balance provenance, separate currency activity, wallet-scoped recent rows and sync freshness. Wallet selection persists per user/Space; new supported-wallet and atomic default actions complement existing wallet detail/manual observations. Household wallet sharing remains the existing explicit source-sharing flow. Wallet evidence can be cached encrypted and labeled stale within authorized access. Full and dashboard privacy persist per user; full masking overrides explicit visible amount props. No new replacement app or financial screen calculation engine was introduced.

Implemented does not mean device verified or deployed. Details/manual observations reuse existing routes; adding household sources, rich wallet lifecycle management, robust selection-save failure feedback, and complete screen-reader/privacy inspection remain partial. The parity matrix has a dated implementation addendum rather than rewriting its historical audit.

## 6. Test results

Final local counts: web 1,080; Edge 311; native 1,002 across 104 suites; migration 996. Required lint/types pass; web has four pre-existing lint warnings. Web webpack production and Expo web/iOS/Android JS exports pass; Expo Doctor 20/20. [Commands, limitations and separate platform readiness](release-verification.md).

## 7. Database and compatibility

New forward-only migrations: `20270106000000_counterparty_update_keeps_self_kind.sql` and `20270107000000_phase1_financial_snapshot_and_assurance.sql`. Migration07 was generated with Supabase CLI then ordered after this repository's already future-dated chain; do not renumber deployed history. It adds invoker classification/snapshot/visibility contracts, a sensitive-assurance guard and owner wallet actions, preserving old signatures/feeds. New native versions require 07 before rollout. Existing payment clients may newly receive MFA denials; route users to step-up authentication. People contract 1 stays compatible; native requests contract 2 for self-kind.

SQLite v3 migrates additively and preserves operation history. Root shared module is consumed by Metro with separate lockfiles. Review old binaries' access protocol before shared-offline rollout. No hosted migration was applied.

## 8. Outstanding blockers

- Product policy: seven-day shared lease is resolved by explicit user approval. No new settlement/FX policy was invented. Old-client retirement/enforcement and destructive recovery/export policy still need a release decision.
- Engineering/integration: actual API bearer-only and seeded golden cross-platform acceptance still required; default Turbopack environment failure remains; broader financial-read/privacy screen audit and recovery diagnosis remain partial.
- Devices: signed Android/iOS builds, SQLCipher persistence, airplane-mode cold starts/restarts, capture/Shortcuts, biometric/background privacy, accessibility, navigation and measured performance.
- Deployment: hosted 05/06/07 prerequisites and duplicate ledger review, actual web SHA/flags, installed mobile identifiers and downstream scheduler health. These require a later authorized release; they were not changed here.

## 9. Git and delivery

All implementation and evidence files are local/uncommitted. No commit, push, PR creation, merge or deployment. Existing `.DS_Store` changes and untracked mobile `.claude/` were preserved. Temporary clean checkout and logs live under `/private/tmp`; they are not production infrastructure. Do not treat this log as a production readiness certificate.

## 10. Recommended Phase 2

First close the mandatory HTTP/device/release gates with this foundation and a single seeded disposable acceptance journey. Then complete wallet lifecycle and household source workflows, budget/goal allocation parity, richer Insights/report delivery, documents/bills, and People correction workflows using existing APIs. Evaluate #287 calculator and #289 header changes independently after updated base/conflict checks. Keep Android capture and iOS forwarding regressions in every native release gate.
