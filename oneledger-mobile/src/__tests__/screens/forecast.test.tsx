import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import Forecast from "@/app/(app)/forecast";
import { resetRouterMock, setParams } from "@/test/router-mock";

const mockReveal = jest.fn();
const mockForecast = jest.fn();
const mockFacts = jest.fn();

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
// The real scroll view provides the "scroll to this anchor" function to everything INSIDE the screen.
// Reproduce that structure so a page that reads it from the wrong place gets nothing, as on a phone.
jest.mock("@/features/guides/GuideScrollView", () => {
  const { GuideScrollContext } = jest.requireActual("@/features/guides/context");
  const { ScrollView } = jest.requireActual("react-native");
  return { GuideScrollView: ({ children, ...rest }: { children: React.ReactNode }) => <GuideScrollContext.Provider value={mockReveal}><ScrollView {...rest}>{children}</ScrollView></GuideScrollContext.Provider> };
});
jest.mock("@/features/spaces/ActiveSpaceProvider", () => ({ useActiveSpace: () => ({ activeId: "w1", spaces: [], active: null }) }));
jest.mock("@/features/insights/forecast", () => ({ ...jest.requireActual("@/features/insights/forecast"), fetchForecast: (...a: unknown[]) => mockForecast(...a) }));
jest.mock("@/features/insights/intelligence", () => ({ ...jest.requireActual("@/features/insights/intelligence"), fetchIntelligence: (...a: unknown[]) => mockFacts(...a), notifyInsightChange: jest.fn() }));
jest.mock("@/api/mobile-api", () => ({ fetchPeople: async () => ({ ok: false, reason: "unavailable", message: "off" }) }));

const wallet = {
  id: "w1", name: "MTN MoMo", balanceAsOf: "2026-11-19T06:47:00Z", opening: 14_416n, scheduledEnd: 14_416n, estimatedEnd: -354_464n,
  noIncomeEnd: -400_424n, estimatesIncome: false, low: { day: 30, amount: -354_464n }, basis: [], disclaimer: "x",
  points: [{ day: 0, label: "Today", scheduled: 14_416n, estimated: 14_416n }, { day: 30, label: "Day 30", scheduled: 14_416n, estimated: -354_464n }],
};
const facts = {
  ok: true, computedAt: "2026-11-24T08:00:00.000Z", defaultWalletId: "w1", summary: null,
  baseline: { thisMonth: 492_420n, usual: 576_535n, changePercent: -15, direction: "below", monthsCompared: 3, basis: [] },
  anomalies: [{ counterparty: "Kenia", category: null, amount: 13_750n, typical: 3_600n, timesTypical: 3.8, occurredAt: "2026-11-10T08:00:00Z" }], anomaliesTotal: 2,
  recurring: [{ counterparty: "Landlord", category: null, typicalAmount: 2_100n, typicalDay: 13, monthsSeen: 2 }], recurringTotal: 1,
};

beforeEach(() => {
  resetRouterMock();
  mockReveal.mockReset();
  mockForecast.mockResolvedValue({ ok: true, computedAt: "2026-11-24T08:00:00.000Z", wallets: [wallet] });
  mockFacts.mockResolvedValue(facts);
});

// Real time: the page waits ~150ms for layout before it scrolls.
const settle = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); }); };

describe("the outlook page", () => {
  it("orders sections by what needs attention and shows the advert placeholder after the first", async () => {
    await render(<Forecast />);
    await screen.findByText(/Your money may run out in about 2 days/);
    const headings = screen.getAllByRole("header").map((h) => h.props.children);
    expect(headings.filter((h) => h !== "Your money outlook")).toEqual(["The next 30 days", "Payments to check", "Payments that repeat", "Spending this month"]);
    expect(screen.getByText("Advert space")).toBeTruthy();
  });

  it.each(["outlook", "pace", "large", "repeat"])("opened for section %s, it scrolls to that section", async (section) => {
    setParams({ section });
    await render(<Forecast />);
    await screen.findByText(/Your money may run out in about 2 days/);
    expect(mockReveal).not.toHaveBeenCalled(); // not before the layout has settled
    await settle();
    expect(mockReveal).toHaveBeenCalledTimes(1);
    expect(mockReveal.mock.calls[0][0]).toHaveProperty("current"); // an anchor ref, not nothing
  });

  it("keeps the first-visit intro closed when opened for a section, so it cannot push the target away", async () => {
    setParams({ section: "large" });
    await render(<Forecast />);
    await screen.findByText(/Your money may run out in about 2 days/);
    await settle();
    expect(screen.queryByText("What you can do here")).toBeNull();
    expect(screen.getByText("What is this page?")).toBeTruthy();
  });

  it("scrolls to a different anchor for each section", async () => {
    const anchors: unknown[] = [];
    for (const section of ["outlook", "large"]) {
      mockReveal.mockReset();
      setParams({ section });
      const view = await render(<Forecast />);
      await screen.findByText(/Your money may run out in about 2 days/);
      await settle();
      anchors.push(mockReveal.mock.calls[0]?.[0]);
      await view.unmount();
    }
    expect(anchors[0]).toBeDefined();
    expect(anchors[0]).not.toBe(anchors[1]);
  });

  it("opened with no section, or one that does not exist, stays at the top", async () => {
    await render(<Forecast />);
    await screen.findByText(/Your money may run out in about 2 days/);
    await settle();
    expect(mockReveal).not.toHaveBeenCalled();
    setParams({ section: "nonsense" });
    await render(<Forecast />);
    await settle();
    expect(mockReveal).not.toHaveBeenCalled();
  });

  it("does not try to scroll to a section that has nothing to show", async () => {
    mockFacts.mockResolvedValue({ ...facts, anomalies: [], anomaliesTotal: 0 });
    setParams({ section: "large" });
    await render(<Forecast />);
    await screen.findByText(/Your money may run out in about 2 days/);
    await settle();
    expect(mockReveal).not.toHaveBeenCalled();
  });

  it("the 'jump to' chips scroll too", async () => {
    await render(<Forecast />);
    await screen.findByText(/Your money may run out in about 2 days/);
    await fireEvent.press(screen.getByRole("button", { name: /Payments to check\. Worth a look\. Jump to this section/ }));
    await waitFor(() => expect(mockReveal).toHaveBeenCalledTimes(1));
  });
});
