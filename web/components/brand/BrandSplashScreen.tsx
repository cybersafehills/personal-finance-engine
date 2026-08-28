"use client";

import { useEffect, useRef, useState } from "react";
import { ONELEDGER_MARK_DATA_URI } from "./oneledger-mark-data-uri";

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
 *   The splash is painted from the moment the HTML arrives (its CSS is
 *   inlined in <head> as SPLASH_CRITICAL_CSS), so it already covers the
 *   network / iOS-PWA-launch phase. The two exit timers are measured
 *   from HYDRATION (this component's effect), so that once the app is
 *   actually interactive the brand screen still gets a clean, full
 *   showing instead of being torn away the same instant:
 *     1. readyToExit = MIN_VISIBLE_MS after hydration. The route behind
 *        the overlay is server-rendered and already in the DOM, so the
 *        fade reveals finished content, not a blank frame.
 *     2. hard cap = HARD_CAP_MS after hydration, unconditionally.
 *   The splash deliberately does NOT wait on dashboard data. Per-route
 *   Suspense (app/loading.tsx) and per-page skeletons own that.
 *
 *   The pre-hydration wait (slow network, cold serverless) is handled
 *   separately: the inlined CSS shows the same white field + logo, and
 *   the iOS launch screen itself is branded via appleWebApp.startupImage
 *   in app/layout.tsx (without which iOS shows solid black).
 *
 * TIMING (see constants below)
 *   Normal: MIN_VISIBLE_MS visible + EXIT_MS fade  (~= 900ms + 320ms),
 *     counted from when the app becomes interactive.
 *   Minimum: the logo is shown for at least MIN_VISIBLE_MS after
 *     hydration (MIN_VISIBLE_REDUCED_MS with reduced motion).
 *   Maximum: HARD_CAP_MS after hydration - then it exits and hands off
 *     to whatever the app renders underneath (dashboard, its skeleton,
 *     the auth screen, or an error boundary). The user is never trapped.
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
 *   The logo is inlined as a base64 data URI (ONELEDGER_MARK_DATA_URI,
 *   generated from the approved app/icon.png by
 *   scripts/generate-ios-launch-assets.py) and drawn as a CSS
 *   background, so it paints WITH the splash - no separate request that,
 *   on a slow link, would leave the white screen empty for a beat. To
 *   change the mark, replace app/icon.png per docs/ONELEDGER_BRAND_ASSETS.md,
 *   then re-run that script (it also regenerates the iOS launch images).
 *   Do not inline or hand-trace an SVG - there is no vector master.
 *
 * KILL SWITCH
 *   `disabled` (from the `oneledger_splash_off=1` cookie, read in
 *   app/layout.tsx) removes the splash entirely - no overlay markup is
 *   server-rendered. The e2e suite sets this cookie globally so existing
 *   specs are unaffected; e2e/brand-splash.spec.ts clears it to exercise
 *   the real thing.
 */

const MIN_VISIBLE_MS = 900;
const MIN_VISIBLE_REDUCED_MS = 350;
const EXIT_MS = 320;
const HARD_CAP_MS = 2000;

/**
 * Critical CSS for the opening screen, inlined into <head> by
 * app/layout.tsx. It MUST be fully self-contained:
 *   - No dependency on the app's Tailwind/token stylesheet - that loads
 *     as a separate render-blocking <link>, and on a slow connection the
 *     splash markup is parsed (and its animation clock started) before
 *     it arrives. In production that showed as a blank/black frame, a
 *     collapsed 0x0 overlay, and a logo that had finished animating
 *     before it painted. Colours here are literal.
 *   - The logo is the inlined data URI, drawn as a background-image, so
 *     it needs no network request and appears in the same frame as the
 *     white field (a separate <img> left the screen blank-white for a
 *     beat on slow links before the icon popped in).
 * The `.is-exiting` fade and the reduced-motion treatment live here too.
 */
export const SPLASH_CRITICAL_CSS = `
.oneledger-splash{position:fixed;inset:0;z-index:100;display:flex;
align-items:center;justify-content:center;background:#ffffff;
min-height:100vh;min-height:100dvh;
padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
opacity:1}
.oneledger-splash.is-exiting{opacity:0;pointer-events:none;
transition:opacity 320ms cubic-bezier(0.4,0,0.2,1)}
.oneledger-splash__logo{width:clamp(64px,12vw,112px);aspect-ratio:1;
background:url("${ONELEDGER_MARK_DATA_URI}") center/contain no-repeat;
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
    const startExit = () => {
      if (exiting) return; // min-visible and the hard cap both call this
      exiting = true;
      setState((s) => (s === "opening" ? "exiting" : s));
      push(() => {
        finished = true;
        setState("complete");
      }, exitMs);
    };

    // Timers are anchored to this effect (i.e. hydration), NOT to
    // navigation start. The inlined critical CSS keeps the splash painted
    // from the moment the HTML arrives, so it already covers the network
    // / iOS-launch phase; what we guarantee here is that once the app is
    // actually interactive the brand screen still gets its full minimum
    // showing instead of being torn away the same instant. The route
    // behind the overlay is server-rendered and already in the DOM, so
    // fading straight away reveals finished content, not a blank frame.
    push(startExit, minVisible);
    // Safety net: never stay past the hard cap once hydrated.
    push(startExit, HARD_CAP_MS);

    return () => {
      armed.forEach(clearTimeout);
      armed.length = 0;
    };
  }, [disabled]);

  if (state === "complete") return null;

  return (
    <div
      className={`oneledger-splash${state === "exiting" ? " is-exiting" : ""}`}
      data-state={state}
      // Decorative startup chrome: the meaningful loading/skeleton/error
      // UI lives on the route underneath. Nothing here is focusable, so
      // focus is neither trapped nor moved, and the node is fully removed
      // from the DOM once `state === "complete"`.
      aria-hidden="true"
      role="presentation"
    >
      {/* The mark is a CSS background-image (inlined data URI in
          SPLASH_CRITICAL_CSS), so it paints in the same frame as the
          white field with no request of its own. */}
      <div className="oneledger-splash__logo" />
    </div>
  );
}
