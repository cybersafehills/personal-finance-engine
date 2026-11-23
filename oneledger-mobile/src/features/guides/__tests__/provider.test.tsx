import { useEffect } from "react";
import { Text } from "react-native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { GuidesProvider } from "../GuidesProvider";
import { useGuides, type GuidesContextValue } from "../context";
import { emptyGuides, guideStorageKey } from "../model";
import { GUIDE_REVISION, guideDefinitions } from "../definitions";

type Overlay = { mode: string; title: string; body: string; action: string; step: number; total: number; onNext(): void; onClose(): void; onBack(): void; onSkip?(): void; visible?: boolean; onShow?():void; onDismiss?():void };
let mockPath = "/", mockUser = "u1", mockSpace = "s1", mockCreated = "2020-01-01", mockLocked = false;
let mockOverlay: Overlay;
let mockAutoDismiss = true;
const mockGet = jest.fn(), mockSet = jest.fn(), mockNavigate = jest.fn(), mockDismissTo = jest.fn(), mockFollow = jest.fn();
let guides: GuidesContextValue;
jest.mock("expo-router", () => ({ usePathname: () => mockPath, router: { navigate: (p: unknown) => mockNavigate(p), dismissTo: (p: unknown) => mockDismissTo(p) } }));
jest.mock("@/features/auth/SessionProvider", () => ({ useSession: () => ({ session: { user: { id: mockUser, created_at: mockCreated } } }) }));
jest.mock("@/features/lock/LockProvider", () => ({ useLock: () => ({ locked: mockLocked, obscured: false }) }));
jest.mock("@/features/spaces/ActiveSpaceProvider", () => ({ useActiveSpace: () => ({ activeId: mockSpace }) }));
jest.mock("@/lib/device-store", () => ({ deviceStore: { get: (key: string) => mockGet(key), set: (key: string, value: string) => mockSet(key, value) } }));
jest.mock("../GuideOverlay", () => {
  const { Text, Pressable } = jest.requireActual("react-native");
  const { useEffect } = jest.requireActual("react");
  return { GuideOverlay: (props: Overlay) => {
    useEffect(() => { mockOverlay = props; if (props.visible) props.onShow?.(); else if (mockAutoDismiss) props.onDismiss?.(); }, [props]);
    if (!props.visible) return null;
    return <><Text>{props.title}</Text><Text>{props.body}</Text><Pressable accessibilityRole="button" accessibilityLabel={props.action} onPress={props.onNext}/><Pressable accessibilityRole="button" accessibilityLabel="Pause" onPress={props.onClose}/><Pressable accessibilityRole="button" accessibilityLabel="Previous" onPress={props.onBack}/>{props.onSkip ? <Pressable accessibilityRole="button" accessibilityLabel="Skip section" onPress={props.onSkip}/> : null}</>;
  } };
});
function Probe({ exclude = [] }: { exclude?: string[] }) {
  const value = useGuides()!;
  useEffect(() => { guides = value; }, [value]);
  const register = value.register;
  const excluded = exclude.join(",");
  useEffect(() => {
    const ids = [...new Set(guideDefinitions(false).flatMap(guide => guide.steps.map(step => step.anchor)))];
    const entries = ids.filter(id => !excluded.split(",").includes(id)).map(id => register(id, { measure: cb => cb(20, 150, 250, 70), follow: mockFollow }));
    return () => entries.forEach(remove => remove());
  }, [register, excluded]);
  return <Text>Underlying app</Text>;
}
const mount = (exclude?: string[]) => render(<GuidesProvider><Probe exclude={exclude}/></GuidesProvider>);
const loaded = () => waitFor(() => expect(guides.ready).toBe(true));
const coach = () => waitFor(() => { expect(mockOverlay.mode).toBe("coach"); expect(mockOverlay.visible).toBe(true); });
const start = async (id: Parameters<GuidesContextValue["start"]>[0]) => { await act(() => guides.start(id)); await coach(); };
const next = async () => { await coach(); await fireEvent.press(screen.getByRole("button", { name: mockOverlay.action })); };
const saved = (id: Parameters<GuidesContextValue["start"]>[0], stepId: string) => {
  const definition = guideDefinitions(false).find(guide => guide.id === id)!;
  return JSON.stringify({ ...emptyGuides(), welcomeSeen: true, progress: { [id]: { status: "paused", revision: GUIDE_REVISION, stepId, step: definition.steps.findIndex(step => step.id === stepId) } } });
};
beforeEach(() => {
  mockAutoDismiss = true;
  mockPath = "/"; mockUser = "u1"; mockSpace = "s1"; mockCreated = "2020-01-01"; mockLocked = false;
  mockGet.mockReset().mockResolvedValue(null); mockSet.mockReset().mockResolvedValue(undefined);
  const navigate = (destination: string | { pathname: string }) => { mockPath = typeof destination === "string" ? destination : destination.pathname; };
  mockNavigate.mockReset().mockImplementation(navigate); mockDismissTo.mockReset().mockImplementation(navigate);
  mockFollow.mockReset().mockImplementation(() => { mockPath = "/transaction/current-record"; });
});
it("keeps the introduction to three pointers and ends on the relevant page", async () => {
  await mount(); await loaded(); await start("orientation");
  for (let i=0;i<3;i++) { await coach(); expect(mockOverlay.total).toBe(3); expect(mockOverlay.step).toBe(i); await next(); }
  expect(guides.active).toBe(false);
  expect(mockPath).toBe("/transactions");
  expect(guides.state.progress.orientation?.status).toBe("completed");
  expect(Object.keys(guides.state.progress)).toEqual(["orientation"]);
});
it("finishes each task independently without starting another task or a global tour", async () => {
  await mount(); await loaded();
  for(const definition of guideDefinitions(true)) {
    await start(definition.id);
    for(let i=0;i<definition.steps.length;i++) await next();
    expect(guides.active).toBe(false);
    expect(guides.state.progress[definition.id]?.status).toBe("completed");
  }
  const visited=[...mockNavigate.mock.calls,...mockDismissTo.mock.calls].map(([p])=>typeof p==='string'?p:p.pathname);
  expect(visited).not.toContain('/guides');
});
it("resumes a task by its stable step and restarts obsolete long-tour progress", async () => {
  mockGet.mockResolvedValue(saved("statements","statements-page"));
  await mount(); await loaded(); await start("statements");
  expect(mockOverlay.title).toBe("Check coverage before exporting");
  await act(()=>guides.pause()); await start("statements"); expect(mockOverlay.step).toBe(1);
});
it("does not treat an old 60-step position as part of the new introduction", async () => {
  mockGet.mockResolvedValue(JSON.stringify({...emptyGuides(),progress:{orientation:{status:'paused',revision:2,step:50,stepId:'appearance-page'}}}));
  await mount(); await loaded(); await start("orientation");
  expect(mockOverlay.step).toBe(0); expect(mockOverlay.total).toBe(3);
});
it("moves between the list and details within a focused two-step guide", async () => {
  await mount(); await loaded(); await start("details");
  await next(); await coach(); expect(mockPath).toBe('/transaction/current-record');
  await fireEvent.press(screen.getByRole('button',{name:'Previous'})); await coach();
  expect(mockPath).toBe('/transactions'); expect(mockOverlay.step).toBe(0);
  await next(); await coach(); await next(); expect(guides.active).toBe(false);
});
it("handles an empty record without inventing data or launching another guide", async () => {
  await mount(['first-transaction']); await loaded();
  jest.useFakeTimers();
  try {
    await act(()=>guides.start('details')); await act(()=>jest.advanceTimersByTime(3300));
    expect(mockOverlay.mode).toBe('missing'); expect(mockOverlay.action).toBe('Skip item');
    await act(()=>mockOverlay.onNext());
    expect(guides.active).toBe(false); expect(guides.state.progress.details?.status).toBe('paused');
    expect(mockFollow).not.toHaveBeenCalled();
  } finally {jest.useRealTimers();}
});
it("does not navigate behind an unavailable Pay entry", async () => {
  await mount(['pay-launcher']); await loaded();
  jest.useFakeTimers();
  try {
    await act(()=>guides.start('pay')); await act(()=>jest.advanceTimersByTime(3300));
    await act(()=>mockOverlay.onNext()); expect(guides.active).toBe(false);
    expect(mockNavigate.mock.calls.some(([p])=>p==='/pay-sheet')).toBe(false);
  } finally {jest.useRealTimers();}
});
it("offers a short introduction once to a new account", async () => {
  mockCreated=new Date(Date.now()-3600000).toISOString();
  await mount(); await loaded(); await act(()=>guides.considerWelcome());
  expect(mockOverlay.title).toBe('Start with the essentials.'); expect(mockOverlay.action).toBe('Show essentials');
  await act(()=>mockOverlay.onNext()); await coach(); expect(mockOverlay.total).toBe(3);
});
it("ignores a late storage response from a different identity", async () => {
  let resolveFirst:(raw:string)=>void=()=>{};
  mockGet.mockImplementation((key:string)=>key.endsWith('u1')?new Promise<string>(resolve=>{resolveFirst=resolve}):Promise.resolve(null));
  const ui=await mount();mockUser='u2';await ui.rerender(<GuidesProvider><Probe/></GuidesProvider>);await loaded();
  await act(()=>resolveFirst(saved('statements','statements-page')));
  expect(guides.state.progress).toEqual({});
});
it("retains the task step when Space changes or app lock engages", async () => {
  const ui=await mount();await loaded();await start('transaction');await next();await coach();
  mockSpace='s2';await ui.rerender(<GuidesProvider><Probe/></GuidesProvider>);await waitFor(()=>expect(guides.active).toBe(false));
  expect(guides.state.progress.transaction?.stepId).toBe('transactions-search');
  await start('transaction');mockLocked=true;await ui.rerender(<GuidesProvider><Probe/></GuidesProvider>);
  await waitFor(()=>expect(guides.active).toBe(false));
});
it("selects a current transaction when resuming detail guidance away from its page", async () => {
  mockGet.mockResolvedValue(saved('details','transaction-category'));await mount();await loaded();await start('details');
  expect(mockPath).toBe('/transactions');expect(guides.state.progress.details?.step).toBe(0);expect(mockFollow).not.toHaveBeenCalled();
});
it("dismisses the native tutorial before opening Pay and cancels a paused handoff", async () => {
  mockAutoDismiss=false;await mount();await loaded();await start('pay');await next();
  expect(mockOverlay.visible).toBe(false);expect(mockNavigate.mock.calls.some(([p])=>p==='/pay-sheet')).toBe(false);
  const dismissed=mockOverlay.onDismiss;await act(()=>guides.pause());await act(()=>dismissed?.());
  expect(mockNavigate.mock.calls.some(([p])=>p==='/pay-sheet')).toBe(false);
});
it("keeps contextual invitations task-specific after the introduction is completed", async () => {
  mockGet.mockResolvedValue(JSON.stringify({...emptyGuides(),progress:{orientation:{status:'completed',step:2,revision:GUIDE_REVISION,stepId:'orientation-search'}}}));
  await mount();await loaded();expect(guides.claimSuggestion('details')).toBe(true);expect(guides.claimSuggestion('plan')).toBe(false);
  await act(()=>guides.dismissSuggestion('details'));expect(guides.claimSuggestion('details')).toBe(false);
  await start('transaction');await waitFor(()=>expect(mockSet).toHaveBeenCalledWith(guideStorageKey('u1'),expect.any(String)));
});
