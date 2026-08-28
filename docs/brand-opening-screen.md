# OneLedger branded app-opening screen

A full-viewport white screen with the centred OneLedger mark, shown on a
genuine application open while the app boots behind it, then faded out to
reveal the real destination. Designed so the opening experience is branded
**end to end** — including the pre-JS network / iOS-PWA-launch phase.

## Where it lives

| File | Role |
| --- | --- |
| `web/components/brand/BrandSplashScreen.tsx` | The overlay + its `opening → exiting → complete` state machine and timers. Client component; the header comment is the authoritative spec. Exports `SPLASH_CRITICAL_CSS`. |
| `web/components/brand/oneledger-mark-data-uri.ts` | **Generated.** The mark as a base64 PNG data URI, drawn as the logo's CSS `background-image` so it paints with the white field (no separate request). |
| `web/app/layout.tsx` | Hoists `SPLASH_CRITICAL_CSS` into `<head>`, mounts `<BrandSplashScreen>` as the first child of `<body>`, and declares `appleWebApp.startupImage` (the iOS launch images). Reads the `oneledger_splash_off` cookie. |
| `web/public/brand/oneledger/startup/apple-splash-*.png` | **Generated.** Per-iPhone launch images (white + centred mark). |
| `scripts/generate-ios-launch-assets.py` | Regenerates the two generated items above from `web/app/icon.png`. Run after any logo change. |
| `web/proxy.ts` | Its matcher excludes `/brand/**` so the launch images (and all brand art) are served without a session redirect. |
| `web/app/globals.css` | Only the app-wide `prefers-reduced-motion` rule. The splash's own CSS is **not** here — see below. |

### Why the CSS + logo are inlined

`globals.css` ships as a separate render-blocking `<link>`. On a slow
connection the splash markup — and its CSS animation clock — started before
that file arrived, which showed in production as a black/blank first frame,
a collapsed `0×0` overlay, and a logo that had finished animating before it
painted. A separate `<img>` for the mark also left the white field empty
for a beat. So `SPLASH_CRITICAL_CSS` (literal `#ffffff`, no custom
properties, mark as an inlined `background-image`) is written straight into
`<head>` and applies on the first frame with zero network.

## The pre-JS phase (iOS PWA)

An installed iOS PWA shows a **solid black** launch screen for the whole
cold-start / network wait unless `apple-touch-startup-image` links are
present. `layout.tsx` declares one per iPhone family
(`appleWebApp.startupImage`), each a white field + centred mark matching
the in-app splash, so launch → HTML → hydrated app is one continuous white
screen with the logo, never a black or grey flash.

## Readiness & timing

The splash is painted from the moment the HTML arrives (inline CSS), so it
already covers the network phase. The two exit timers are anchored to
**hydration** (the component's `useEffect`), so once the app is actually
interactive the brand screen still gets its full minimum showing instead
of being torn away the same instant. The route behind the overlay is
server-rendered and already in the DOM, so the fade reveals finished
content.

| | Normal | Reduced motion |
| --- | --- | --- |
| Minimum visible (after hydration) | 900 ms | 350 ms |
| Exit fade | 320 ms | ~0 ms |
| Hard cap (after hydration) | 2000 ms | 2000 ms |

It does **not** wait on dashboard/API data — once it's gone, `app/loading.tsx`
and per-page skeletons take over. On an init error the cap still fires and
the route's own error boundary shows underneath.

## Why it doesn't replay on navigation

The root layout and this component instance persist across client
navigation, so it mounts once per real document load. A module-level
`finished` flag is a second guard against Strict Mode / incidental
remounts. A fresh tab, hard refresh, or PWA launch is a new document, so it
plays again — the intended trigger set. No `localStorage`/`sessionStorage`.

## Reduced motion

`prefers-reduced-motion: reduce` → no scale/settle animation (an explicit
block in `SPLASH_CRITICAL_CSS`, reinforced by the app-wide rule in
`globals.css`), shorter minimum visible time, instant (non-animated) exit.
The complete static logo is still shown briefly.

## Auth redirects

Handled by `web/proxy.ts` at the edge before render, so the first HTML is
always the correct route. The splash sits on top of it and reveals it in
place — it makes no auth decision and never flashes the wrong page.

## Updating the logo

Replace `web/app/icon.png` (and its `public/` twin) per
`docs/ONELEDGER_BRAND_ASSETS.md`, then run
`python3 scripts/generate-ios-launch-assets.py` to regenerate the inline
data URI and the iOS launch images. There is no vector master; do not
hand-trace one.

## Disabling

Set the cookie `oneledger_splash_off=1`. The overlay is then not
server-rendered at all. The e2e suite sets this globally in
`e2e/fixtures.ts`; `e2e/brand-splash.spec.ts` clears it and is the only
spec that exercises the real overlay.
