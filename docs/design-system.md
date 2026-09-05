# OneLedger design system

The named, reusable UI primitives every surface composes instead of
re-deriving markup per page. This is deliberately small and additive: the
token layer, focus ring, reduced-motion handling, privacy/blur mode,
skeletons, and the mobile 16px form-control floor already existed — this
formalises the component vocabulary on top of them.

**Rule:** reuse or extend these before writing new label/help/error markup,
status vocabulary, confirm flows, or wizard chrome. Do not redesign a page
just to adopt them — migrate call sites as you touch them.

## Tokens (`web/app/globals.css`)

Colours, radii, and brand marks are CSS custom properties surfaced as
Tailwind utilities (`bg-surface`, `text-text-muted`, `rounded-card`,
`text-accent`, `bg-money-positive-bg`, …). Never hardcode a hex value in a
component. Financial semantics are restrained: outgoing money is
primary-coloured text with a `-` sign, not red.

## Mobile form-control floor (audit F15 — already solved)

`globals.css` forces `input, select, textarea` to `font-size: 16px` under
`@media (max-width: 767px)`. This is the single enforcement point for the
iOS-Safari focus-zoom fix — **do not** chase `text-sm` on individual
inputs, and do not add `user-scalable=no`. Smaller visual typography on
controls at `>= md` is fine.

## Primitives

### Pre-existing (import from their own paths)

| Component | Path | Use |
| --- | --- | --- |
| `Badge` | `components/Badge.tsx` | small status pill; variants `neutral \| accent \| attention \| positive` |
| `EmptyState` | `components/EmptyState.tsx` | now takes optional `action`, `icon`, `variant="setup"` — answer *what / why / next step* |
| `PageHeader` | `components/PageHeader.tsx` | page title + subtitle + action + back link |
| `StatTile` | `components/StatTile.tsx` | one labelled metric |
| `MoneyAmount` | `components/MoneyAmount.tsx` | signed amount, sign always shown, privacy-mask aware |
| `Skeleton` | `components/Skeleton.tsx` | loading placeholder |
| `BudgetStatusBadge` / `ReportStatusBadge` | `components/` | domain-specific status → `Badge` |

### New (`web/components/ds/`, barrel `components/ds/index.ts`)

| Component | Use |
| --- | --- |
| `Field` | label + help + error + required, with `id` / `aria-describedby` / `aria-invalid` / `aria-required` wired once. Render-prop supplies control props: `<Field label…>{(p) => <input {...p} />}</Field>` |
| `CurrencyInput` | integer-minor-unit amount entry via `lib/money.ts` `toMinorUnits`; emits `onValueChange(minor \| null)`; `inputMode` picks numeric (RWF) vs decimal; no floating-point on a ledger value; compose inside `Field` |
| `ConnectionStatusBadge` / `SourceStatusBadge` | the **canonical** 7-state vocabulary `setup · testing · healthy · stale · paused · error · revoked` with fixed customer labels and hints. Every health surface uses this — no ad-hoc "degraded"/"needs sync" strings. Label text always present (never colour alone) |
| `ActionRequiredItem` | the Financial Inbox row: severity (label + shape, not colour) · title (drill-in link) · description · source · timestamp · affected count · optional inline `action` (must call the owning domain RPC) · optional `onDismiss` |
| `DestructiveConfirm` | one confirm gate for revoke / unlink / remove / delete / rotate; optional `confirmWord` (type-to-confirm) and `mfaNotice`. Friction only — the server action still does the real capability + MFA check |
| `PermissionGate` | capability-aware rendering: hide (`fallback`) or show-disabled (`disabledReason`). Presentation only — see `docs/authorization-matrix.md`; a hidden button is not access control |
| `StepWizard` | shared "step N of M" progress chrome for onboarding / pairing / source setup; presentational and uncontrolled (caller owns current-step, often from persisted milestones) |

## Content & terminology

Customer language by default: **financial source**, **connected phone**,
**account**, **Space**, **transaction**, **review**, **reconciliation**.
Keep "ingestion connection", endpoint, header, JSON, credential object out
of primary copy — those belong in an Advanced / Developer panel only.

## Accessibility baseline

Every control ≥ 44px touch target (`min-h-11`); visible focus via the
global `:focus-visible` ring; status never by colour alone; dialogs and
sheets trap focus and restore it on close; `role="alert"` on error text;
respect `prefers-reduced-motion` (global) and privacy mode.

## Not yet done

- Interactive component gallery route — lands with the admin/developer
  shell separation (Phase 1), which is where a `/design-system` preview
  belongs.
- Figma Code Connect mapping against `brand-source/` /
  `docs/ONELEDGER_BRAND_ASSETS.md`.
