import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import CategorizationRules from "@/app/(app)/categorization-rules";
import { resetRouterMock } from "@/test/router-mock";

const mockFetch = jest.fn();
const mockSet = jest.fn();
const mockActive = { current: { id: "ws-1", kind: "household", name: "Home" } as unknown };

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/api/mobile-api", () => ({
  fetchRules: () => mockFetch(),
  setRuleActive: (...a: unknown[]) => mockSet(...a),
}));
jest.mock("@/features/spaces/ActiveSpaceProvider", () => ({
  useActiveSpace: () => ({ active: mockActive.current, activeId: "ws-1" }),
}));

const rule = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  title: "Simba",
  categoryLabel: "Food",
  summary: 'contains "Simba" · out',
  active: true,
  originLabel: "Created by you",
  scopeLabel: null,
  matchedLabel: "Matched 3 times",
  ...over,
});

beforeEach(() => {
  resetRouterMock();
  mockFetch.mockReset();
  mockSet.mockReset();
  mockActive.current = { id: "ws-1", kind: "household", name: "Home" };
});

describe("Categorization rules screen", () => {
  it("lists each rule with its sentence and marks a paused one", async () => {
    mockFetch.mockResolvedValue({ ok: true, rules: [rule(), rule({ id: "r2", title: "Old", active: false })] });
    await render(<CategorizationRules />);
    expect(await screen.findByText("Simba")).toBeTruthy();
    expect(screen.getAllByText('contains "Simba" · out')).toHaveLength(2);
    expect(screen.getAllByText("Paused")).toHaveLength(1);
    expect(screen.getByLabelText("Pause rule Simba")).toBeTruthy();
    expect(screen.getByLabelText("Resume rule Old")).toBeTruthy();
  });

  it("pauses a rule in the active Space by naming that Space, then reloads from the server", async () => {
    mockFetch.mockResolvedValue({ ok: true, rules: [rule()] });
    mockSet.mockResolvedValue({ ok: true, rule: rule({ active: false }) });
    await render(<CategorizationRules />);
    await fireEvent.press(await screen.findByLabelText("Pause rule Simba"));
    await waitFor(() => expect(mockSet).toHaveBeenCalledWith("ws-1", "r1", false));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  });

  it("shows the server's refusal instead of pretending it worked", async () => {
    mockFetch.mockResolvedValue({ ok: true, rules: [rule()] });
    mockSet.mockResolvedValue({ ok: false, reason: "error", message: "You can view rules in this Space but not change them." });
    await render(<CategorizationRules />);
    await fireEvent.press(await screen.findByLabelText("Pause rule Simba"));
    expect(await screen.findByText("You can view rules in this Space but not change them.")).toBeTruthy();
  });

  it("says so when there are no rules", async () => {
    mockFetch.mockResolvedValue({ ok: true, rules: [] });
    await render(<CategorizationRules />);
    expect(await screen.findByText("No rules yet")).toBeTruthy();
  });

  it("offers a retry for a failed read", async () => {
    mockFetch.mockResolvedValue({ ok: false, reason: "error", message: "Couldn't load your rules." });
    await render(<CategorizationRules />);
    expect(await screen.findByText("Try again")).toBeTruthy();
  });

  it("ignores a second tap while a change is in flight", async () => {
    mockFetch.mockResolvedValue({ ok: true, rules: [rule()] });
    let finish: (v: unknown) => void = () => {};
    mockSet.mockReturnValue(new Promise((r) => (finish = r)));
    await render(<CategorizationRules />);
    const button = await screen.findByLabelText("Pause rule Simba");
    // Two taps before any render: the ref guard, not the disabled state, must stop the second.
    void fireEvent.press(button);
    void fireEvent.press(button);
    await waitFor(() => expect(mockSet).toHaveBeenCalledTimes(1));
    finish({ ok: true, rule: rule({ active: false }) });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(mockSet).toHaveBeenCalledTimes(1);
  });
});
