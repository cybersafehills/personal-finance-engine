import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import { setPayConfigCache } from "@/features/pay/config-cache";
import { SaveOnSavingsCard } from "@/features/save-on/SaveOnSavingsCard";
import { SAVINGS_PERIODS } from "@/features/save-on/savings";
import { resetRouterMock, router } from "@/test/router-mock";

const mockFetch = jest.fn();
jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/api/mobile-api", () => ({ fetchSaveOnSavings: () => mockFetch() }));

const period = (key: string, saved: string, would: string, plans: number, transfers: number) => ({
  key,
  savedMinor: saved,
  wouldHavePaidMinor: would,
  paidMinor: String(Number(would) - Number(saved)),
  plans,
  transfers,
});
const savings = (over: Record<string, unknown> = {}) => ({
  periods: SAVINGS_PERIODS.map((p) => {
    if (p.key === "24h" || p.key === "7d") return period(p.key, "0", "0", 0, 0);
    return period(p.key, "1000", "1500", 1, 2);
  }),
  inProgress: { plans: 1, expectedSavingMinor: "500" },
  recent: [{ planId: "p1", completedAt: "2026-11-14T10:00:00Z", totalMinor: "180000", savedMinor: "1000", transfers: 2 }],
  ...over,
});

beforeEach(() => {
  resetRouterMock();
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: true, savings: savings() });
  setPayConfigCache({ paySplits: true });
});
afterEach(() => setPayConfigCache(null));

describe("Save On savings card (full)", () => {
  it("shows the saving for the chosen period and switches period instantly", async () => {
    await render(<SaveOnSavingsCard />);
    // Last month is the default: a plan finished ten days ago saved 1,000 RWF.
    expect(await screen.findByText("Saved with Save On")).toBeTruthy();
    expect(screen.getAllByText("1,000 RWF").length).toBeGreaterThan(0);
    expect(screen.getByText(/Last month · 1 payment in parts · 2 transfers/)).toBeTruthy();
    expect(screen.getByText("As one transfer: 1,500 RWF in fees")).toBeTruthy();
    expect(screen.getByText("As parts: 500 RWF in fees")).toBeTruthy();
    expect(screen.getByText("Saved 1,000 RWF (66% of the fees)")).toBeTruthy();

    // The same plan finished ten days ago, so it is outside the last 7 days: nothing saved there.
    await fireEvent.press(screen.getByRole("button", { name: "Last 7 days" }));
    expect(screen.getByText("Nothing saved yet")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Last 2 weeks" }));
    expect(screen.getByText("Saved 1,000 RWF (66% of the fees)")).toBeTruthy();
  });

  it("offers every window the person asked for", async () => {
    await render(<SaveOnSavingsCard />);
    await screen.findByText("Saved with Save On");
    for (const label of ["Last 24 hours", "Last 7 days", "Last 2 weeks", "Last month", "Last 3 months", "Last 12 months", "All time"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeTruthy();
    }
  });

  it("says what is still being sent, and lists the latest savings", async () => {
    await render(<SaveOnSavingsCard />);
    expect(await screen.findByText("1 in progress: about 500 RWF more once every part is sent.")).toBeTruthy();
    expect(screen.getByText("Latest savings")).toBeTruthy();
    expect(screen.getByText(/180,000 RWF in 2 parts · saved 1,000 RWF/)).toBeTruthy();
    expect(screen.getByText(/Estimates from your provider's published fees/)).toBeTruthy();
  });

  it("explains the empty state when nothing has been saved yet", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      savings: savings({
        periods: SAVINGS_PERIODS.map((p) => period(p.key, "0", "0", 0, 0)),
        inProgress: { plans: 0, expectedSavingMinor: "0" },
        recent: [],
      }),
    });
    await render(<SaveOnSavingsCard />);
    expect(await screen.findByText("Nothing saved yet")).toBeTruthy();
    expect(screen.getByText(/the fees you saved show up here/)).toBeTruthy();
  });

  it("is hidden when the savings can't be read, never a made-up zero", async () => {
    mockFetch.mockResolvedValue({ ok: false, reason: "error", code: null, message: "x" });
    await render(<SaveOnSavingsCard />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(screen.queryByText("Saved with Save On")).toBeNull();
    expect(screen.queryByText("Nothing saved yet")).toBeNull();
  });
});

describe("Save On savings card (Home tile)", () => {
  it("is one tile with the month's saving and a way to the full view", async () => {
    await render(<SaveOnSavingsCard compact />);
    expect(await screen.findByText("1,000 RWF")).toBeTruthy();
    expect(screen.getByText("Last month")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "See all savings" }));
    expect(router.push).toHaveBeenCalledWith("/save-on");
  });

  it("shows nothing at all until Save On has saved (or is saving) something", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      savings: savings({
        periods: SAVINGS_PERIODS.map((p) => period(p.key, "0", "0", 0, 0)),
        inProgress: { plans: 0, expectedSavingMinor: "0" },
        recent: [],
      }),
    });
    await render(<SaveOnSavingsCard compact />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(screen.queryByText("Saved with Save On")).toBeNull();
  });
});

describe("when Save On is off for this user", () => {
  it("never asks the server and shows nothing", async () => {
    setPayConfigCache({ paySplits: false });
    await render(<SaveOnSavingsCard />);
    await new Promise((r) => setTimeout(r, 50));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(screen.queryByText("Saved with Save On")).toBeNull();
  });
});
