# OneLedger branded app-opening screen

A full-viewport white screen with the centred OneLedger mark, shown for
~1.2s on a genuine application open while the app shell mounts behind it,
then faded out to reveal the real destination.

## Where it lives

| File | Role |
| --- | --- |
| `web/components/brand/BrandSplashScreen.tsx` | The overlay + its `opening -> exiting -> complete` state machine and all timers. Client component; header comment is the authoritative spec. Also exports `SPLASH_CRITICAL_CSS`. |
| `web/app/layout.tsx` | Hoists `SPLASH_CRITICAL_CSS` into `<head>` via a `<style precedence>` tag, then mounts `<BrandSplashScreen>` as the first child of `<body>`, above `<AppShell>`. Reads the `oneledger_splash_off` cookie. |
| `web/app/globals.css` | Only the app-wide `prefers-reduced-motion` rule (which also covers the splash). The splash's own CSS is **not** here — see below. |

### Why the CSS is inlined, not in `globals.css`

`globals.css` ships as a separate render-blocking `<link>` stylesheet. On a
slow connection the splash markup — and its CSS animation clock — can start
before that file arrives, which showed up in production as a blank/black
first frame, a collapsed `0×0` overlay, and a logo that had already
finished animating before anything painted. `SPLASH_CRITICAL_CSS` is
inlined in `<head>` (literal `#ffffff`, no custom properties) so it applies
on the first frame.

## Readiness & timing

Two timers, both measured from **navigation start** (`performance.now()`),
whichever fires first wins: `MIN_VISIBLE_MS` and the `HARD_CAP_MS` cap.
Because the splash paints on the first frame, "time since navigation" is an
honest measure of how long it has been visible. If hydration itself takes
longer than `MIN_VISIBLE_MS`, the splash has already been on screen that
whole time and exits promptly.

| | Normal | Reduced motion |
| --- | --- | --- |
| Minimum visible | 900 ms | 350 ms |
| Exit fade | 320 ms | ~0 ms |
| Hard cap (max on screen) | 2000 ms | 2000 ms |

It does **not** wait on dashboard/API data — once it's gone, `app/loading.tsx`
and per-page skeletons take over as usual. On an initialization error the
cap still fires and the route's own error boundary shows underneath.

## Why it doesn't replay on navigation

The root layout and this component instance persist across client
navigation, so it mounts once per real document load. A module-level
`finished` flag is a second guard against Strict Mode / incidental
remounts. A fresh tab, hard refresh, or PWA launch is a new document, so
it plays again — the intended trigger set. No `localStorage`/`sessionStorage`.

## Reduced motion

`prefers-reduced-motion: reduce` → no scale/settle animation (the app-wide
rule in `globals.css` plus an explicit block for this feature), shorter
minimum visible time, instant (non-animated) exit. The complete static
logo is still shown briefly.

## Auth redirects

Handled by `web/proxy.ts` at the edge before render, so the first HTML is
always the correct route. The splash sits on top of whatever that route is
and reveals it in place — it makes no auth decision and never flashes the
wrong page.

## Updating the logo

`LOGO_SRC` is `/icon.png` — Next's route for `app/icon.png`, the approved
512×512 transparent mark, and already exempt from the `proxy.ts` session
gate (a `/brand/oneledger/...` path would 307 to `/login` for a logged-out
visitor). To change the mark, replace `app/icon.png` per
`docs/ONELEDGER_BRAND_ASSETS.md`. There is no vector master; do not
hand-trace one.

## Disabling

Set the cookie `oneledger_splash_off=1` (any scope the request sends). The
overlay is then not server-rendered at all. The e2e suite sets this
globally in `e2e/fixtures.ts`; `e2e/brand-splash.spec.ts` clears it and is
the only spec that exercises the real overlay.
