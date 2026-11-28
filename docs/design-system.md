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

## Mobile app (oneledger-mobile): density and sizing

The app is one step roomier than the web. The scale is `hero 44` (one headline number per
screen), `display 30`, `title 22`, `heading 17`, `body 15`, `label 14`, `caption 13`
(`src/theme/typography.ts`). Cards have a 20pt corner (the Home balance card 24).

The accent is a deep green on mobile; the web still uses its blue `--accent`. Outgoing
money stays primary-coloured text with a minus sign, including in compact rows.

- **System "Larger Text"** still applies but is capped at 1.25x (`MAX_FONT_SCALE`), so
  rows and controls stay inside their frames.
- **Controls look smaller than their hit area.** `Button` is a 52pt pill (36pt `size="sm"`,
  `BUTTON_HEIGHT`), chips 32pt, header icon buttons 40pt (`CONTROL_HEIGHT`); `hitSlopFor()` adds margin so every tap target is still
  at least 44pt.
- **Sheets are native.** The Pay launcher is a route presented as a form sheet
  (`(app)/pay-sheet.tsx`: grabber, drag-to-dismiss, detents), not a custom modal.
  Group related rows in one bordered list rather than a box per row.
- Shadows use `boxShadow`, never the legacy shadow/elevation props.
- **Lists are grouped, not carded.** `ListGroup` + `ListRow` (components/ds) are the one row
  design: optional icon, label with a one-line hint, a value or badge, then a chevron (or the
  "opens outside the app" arrow); at least 48pt; hairlines between rows. More, Settings, the
  Pay launcher and the account menu all use them. Settings that are on/off (phone alerts) are
  a native `Switch` row, not a button that changes its own label.
- **Motion** uses Reanimated (framer-motion is web-only). The Pay sheet's slide and
  drag-to-dismiss are the native form sheet's own; inside it, blocks rise and fade in
  with a 35ms stagger (`Keyframe`, 220ms, ease-out), buttons scale to 0.97 under the
  finger (`PressableScale`, a CSS transition: UI thread, no re-render per frame), and
  info dialogs fade and settle in (180ms) and fade out. Everything honours the system
  reduce-motion setting. Full-width rows highlight their background instead of
  scaling. Judge feel on a release build, not in Expo Go.
- **Accents:** green (`moneyPositive`) marks Scan to pay, orange (`moneyRequest`) marks
  Request payment; each shortcut has an (i) that explains it in plain words.

## Mobile app: theming (light, dark, automatic)

The app has a Light and a Dark appearance and an **Automatic** setting that follows the phone (including its automatic switch at night). The choice is in **Settings > Appearance** and is kept on that phone only (`ol.theme.v1`, device store).

**Structure** (`oneledger-mobile/src/theme/`)

| File | Role |
| --- | --- |
| `colors.ts` | The two palettes (`lightColors`, `darkColors`). `Palette` makes a missing or extra token in either a compile error. |
| `preference.ts` | Pure rules: `ThemePreference` (`system` / `light` / `dark`), `normalizePreference`, `resolveScheme`, load/save. |
| `ThemeProvider.tsx` | One provider at the root. `useTheme()` gives `{ preference, scheme, isDark, colors, setPreference }`; `makeStyles()` builds palette-dependent styles once per palette. Also sets the status bar and tells the phone (`Appearance.setColorScheme`) so keyboards, alerts and the share sheet match. |
| `NavigationTheme.tsx` | Gives the palette to the navigator (native headers, back buttons, sheet backgrounds). |
| `contrast.ts` | WCAG contrast, used by the palette tests. |

**Rules for components**

- Never import a palette. Inline colours: `const { colors } = useTheme();`. Style sheets that use colour: `const useStyles = makeStyles((colors) => StyleSheet.create({ ... }));` at module scope and `const styles = useStyles();` in the component. Styles with no colour stay a plain `StyleSheet.create`.
- Without a provider (unit tests, previews) the light palette is used, so tests need no wrapper.
- Tokens are named by **role**, not hue. Text and icons on a surface: `textPrimary/Secondary/Muted`, `accent`, `moneyPositive`, `attention`, `danger`. A strong fill that carries white content: `accentSolid`, `moneyPositiveSolid`, `moneyRequestSolid`, `ekashSolid`, `notificationBadge`, with content in `onSolid` (white in both themes). Quiet tints: `*Bg`. A colour that is text in one place and a fill in another must be split into two tokens, because a bright green that reads as text on dark is wrong behind a white icon.
- A QR code is always black on white (a scanner needs it); that, scrims and one brand shadow are the only hard-coded colours.
- Use `keyboardAppearance` (done in `TextField`) and the dark launch image (`splash-logo-dark-1024.png`) rather than leaving native parts light.

**Guarded by tests** (`src/theme/__tests__/`): both palettes define the same tokens; every value is a hex colour; text tokens reach 4.5:1 on `surface` and `background` in both themes; white content reaches 4.5:1 on every fill that carries text (3:1 on the icon-only brand discs); and no component imports a palette, hard-codes a hex colour, or finds a static `colors` export.

**Known limit:** the light palette's payment-brand fills match the web's, so two icon-only brand fills (`moneyRequestSolid`, `ekashSolid`) sit at 3.6-4.2:1 against white; dark clears 4.5:1 everywhere.
