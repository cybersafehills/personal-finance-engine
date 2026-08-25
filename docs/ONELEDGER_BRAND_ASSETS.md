# OneLedger brand assets

## Source-of-truth warning

> OneLedger brand artwork must not be manually recreated or modified by
> developers. Future visual changes must originate from approved brand
> source assets supplied by the brand owner, not from redrawing, guessing
> a font, or applying CSS filters to recolor the mark.

## Official assets

Supplied by the product owner under `OneLedger Brand Assets/` and archived
verbatim (never edited) at `brand-source/oneledger/`:

| Archived file | Role |
| --- | --- |
| `primary-transparent-logo.png` | Primary horizontal lockup (symbol + wordmark), the higher-resolution of two supplied exports (1774x887, flat rendering) - used as the source for the runtime primary logo. |
| `primary-transparent-logo-lowres.png` | An earlier/lower-resolution export of the same lockup (1440x736). Kept for the record; not used at runtime because the other export is strictly higher quality. |
| `monochrome-dark-logo.png` | Single-tone dark lockup for monochrome/print contexts. **As supplied, this file has no real alpha channel** - the transparency was baked in as a checkerboard pattern of near-white pixels instead of exported properly (see "Known source defect" below). |
| `standalone-icon.png` | The approved symbol alone (negative-space "1"), with genuine alpha transparency. This is the canonical runtime source for the compact mark, favicon-derivation, and app icons. |
| `favicon-source.png` | Compact favicon-specific export of the symbol, also with alpha. Used specifically for the favicon size ladder per the brand owner's naming. |
| `oneledger-icon-source.png` | Another presentation of the same symbol, exported flat on an **opaque white canvas with no alpha channel**. It is visually redundant with `standalone-icon.png` and less versatile (an opaque white box would appear around it on any non-white surface), so it is archived for reference only and not deployed to a runtime path. |

### Known source defect: monochrome dark logo

The supplied `monochrome-dark-logo.png` was exported with a checkerboard
pattern (two near-white RGB tones, e.g. `(255,249,242)` and `(245,245,245)`)
baked into fully opaque pixels, instead of true PNG alpha. This is exactly
the mistake described in the implementation brief: *"the checkerboard
pattern... represents transparency and must never be baked into the
exported production image."*

Because the logo's actual ink (~RGB `(35,40,50)`) is far darker than the
checkerboard tones, transparency was reconstructed with a smooth luminance
threshold (opaque below L≈200, transparent above L≈245, linear ramp
between) - this changes no color, geometry, or proportion of the mark
itself, it only restores the alpha channel the export should have had.
The result (`oneledger-logo-monochrome-dark.png`) was verified pixel-by-pixel
to be cleanly bimodal (alpha 0 or 255, with only genuine anti-aliased edge
pixels in between).

**If a future brand refresh re-supplies this asset, request a proper
PNG-with-alpha export and skip this reconstruction step entirely.**

## Verified brand colors

Sampled directly from the source artwork (not assumed):

```css
--brand-navy: #07143a; /* rgb(7, 20, 58) */
--brand-blue: #0050f4; /* rgb(0, 80, 244) */
```

These are centralized in `web/app/globals.css` as `--brand-navy` /
`--brand-blue` (and exposed as Tailwind's `brand-navy` / `brand-blue`).
They are intentionally **separate** from the app's existing `--accent`
(`#33509e`), which is a pre-existing, more muted interface color used for
buttons/focus rings/active nav states. This implementation did not
recolor the UI to match the brand mark - that is a distinct design
decision left to the product owner (see "Do not expand scope" in the
implementation brief).

## Usage

| Context | Asset |
| --- | --- |
| Header (`AppShell`) | `<OneLedgerLogo variant="primary" />` |
| Login / signup pages | `<OneLedgerLogo variant="primary" />` |
| Browser tab (favicon) | `favicon.ico` / `favicon-*.png`, generated from `favicon-source.png` |
| iOS "Add to Home Screen" | `app/apple-icon.png` (180x180, mark on opaque white) |
| Future PWA / installed icon | `public/brand/oneledger/app-icons/icon-192.png`, `icon-512.png` |
| Small square badges / collapsed nav | `<OneLedgerLogo variant="mark" />` |
| Monochrome/print documents | `<OneLedgerLogo variant="monochrome" />` |

## Do not use

- Do not shrink the horizontal primary logo into a small square container -
  use `variant="mark"` instead.
- Do not use `oneledger-logo-monochrome-dark.png` as a general replacement
  for the primary color logo; it is for monochrome-only contexts.
- Do not recolor `oneledger-logo-primary.png` or `oneledger-mark.png` with
  CSS filters.

## Asset paths (runtime)

```
web/public/brand/oneledger/
  logo/oneledger-logo-primary.png
  logo/oneledger-logo-monochrome-dark.png
  mark/oneledger-mark.png
  favicon/favicon.ico
  favicon/favicon-16x16.png
  favicon/favicon-32x32.png
  favicon/favicon-48x48.png
  app-icons/apple-touch-icon.png
  app-icons/icon-192.png
  app-icons/icon-512.png
```

Preserved originals (never used directly at runtime):

```
brand-source/oneledger/
  primary-transparent-logo.png
  primary-transparent-logo-lowres.png
  monochrome-dark-logo.png
  standalone-icon.png
  favicon-source.png
  oneledger-icon-source.png
```

## Favicon implementation

Next.js 16's App Router file-based metadata convention is used instead of
manual `<link>` tags:

- `web/app/favicon.ico` - multi-size ICO (16/32/48), auto-served at `/favicon.ico`.
- `web/app/icon.png` - 512x512 mark, transparent, auto-detected by Next and
  injected as an `<link rel="icon">` tag.
- `web/app/apple-icon.png` - 180x180 mark composited onto an opaque white
  square (iOS does not support alpha for home-screen icons), auto-detected
  by Next and injected as `<link rel="apple-touch-icon">`.

The equivalent files are also kept under `public/brand/oneledger/` so the
brand structure stays self-contained and inspectable independent of Next's
routing conventions.

## App icons

`icon-192.png` and `icon-512.png` (transparent, mark only) are prepared for
a future PWA manifest but are **not currently wired into a `manifest.json`**
- this repository has no web manifest or other PWA infrastructure today,
  and one was not introduced solely for branding purposes (per the
  implementation brief's "do not expand scope" guidance). When PWA support
  is added, point `manifest.json`'s `icons` array at these two files, and
  generate `icon-maskable-192.png` / `icon-maskable-512.png` (mark centered
  within an ~80% safe zone) at that time - they were not generated now
  because there is no maskable-icon consumer to validate them against.

## Metadata

`web/app/layout.tsx`'s static `metadata` object sets:

- `title: "OneLedger"`
- `applicationName: "OneLedger"`
- `appleWebApp.title: "OneLedger"`
- `openGraph.title` / `openGraph.siteName: "OneLedger"`

No Open Graph image is configured - none was supplied. See "Outstanding
assets" below.

## Legacy cleanup

User-visible occurrences of the old "Personal Finance" placeholder name
were replaced with OneLedger branding:

- `web/app/layout.tsx` - page title.
- `web/components/AppShell.tsx` - header, replaced the "Personal Finance"
  text with the `OneLedgerLogo` component.

**Intentionally left unchanged** (not user-facing product branding):

- `app/login/page.tsx` / `app/signup/page.tsx` copy ("Your personal
  finance workspace.") - describes the product category, not a product
  name.
- `supabase/.temp/linked-project.json`, `supabase/migrations/README.md`,
  `supabase/migrations/PHASE_3_MIGRATION_REPORT.md` - historical/
  infrastructure references to "Personal Finance Engine" (the Supabase
  project name and migration history). Renaming the linked Supabase
  project or rewriting historical migration docs was out of scope and
  carries operational risk for no user-visible benefit.

No references to "MoMo Automation," "LedgerFlow," or other prior product
names were found in the application code.

## Updating assets

1. Get the new source art from the brand owner as PNG (or true vector, if
   available) with correct alpha transparency - verify with a pixel probe
   before trusting it, the way `monochrome-dark-logo.png` was checked here.
2. Archive the new original under `brand-source/oneledger/`, do not
   overwrite the previous one until the new one is confirmed correct.
3. Re-run the crop/pad/resize steps to regenerate the runtime files under
   `web/public/brand/oneledger/` and the Next.js `app/icon.png` /
   `app/apple-icon.png` / `app/favicon.ico` convention files.
4. Visually diff old vs. new at 16px, 32px, 180px, and full size before
   committing.

## Outstanding assets

Not supplied by the brand owner; do not fabricate these:

- **True vector master** (SVG/AI) - all runtime assets here are raster PNG
  derivatives of raster source art.
- **Official reversed/white logo** for OneLedger Navy or other dark
  surfaces - this app has no dark mode today, so this was not needed yet,
  but should be requested before dark mode is built.
- **Official Open Graph / social share image** (1200x630) - pending. Do
  not substitute the favicon or app icon for this.
- **Print-ready vector artwork** for formal documents/PDF exports (no PDF
  or report generation exists in this repository yet).
