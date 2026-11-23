import { router, usePathname, type Href } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, Keyboard, Platform, View } from "react-native";
import { useSession } from "@/features/auth/SessionProvider";
import { useLock } from "@/features/lock/LockProvider";
import { useActiveSpace } from "@/features/spaces/ActiveSpaceProvider";
import { deviceStore } from "@/lib/device-store";
import { GUIDE_REVISION, guideDefinitions, guideStepIndex, nextStepIndex, stepMatchesPath, type GuideStep } from "./definitions";
import { GuidesContext, type Anchor } from "./context";
import { GuideOverlay } from "./GuideOverlay";
import { canOfferWelcome, emptyGuides, guideStorageKey, readGuides, type GuideId, type GuideState, type Rect } from "./model";

function navigateGuideRoute(route: string, currentPath: string) {
  const destination: Href = route === "/transactions"
    ? { pathname: "/transactions", params: { reset: String(Date.now()), focusSearch: "", category: "", accountId: "", walletName: "", period: "all" } }
    : route === "/more"
      ? { pathname: "/more", params: { guideReset: String(Date.now()) } }
      : route as Href;
  // A native form sheet must leave the stack before another tour page can appear.
  if (["/pay-sheet", "/connect"].includes(currentPath) && route !== currentPath) router.dismissTo(destination);
  else router.navigate(destination);
}
type Running = { id: GuideId; index: number };
const progressFor = (steps: GuideStep[], index: number, status: "paused" | "completed") => ({ status, step: index, revision: GUIDE_REVISION, stepId: steps[index].id });

export function GuidesProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  if (!session) return children;
  return <UserGuidesProvider key={session.user.id} userId={session.user.id} createdAt={session.user.created_at}>{children}</UserGuidesProvider>;
}
function UserGuidesProvider({ userId, createdAt, children }: { userId: string; createdAt?: string; children: ReactNode }) {
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  useEffect(() => { pathRef.current = pathname; }, [pathname]);
  const { activeId } = useActiveSpace();
  const lock = useLock();
  const blocked = lock.locked || lock.obscured;
  const anchors = useRef(new Map<string, Anchor>());
  // Dynamic detail routes live only in this run's memory, never in saved progress.
  const visitedRoutes = useRef(new Map<string, string>());
  const [state, setState] = useState<GuideState>(emptyGuides);
  const stateRef = useRef(state);
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState<Running | null>(null);
  const [mode, setMode] = useState<"welcome" | null>(null);
  const [target, setTarget] = useState<Rect | null>(null);
  const [missing, setMissing] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const presented = useRef(false);
  const pendingNavigation = useRef<(() => void) | null>(null);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const writes = useRef(Promise.resolve());
  const offered = useRef<GuideId | null>(null);
  const runningRef = useRef(running);
  useEffect(() => { runningRef.current = running; }, [running]);
  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  const definitions = useMemo(() => guideDefinitions(Platform.OS === "ios"), []);
  const current = definitions.find(guide => guide.id === running?.id);
  const currentStep = current && running ? current.steps[running.index] : null;

  useEffect(() => {
    let cancelled = false;
    void deviceStore.get(guideStorageKey(userId)).then(raw => {
      if (cancelled) return;
      const value = readGuides(raw);
      stateRef.current = value; setState(value); setReady(true);
    }).catch(() => {
      if (!cancelled) { setReady(true); setNotice("Guide progress could not be loaded. You can still explore the guides."); }
    });
    return () => { cancelled = true; };
  }, [userId]);
  const update = useCallback((transform: (previous: GuideState) => GuideState) => {
    const next = transform(stateRef.current); stateRef.current = next; setState(next);
    writes.current = writes.current.then(() => deviceStore.set(guideStorageKey(userId), JSON.stringify(next))).catch(() => {
      setNotice("Your guide progress is saved for this session. Device storage is unavailable.");
    });
  }, [userId]);
  const register = useCallback((id: string, entry: Anchor) => {
    anchors.current.set(id, entry);
    return () => { if (anchors.current.get(id) === entry) anchors.current.delete(id); };
  }, []);
  const flushNavigation = useCallback(() => {
    presented.current = false;
    const pending = pendingNavigation.current; pendingNavigation.current = null; pending?.();
  }, []);
  const navigate = useCallback((route: string, after?: () => void) => {
    const nativeSheet = ["/pay-sheet", "/connect"].some(path => path === route || path === pathRef.current);
    if (!nativeSheet || route === pathRef.current) {
      navigateGuideRoute(route, pathRef.current); after?.(); return;
    }
    // UIKit cannot present a form sheet while the tutorial Modal is presented.
    // Hide it first and navigate on onDismiss; Android has no onDismiss callback.
    setTransitioning(true);
    pendingNavigation.current = () => {
      navigateGuideRoute(route, pathRef.current);
      transitionTimer.current = setTimeout(() => { setTransitioning(false); after?.(); }, 450);
    };
    if (!presented.current) flushNavigation();
    else if (Platform.OS !== "ios") transitionTimer.current = setTimeout(flushNavigation, 16);
  }, [flushNavigation]);
  useEffect(() => () => { if (transitionTimer.current) clearTimeout(transitionTimer.current); pendingNavigation.current = null; }, []);
  const pause = useCallback(() => {
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    pendingNavigation.current = null; presented.current = false; setTransitioning(false);
    setRunning(null); setTarget(null); setMissing(false); setMode(null);
    visitedRoutes.current.clear();
    if (runningRef.current || modeRef.current) setNotice("Guide paused. Resume in More → Guides & help.");
  }, []);
  const start = useCallback((id: GuideId, replay = false) => {
    if (!ready || blocked) return;
    const definition = definitions.find(guide => guide.id === id)!;
    let index = guideStepIndex(definition, stateRef.current.progress[id], replay);
    // Re-select a currently accessible record after resuming away from its detail page.
    if (!definition.steps[index].route && !stepMatchesPath(definition.steps[index], pathRef.current)) {
      while (index > 0 && !definition.steps[index].route) index--;
    }
    Keyboard.dismiss(); setNotice(null); setMode(null); setMissing(false); setTarget(null);
    visitedRoutes.current.clear(); offered.current = id;
    update(previous => ({ ...previous, welcomeSeen: true, progress: { ...previous.progress, [id]: progressFor(definition.steps, index, "paused") } }));
    setRunning({ id, index });
    const route = definition.steps[index].route;
    if (route) navigate(route);
  }, [ready, blocked, definitions, update, navigate]);
  const offerWelcome = useCallback(() => {
    if (!ready || blocked) return;
    Keyboard.dismiss(); setRunning(null); setTarget(null); setMode("welcome"); offered.current = "orientation";
    update(previous => ({ ...previous, welcomeSeen: true }));
  }, [ready, blocked, update]);
  const considerWelcome = useCallback(() => {
    if (ready && !blocked && pathname === "/" && !stateRef.current.welcomeSeen && canOfferWelcome(createdAt, Date.now())) offerWelcome();
  }, [ready, blocked, pathname, createdAt, offerWelcome]);
  useEffect(() => {
    const app = AppState.addEventListener("change", value => { if (value !== "active") pause(); });
    const keyboard = Keyboard.addListener("keyboardDidShow", pause);
    return () => { app.remove(); keyboard.remove(); };
  }, [pause]);
  const previousSpace = useRef(activeId);
  useEffect(() => {
    if (previousSpace.current !== activeId) { pause(); previousSpace.current = activeId; }
  }, [activeId, pause]);
  useEffect(() => {
    if (!blocked) return;
    const timer = setTimeout(pause, 0); return () => clearTimeout(timer);
  }, [blocked, pause]);

  useEffect(() => {
    if (!running || !currentStep || blocked) return;
    let alive = true, revealed: Anchor | undefined, measured = false;
    let begun = 0;
    function measure() {
      if (!alive || !currentStep) return;
      if (!begun) begun = Date.now();
      // Keep the tour alive through route transitions, native sheets and data loading.
      // A failed navigation gets a Continue action instead of ending the walkthrough.
      if (!stepMatchesPath(currentStep, pathRef.current)) {
        if (Date.now() - begun > 8000) setMissing(true);
        return;
      }
      const anchor = anchors.current.get(currentStep.anchor);
      if (anchor) {
        if (revealed !== anchor) {
          try { anchor.reveal?.(); } catch { /* A list may still be settling. */ }
          revealed = anchor;
        }
        anchor.measure((x, y, width, height) => {
          if (!alive || !Number.isFinite(x + y + width + height) || width <= 0 || height <= 0) return;
          measured = true; setMissing(false);
          visitedRoutes.current.set(currentStep.id, pathRef.current);
          setTarget(old => old && Math.abs(old.x - x) < 1 && Math.abs(old.y - y) < 1 && old.width === width && old.height === height ? old : { x, y, width, height });
        });
      } else { setTarget(null); }
      if (Date.now() - begun > 3000 && (!anchor || !measured)) setMissing(true);
    }
    const first = requestAnimationFrame(measure), timer = setInterval(measure, 160);
    return () => { alive = false; cancelAnimationFrame(first); clearInterval(timer); };
  }, [running, currentStep, blocked]);

  function finish() {
    if (!running || !current) return;
    update(previous => ({ ...previous, progress: { ...previous.progress, [running.id]: progressFor(current.steps, running.index, "completed") } }));
    setRunning(null); setTarget(null); setMissing(false); setMode(null); presented.current = false;
    setNotice(`${current.title} complete. You can replay it in Guides & help.`);
  }
  function enter(index: number, follow?: () => void) {
    if (!running || !current) return;
    if (index >= current.steps.length) { finish(); return; }
    const step = current.steps[index];
    update(previous => ({ ...previous, progress: { ...previous.progress, [running.id]: progressFor(current.steps, index, "paused") } }));
    setTarget(null); setMissing(false); setRunning({ ...running, index });
    if (step.route) {
      // Re-measure on the same page; don't reset filters or remount a tab per pointer.
      if (step.route !== pathRef.current) navigate(step.route);
    } else if (follow) follow();
    else {
      const visited = visitedRoutes.current.get(step.id);
      if (visited) navigate(visited);
    }
  }
  function next() {
    if (!running || !current || !currentStep) return;
    const anchor = anchors.current.get(currentStep.anchor);
    if (!anchor || !stepMatchesPath(currentStep, pathname)) { setMissing(true); return; }
    const index = running.index + 1;
    if (index < current.steps.length && !current.steps[index].route && !anchor.follow) {
      enter(nextStepIndex(current.steps, running.index));
    } else enter(index, currentStep.follow ? anchor.follow : undefined);
  }
  function skipItem() {
    if (!running || !current) return;
    const index = nextStepIndex(current.steps, running.index);
    if (index >= current.steps.length) { pause(); setNotice("This guide will be ready when the item is available."); }
    else enter(index);
  }
  function back() {
    if (!running || !current || running.index === 0) return;
    let index = running.index - 1;
    if (!current.steps[index].route && !visitedRoutes.current.has(current.steps[index].id)) {
      while (index > 0 && !current.steps[index].route) index--;
    }
    enter(index);
  }
  function showGuides() { navigate("/guides", () => { setRunning(null); setMode(null); setTarget(null); }); }
  const claimSuggestion = useCallback((id: GuideId) => {
    if (stateRef.current.progress[id] || stateRef.current.dismissed.includes(id)) return false;
    if (offered.current && offered.current !== id) return false;
    offered.current = id; return true;
  }, []);
  const dismissSuggestion = useCallback((id: GuideId) => update(previous => ({ ...previous, dismissed: [...new Set([...previous.dismissed, id])] })), [update]);
  const visible = !blocked && (!!mode || !!running);
  const overlayVisible = visible && !transitioning;
  const lastStep = !!running && !!current && running.index === current.steps.length - 1;
  const action = mode === "welcome" ? "Show essentials" : missing ? "Skip item" : !target ? "Skip item" : lastStep ? "Done" : currentStep?.action ?? "Next";
  const title = mode === "welcome" ? "Start with the essentials."
    : missing ? "Nothing to show here yet" : !target ? "Finding the next item…" : currentStep?.title ?? "";
  const body = mode === "welcome" ? "Three quick pointers to get started. Choose a short task guide whenever you need help later."
    : missing ? current?.missing ?? "You can skip this item and return later."
      : !target ? "Your place is saved." : currentStep?.body ?? "";

  return <GuidesContext.Provider value={{ ready, state, definitions, active: !!running || !!mode, notice, register, start, offerWelcome, considerWelcome, pause, claimSuggestion, dismissSuggestion }}>
    <View style={{ flex: 1 }} accessibilityElementsHidden={overlayVisible} importantForAccessibility={overlayVisible ? "no-hide-descendants" : "auto"}>{children}</View>
    {visible ? <GuideOverlay
      visible={overlayVisible} onShow={() => { presented.current = true; }} onDismiss={flushNavigation}
      mode={mode ?? (missing ? "missing" : target ? "coach" : "loading")}
      title={title} body={body} action={action}
      label={mode === "welcome" ? "Welcome to OneLedger" : current?.title ?? "Guide"}
      step={running?.index ?? 0} total={current?.steps.length ?? 0} target={target}
      onClose={() => { if (mode) { presented.current = false; setMode(null); } else pause(); }} onBack={back} onGuides={showGuides}
      onNext={() => {
        if (mode === "welcome") start("orientation", true);
        else if (missing || !target) skipItem();
        else next();
      }}
    /> : null}
  </GuidesContext.Provider>;
}
