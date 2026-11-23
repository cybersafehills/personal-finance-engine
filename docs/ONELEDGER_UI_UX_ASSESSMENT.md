# OneLedger UI/UX assessment

Baseline: **2026-11-18, main `36ad79b`**. This is a source-led assessment and design direction, not a fresh rendered audit or device usability study. Read the [engineering audit](ONELEDGER_CURRENT_STATE_AUDIT.md) before interpreting visual issues as the main release risk.

## Evidence and limits

Reviewed `web/app/globals.css`, web shell/navigation, brand assets documentation, shared components, mobile theme/typography/DS, app layouts, Home, Wallets, Goals, Insights, Bills, statements, settings and related feature code. Inspected the checked-in `web/e2e/visual.spec.ts-snapshots/home-empty-chromium-desktop-linux.png`: it shows existing desktop navigation, wallet cards, restrained summary tiles and empty activity. It is a historical test artifact with fixture names, not a screenshot captured from this checkout or a live customer account. No native screenshot, current web render, keyboard/reader session, measured runtime contrast audit or performance trace was captured.

The local web environment has missing installed dependencies/generated route types; the mobile typecheck has a stale route union. Resolve those in an isolated clean build before using a visual test as release evidence. Passing mocked screen tests does not establish Dynamic Type, keyboard avoidance, sheet behavior or VoiceOver/TalkBack quality.

## Preserve the approved visual foundation

| Element | Current evidence | Direction |
|---|---|---|
| Brand | `brand-source/`, `docs/ONELEDGER_BRAND_ASSETS.md`, web `components/brand`, native `assets/branding` | Retain approved mark, navy `#07143a`, brand blue `#0050f4`; UI accent `#33509e` is intentionally quieter. Do not replace logo/color identity during parity work. |
| Typography | Web Geist; native `theme/typography.ts` Geist files by weight | Keep family and tabular figures. Set native sizes for readable tasks, not pixel equivalence to desktop CSS. |
| Surface system | Background `#f6f6f7`, white surfaces, restrained borders; 16-radius cards / 10-radius controls in CSS and native tokens | Reuse; avoid another card vocabulary. Keep long decision forms grouped without putting every line in a separate card. |
| Financial color | Incoming green `#067a4d`; outgoing primary text with sign; amber attention; red limited notification badge | Preserve semantics. Use labels/icons for errors and pending/conflict; no red treatment merely for spending. |
| Components | Web `Badge`, `MoneyAmount`, `EmptyState`, `PageHeader`, `Field`, `CurrencyInput`, `DestructiveConfirm`, `StepWizard`; native equivalents under `components/ds` | Extend existing primitives; cross-platform specification can be shared while rendering remains native. |
| Safety copy | Balance provenance labels; provider handoff/manual/verified distinction; document extraction disclaimers | These are core financial UX, not technical clutter. Keep them at the decision/amount they qualify. |

## Product information architecture

Use the existing consumer structure: **Home**, **Transactions**, **Pay**, **Plan**, **More**. Header Inbox and reports affordances can remain where familiar, with a single consistent badge meaning. Keep operator/developer tooling in the appropriate gated web area.

Home should answer: which Space and wallet am I viewing, what balance evidence exists, what changed today, and what needs a decision? Plan should organize budgets and goals with an obvious route between them. More should organize analysis, documents, sources and settings without implying unavailable functionality is ready. Existing `/plan` and `/goals` aliases are merged and should be retained.

Current mobile More lists Wallets/People/requests without their individual OneLedger 3 gates; Insights uses a different configuration gate from Insights Center. Fix discoverability together with the configuration contract. A hidden feature is not a security control, but repeatedly opening an unavailable destination is a product defect.

Use the selected Space name consistently near shared-money context. On switching Space, replace or segregate old content immediately; a household title above personal totals is materially misleading even if both datasets are authorized. A failed reload must not silently leave the old data under a new label (`useQuery`, audit F14).

## Findings and recommendations

| ID | Priority | Finding / evidence | Recommendation and acceptance |
|---|---|---|---|
| UX01 | P1 | Native Home takes the newest transaction balance and labels a single provider; web Home now supports per-wallet cards. `features/transactions/queries.ts`, `(tabs)/index.tsx`, web wallet helpers. | Native wallet selector/cards with correct name/currency, provenance and as-of. No amount without its wallet and basis; default selection persists. Test no baseline, stale balance and one wallet in another Space. |
| UX02 | P1 | Native ledger row/aggregate format can label foreign minor units as RWF; audit F06. | Currency-aware amount primitive with explicit scale, sign and tabular digits. Never mix currencies without an approved FX model. Fixture USD 12.34 must remain USD 12.34 in list/detail/Home/report. |
| UX03 | P1 | Mobile masking is session-memory only; Wallets directly exposes amount in text and accessibility label. `PrivacyProvider.tsx`, `wallets.tsx`. | Define dashboard-mask versus full-privacy behavior explicitly; persist per user; apply it to both visual and accessibility text. Intentional transaction-detail exceptions require product agreement. Relaunch and background tests must show no unintended value. |
| UX04 | P1 | Network-only review count can reject otherwise cached Home; refresh errors are often hidden when old data exists. | Separate optional widgets; show useful saved data with dated freshness and visible update failure. Empty, unavailable, permission denied and offline must have different copy. No false financial zero on failed query. |
| UX05 | P2 | Native main Stack has `headerShown:false`; pushed screens repeat a manual Back button. | Use native headers/back gestures with consistent titles and contextual actions; preserve deep-link back fallback. Test iOS edge swipe and Android system back, with keyboard/sheets and unsaved edits. |
| UX06 | P2 | Main native scale is display 36/title 24/heading 20/body 16, with ≥44 controls; web heavily uses smaller body text. Pending #286 changes scale and sheet. | Review #286 first. Validate hierarchy at normal and largest supported system text; do not mechanically cap scaling at 1.25x to match desktop density. Compact visuals must retain effective touch targets and avoid adjacent hit-region overlap. |
| UX07 | P2 | Pay launcher is custom modal on main; pending #286 proposes native form sheet. | Reuse that work after platform proof: safe-area, drag/close/back, focus restoration, scrolling detents, keyboard, reduced motion. iOS and Android may use different native presentations while preserving action order. |
| UX08 | P2 | Settings frequently opens browser; budget/goal authoring, advanced rules and documents also rely on web. `features/settings/groups.ts` and native screens. | Label browser destinations clearly before tap; preserve Space and return context through approved link routing; never place session tokens in URLs. Prioritize high-frequency budget/goal actions for native completion. |
| UX09 | P2 | Shared card/button/text primitives are useful, but new screens sometimes render amounts/statuses directly; source copies can drift. | Extend native amount/status primitives for currency, provenance, stale/pending/conflict and privacy. Reuse API-provided financial facts; no new screen-local formulas. Token values should have an automated parity check if both token files continue to be maintained. |
| UX10 | P2 | Dense mobile lists have badges/time/category/name plus amount; long names may compress the financial column. `TransactionItem.tsx`, `ListScreen.tsx`. | Test longest name, largest amount and text scale. Financial value may wrap deliberately or use a stable second line; never truncate away sign/currency. Preserve date grouping and accessible row meaning. |
| UX11 | P1 | Sync has meaningful states, held conflicts and pending records; these need consistent explanations. `offline/status.ts`, SyncStatusChip, sync screen. | Keep “Saved on this phone”, “Not sent” and “Needs your choice” distinct from settled/confirmed. Explain that captured offline messages appear after server processing. Rejected data stays recoverable; destructive discard requires clear consequences. |
| UX12 | P2 | Native read-only Goals/Statements/Bills expose partial workflows. Original-file access is already implemented for Bills. | Empty states should direct to the precise available next action; distinguish no records from feature off and insufficient permission. Do not present a missing authoring action as a failed fetch. |

## Native platform responsibilities

**iOS:** use native push navigation, sheet dismissal, keyboard avoidance, Dynamic Type, VoiceOver and safe areas. No notification inbox observer is available in the implemented architecture: the user installs/approves Shortcuts and Messages automation. Explain setup steps and verification using actual received server evidence; a Shortcut launch alone is not “connected and recording”. Real build/TestFlight, APNs, links and installation have not been verified here.

**Android:** test system back, TalkBack, font/display scaling, notification access, battery restrictions, reboot and background capture independently of JS. Keep notification permission and capture permission distinct; push opt-in is not permission to read payment notifications. Settings should state whether recording is off because of pairing, access, revocation, queue failure or silent phone. OEM-specific background behavior requires real devices.

**Legacy companion:** retain its simple pairing/health purpose until migration is proven. Do not redesign it into a second full native product. Same package/signing and queue/credential upgrade behavior are engineering prerequisites for a seamless successor.

## Accessibility acceptance specification

1. Web: visible keyboard focus, ordered headings/landmarks, labelled inputs with error associations, keyboard-operable menus/dialogs, focus trap/restore, reduced-motion support, no horizontal overflow at 320/390 CSS px. Existing global focus ring and 16px mobile control floor are strengths; keep zoom enabled.
2. Native: VoiceOver/TalkBack labels and states for every icon action, selected tab, amount, progress, loading/error and permission action. Monetary masking must remove values from accessibility output, not just blur pixels.
3. Use ≥44pt effective touch targets; validate adjacent controls physically and in accessibility inspector. Native Android targets may need more space based on platform review rather than shrinking to the web density.
4. Check text/background pairs using a contrast tool: normal text ≥4.5:1 and large text/non-text controls as applicable ≥3:1. These are acceptance targets, not measured results from this assessment.
5. Test largest supported text and display scale on both OSes, not only default-size screenshots. No clipped amount/sign/currency, inaccessible controls, fixed-height text cutoff or unreachable sheet action. Any scaling restriction needs documented usability evidence.
6. Announce save/rejection/conflict states; avoid relying on color, vibration, spinner or transient toast alone. Repeated events should not spam the reader.

## Performance and perceived responsiveness

No measured latency/frame-rate claims are made. Source risks: Home's all-or-nothing Promise.all; native goals' per-goal progress calls (up to 50); local current balance selecting all transactions; nonpaged aggregations; long list/card rendering; repeated identity/config reads. Existing web request caching for wallet/Home models, list components and retained-data refresh can be reused after context-key correctness.

Establish release-device budgets from measurement: cold/warm launch, initial cached ledger, 5,000-row scrolling, Space switch, first Insights read, background→foreground sync and low-memory operation. Report p50/p95 network latency separately from render time. Keep cached screens immediately useful, but never trade correct Space/privacy for speed. Add paged/local indexed reads where traces show a bottleneck.

## Design delivery and QA

First deliver a small reference set using existing DS: Home with two wallets, transaction list/detail, category correction conflict, Pay review, budget overview, Inbox and settings. Include loading/empty/error/stale/permission/success states, normal and masked amounts, long content and larger text. Use functional equivalence with native controls; no requirement for screenshot-identical web/iOS/Android screens.

Capture fresh authenticated web desktop/mobile images and independent Android/iOS screenshots after correctness fixes. Review hierarchy, naming, spacing, component behavior and factual agreement on the same fixture. Run Playwright/axe for web, native reader/manual keyboard/accessibility checks for apps, and retain dated evidence with build SHA/device/OS. Existing CI Safari smoke is non-blocking and cannot substitute for an iPhone app run.

Acceptance for this design direction: approved identity preserved; existing high-quality components reused; correct scoped/currency-labelled facts; coherent action placement; predictable native back/sheets; full financial-state feedback; verified accessible scaling. Broad visual replacement is not part of this assessment.
