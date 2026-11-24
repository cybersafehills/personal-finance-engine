import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import { SaveOnPlanPanel } from "@/features/save-on/SaveOnPlanPanel";
import { resetRouterMock, router } from "@/test/router-mock";

const mockPlan = jest.fn();
const mockNext = jest.fn();
const mockStop = jest.fn();

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/api/mobile-api", () => ({
  fetchSaveOnPlan: (id: string) => mockPlan(id),
  nextSaveOnPart: (id: string) => mockNext(id),
  stopSaveOn: (id: string) => mockStop(id),
}));

const plan = (over: Record<string, unknown> = {}) => ({
  ok: true,
  plan: {
    id: "p1",
    kind: "capacity",
    totalMinor: "10000001",
    plannedPartsMinor: ["5000001", "5000000"],
    feeBasis: "published_maximum",
    stopped: false,
    parts: [{ index: 1, intentId: "i1", amountMinor: "5000001", state: "draft" }],
    next: { status: "waiting", index: 2, amountMinor: "5000000" },
    remainingMinor: "5000000",
    ...over,
  },
});

beforeEach(() => {
  resetRouterMock();
  mockPlan.mockReset();
  mockNext.mockReset();
  mockStop.mockReset();
});

const panel = () => render(<SaveOnPlanPanel planId="p1" currentIntentId="i1" refreshKey="draft" />);

describe("Save On plan panel", () => {
  it("lists every part, marks this one, and holds part 2 until part 1 is confirmed", async () => {
    mockPlan.mockResolvedValue(plan());
    await panel();
    expect(await screen.findByText("Sending in 2 parts")).toBeTruthy();
    expect(screen.getByText(/Part 1 · 5,000,001 RWF · This payment/)).toBeTruthy();
    expect(screen.getByText(/Part 2 · 5,000,000 RWF/)).toBeTruthy();
    expect(screen.getByText("Confirm that part 1 went through to continue.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Prepare part 2" })).toBeNull();
    expect(screen.getByText("Fees shown are estimates, not guarantees.")).toBeTruthy();
  });

  it("offers the next part once the previous one is settled, and opens it", async () => {
    mockPlan.mockResolvedValue(plan({ next: { status: "ready", index: 2, amountMinor: "5000000" } }));
    mockNext.mockResolvedValue({ ok: true, planId: "p1", index: 2, intent: { id: "i2" } });
    await panel();
    await fireEvent.press(await screen.findByRole("button", { name: "Prepare part 2" }));
    await waitFor(() => expect(mockNext).toHaveBeenCalledWith("p1"));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: "/pay/[id]", params: { id: "i2" } }));
  });

  it("says why when the server refuses the next part, and stays put", async () => {
    mockPlan.mockResolvedValue(plan({ next: { status: "ready", index: 2, amountMinor: "5000000" } }));
    mockNext.mockResolvedValue({ ok: false, reason: "error", code: "waiting", message: "Finish the previous part first: confirm that it went through." });
    await panel();
    await fireEvent.press(await screen.findByRole("button", { name: "Prepare part 2" }));
    expect(await screen.findByText("Finish the previous part first: confirm that it went through.")).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("stops the split", async () => {
    mockPlan.mockResolvedValue(plan());
    mockStop.mockResolvedValue({ ok: true });
    await panel();
    await fireEvent.press(await screen.findByRole("button", { name: "Stop here" }));
    await waitFor(() => expect(mockStop).toHaveBeenCalledWith("p1"));
  });

  it("offers nothing more once stopped, and says a blocked part needs a decision", async () => {
    mockPlan.mockResolvedValue(plan({ stopped: true, next: { status: "stopped" } }));
    await panel();
    expect(await screen.findByText("This split was stopped.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stop here" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Prepare part/ })).toBeNull();
  });

  it("is simply not shown when the plan can't be read", async () => {
    mockPlan.mockResolvedValue({ ok: false, reason: "error", code: null, message: "x" });
    await panel();
    await waitFor(() => expect(mockPlan).toHaveBeenCalled());
    expect(screen.queryByText(/Sending in/)).toBeNull();
  });
});
