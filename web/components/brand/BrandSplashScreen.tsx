"use client";

import { useEffect, useRef, useState } from "react";

/**
 * OneLedger branded app-opening screen.
 *
 * WHERE IT IS INTEGRATED
 *   Rendered once as the first child of <body> in app/layout.tsx, above
 *   <AppShell>. The root layout (and this component instance) persist
 *   across every internal route change, so the splash mounts a single
 *   time per real document load and never replays on client navigation,
 *   router.refresh() (LiveDataSync), modal opens, or RSC re-renders.
 *   A fresh tab, a hard refresh, or an installed-PWA launch is a new
 *   document => new module scope => the splash plays again, which is the
 *   intended "genuine application opening" trigger set (spec section 6).
 *
 * WHAT DETERMINES READINESS
 *   Two independent timers, both measured from navigation start
 *   (performance.now()), whichever fires first wins:
 *     1. readyToExit = MIN_VISIBLE_MS since the user opened the page.
 *        The critical CSS is inlined in <head> (SPLASH_CRITICAL_CSS), so
 *        the splash paints on the first frame - "time since navigation"
 *        is therefore an honest measure of how long it has been visible,
 *        and stays correct even if JS hydrates before or long after the
 *        first paint.
 *     2. hard cap = HARD_CAP_MS since navigation start, unconditionally.
 *   The splash deliberately does NOT wait on dashboard data. Per-route
 *   Suspense (app/loading.tsx) and per-page skeletons own that; the
 *   splash only covers initial shell assembly.
 *
 * TIMING (see constants below)
 *   Normal: MIN_VISIBLE_MS visible + EXIT_MS fade  (~= 900ms + 320ms).
 *   Minimum: the logo is shown for at least MIN_VISIBLE_MS since
 *     navigation (MIN_VISIBLE_REDUCED_MS with reduced motion) so it
 *     never flashes - unless hydration itself takes longer than that, in
 *     which case it has already been on screen that whole time and
 *     exits promptly.
 *   Maximum: HARD_CAP_MS. If hydration stalls past this the splash exits
 *     anyway and hands off to whatever the app renders underneath
 *     (dashboard, its skeleton, the auth screen, or an error boundary) -
 *     the user is never trapped behind the logo.
 *
 * REDUCED MOTION
 *   prefers-reduced-motion: reduce => no scale/settle animation (in
 *   SPLASH_CRITICAL_CSS, and reinforced by the app-wide reduced-motion
 *   rule in globals.css), a shorter minimum visible time, and an instant
 *   (non-animated) exit.
 *   The complete, static logo is still shown briefly.
 *
 * AUTH REDIRECTS
 *   Handled entirely by web/proxy.ts at the edge before this renders, so
 *   the first HTML the browser receives is already the correct route.
 *   The splash sits on top of whatever that route is and reveals it in
 *   place - it makes no auth decision and cannot flash the wrong page.
 *
 * UPDATING THE LOGO ASSET
 *   LOGO_SRC points at `/icon.png` - Next's file-based metadata route for
 *   app/icon.png, which is the approved 512x512 transparent OneLedger
 *   mark (byte-identical to public/brand/oneledger/app-icons/icon-512.png,
 *   see docs/ONELEDGER_BRAND_ASSETS.md). It is used here specifically
 *   because web/proxy.ts's matcher already exempts `icon.png` from the
 *   session gate; a `/brand/oneledger/...` path would 307 to /login for a
 *   logged-out visitor and render broken on the auth screen's own splash.
 *   To change the mark, replace app/icon.png (and its public/ twin) per
 *   that doc's "Updating assets" steps. Do not inline or hand-trace an
 *   SVG - there is no vector master.
 *
 * KILL SWITCH
 *   `disabled` (from the `oneledger_splash_off=1` cookie, read in
 *   app/layout.tsx) removes the splash entirely - no overlay markup is
 *   server-rendered. The e2e suite sets this cookie globally so existing
 *   specs are unaffected; e2e/brand-splash.spec.ts clears it to exercise
 *   the real thing.
 */

/** Approved 512x512 transparent OneLedger mark. Displayed at clamp(64-112px). */
const LOGO_SRC = "/icon.png";

const MIN_VISIBLE_MS = 900;
const MIN_VISIBLE_REDUCED_MS = 350;
const EXIT_MS = 320;
const HARD_CAP_MS = 2000;

/**
 * Critical CSS for the opening screen, inlined into <head> by
 * app/layout.tsx. It MUST NOT depend on the app's Tailwind/token
 * stylesheet: that sheet loads as a separate render-blocking <link>, and
 * on a slow connection the splash markup can be parsed (and its
 * animation clock started) before it arrives - which showed up in
 * production as a blank/black frame, a collapsed 0x0 overlay, and a logo
 * that had already finished animating by the time anything painted.
 * Inlining it means the white field + centred logo paint on the very
 * first frame. Colours are literal (no CSS custom properties) for the
 * same reason. The `.is-exiting` fade and the full reduced-motion
 * treatment also live here so the whole feature is self-contained.
 */
export const SPLASH_CRITICAL_CSS = `
.oneledger-splash{position:fixed;inset:0;z-index:100;display:flex;
align-items:center;justify-content:center;background:#ffffff;
min-height:100vh;min-height:100dvh;
padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
opacity:1}
.oneledger-splash.is-exiting{opacity:0;pointer-events:none;
transition:opacity 320ms cubic-bezier(0.4,0,0.2,1)}
.oneledger-splash__logo{width:clamp(64px,12vw,112px);height:auto;
transform-origin:center;
animation:oneledger-splash-logo-in 640ms cubic-bezier(0.22,1,0.36,1) both}
@keyframes oneledger-splash-logo-in{
0%{opacity:0;transform:scale(0.94)}
60%{opacity:1;transform:scale(1)}
78%{transform:scale(1.014)}
100%{opacity:1;transform:scale(1)}}
@media (prefers-reduced-motion:reduce){
.oneledger-splash__logo{animation:none;opacity:1;transform:none}
.oneledger-splash.is-exiting{transition-duration:0.01ms}}
`;

/**
 * Module scope: survives React re-renders, React 19 Strict Mode's
 * double-invoked mount, and router.refresh()/RSC re-renders within one
 * page load; recreated only on a genuine full document load. Makes any
 * later (re)mount in the same document render nothing.
 */
let finished = false;

type SplashState = "opening" | "exiting" | "complete";

export function BrandSplashScreen({ disabled = false }: { disabled?: boolean }) {
  const [state, setState] = useState<SplashState>(() =>
    disabled || finished ? "complete" : "opening",
  );
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    // When `disabled` (kill switch) or `finished` (already played earlier
    // in this document's life), the lazy initializer above has already
    // put us in "complete" and we render nothing - nothing to schedule.
    if (disabled || finished) {
      finished = true;
      return;
    }

    const prefersReduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const minVisible = prefersReduced ? MIN_VISIBLE_REDUCED_MS : MIN_VISIBLE_MS;
    const exitMs = prefersReduced ? 0 : EXIT_MS;

    const armed = timers.current;
    const push = (fn: () => void, ms: number) => {
      armed.push(setTimeout(fn, Math.max(0, ms)));
    };

    let exiting = false;
    const complete = () => {
      finished = true;
      setState("complete");
    };
    const startExit = () => {
      if (exiting) return; // whichever of the two triggers below fires first wins
      exiting = true;
      setState((s) => (s === "opening" ? "exiting" : s));
      push(complete, exitMs);
    };

    // Anchor to navigation start, not to this effect: with the critical
    // CSS inlined the splash paints on the first frame, well before
    // hydration, so "time since the user opened the page" is the honest
    // measure of how long the brand screen has actually been visible.
    // It is also self-bounding - if hydration is slow, `elapsed` is
    // already large and the timers fire almost immediately.
    const elapsed =
      typeof performance !== "undefined" ? performance.now() : 0;
    // readyToExit: minimum visible time satisfied.
    push(startExit, minVisible - elapsed);
    // Hard cap: exit no matter what (stalled hydration, init error, ...).
    push(startExit, HARD_CAP_MS - elapsed);

    return () => {
      armed.forEach(clearTimeout);
      armed.length = 0;
    };
  }, [disabled]);

  if (state === "complete") return null;

  return (
    <>
      <link rel="preload" as="image" href={LOGO_SRC} />
      <div
        className={`oneledger-splash${state === "exiting" ? " is-exiting" : ""}`}
        data-state={state}
        // Decorative startup chrome: the meaningful loading/skeleton/error
        // UI lives on the route underneath. Nothing here is focusable, so
        // focus is neither trapped nor moved, and the node is fully
        // removed from the DOM once `state === "complete"`.
        aria-hidden="true"
        role="presentation"
      >
        {/* Deliberate plain <img>, not next/image: a static /public URL is
            in the first SSR HTML and paints in the opening frame with no
            JS, optimizer round-trip, or hydration needed - the whole point
            of the splash. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={LOGO_SRC}
          alt=""
          width={112}
          height={112}
          className="oneledger-splash__logo"
          decoding="async"
          fetchPriority="high"
          draggable={false}
        />
      </div>
    </>
  );
}
