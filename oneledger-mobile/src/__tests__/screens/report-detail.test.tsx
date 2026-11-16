import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import ReportDetail from "@/app/(app)/report/[id]";
import { resetRouterMock, setParams } from "@/test/router-mock";

const mockFetch = jest.fn();
const mockDownload = jest.fn();
const mockOpenUrl = jest.fn();

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("expo-linking", () => ({ openURL: (url: string) => mockOpenUrl(url) }));
jest.mock("@/api/mobile-api", () => ({
  fetchReport: (id: string) => mockFetch(id),
  fetchReportDownload: (id: string) => mockDownload(id),
}));

const full = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  status: "generated",
  statusLabel: "Generated",
  dateLabel: "August 24, 2026",
  timezone: "Africa/Kigali",
  generatedLabel: "Aug 25, 12:07 AM",
  errorMessage: null,
  hasDocument: true,
  snapshot: {
    closingBalanceRwf: 120000,
    netMovementRwf: 20000,
    moneyReceivedRwf: 50000,
    moneySpentRwf: 30000,
    feesRwf: 400,
    transactionCount: 7,
    largestOutflowRwf: 15000,
    largestInflowRwf: null,
  },
  categories: [
    { category: "Food", amountRwf: 20000, transactionCount: 4, percentOfSpending: 66.6 },
    { category: "Uncategorized", amountRwf: 10000, transactionCount: 1, percentOfSpending: 33.3 },
  ],
  budget: {
    allocations: [
      { type: "WANTS", label: "Wants", targetMinor: 100000, actualMinor: 82000, remainingMinor: 18000, percentConsumed: 82, projectedMinor: null, status: "watch" },
      { type: "ESSENTIALS", label: "Essentials", targetMinor: 50000, actualMinor: 60000, remainingMinor: -10000, percentConsumed: 120, projectedMinor: null, status: "exceeded" },
    ],
  },
  trends: [
    { label: "Spending", valueLabel: "30,000 RWF", changePercent: 20, tone: "negative" },
    { label: "Transactions", valueLabel: "7", changePercent: 40, tone: "neutral" },
  ],
  alerts: [{ id: "a1", tone: "attention", message: "Total spending today (30,000 RWF) was higher than usual." }],
  forecast: { projectedMonthEndSpendRwf: 31001, disclaimer: "A projection, not a promise." },
  insights: { summary: "Spending was steady.", observations: ["Food led."] },
  ...over,
});
const loaded = (over: Record<string, unknown> = {}) => ({ ok: true, report: full(over) });

beforeEach(() => {
  resetRouterMock();
  setParams({ id: "r1" });
  [mockFetch, mockDownload, mockOpenUrl].forEach((m) => m.mockReset());
  mockFetch.mockResolvedValue(loaded());
});

describe("Report detail", () => {
  it("shows the day, the closing balance and the net movement", async () => {
    await render(<ReportDetail />);
    expect(await screen.findByText("August 24, 2026")).toBeTruthy();
    expect(screen.getByText("Daily financial report · Africa/Kigali")).toBeTruthy();
    expect(screen.getByText("120,000 RWF")).toBeTruthy();
    expect(screen.getByText("+20,000 RWF net movement")).toBeTruthy();
  });

  it("shows the day's activity tiles, leaving out a largest inflow it doesn't have", async () => {
    await render(<ReportDetail />);
    expect(await screen.findByText("Received")).toBeTruthy();
    expect(screen.getByText("50,000 RWF")).toBeTruthy();
    expect(screen.getByText("Largest outflow")).toBeTruthy();
    expect(screen.queryByText("Largest inflow")).toBeNull();
  });

  it("shows the spending breakdown, flagging Uncategorized", async () => {
    await render(<ReportDetail />);
    expect(await screen.findByText("Food")).toBeTruthy();
    expect(screen.getByText("4 transactions · 67%")).toBeTruthy();
    expect(screen.getByText("1 transaction · 33%")).toBeTruthy();
    expect(screen.getByLabelText("Uncategorized share of spending")).toBeTruthy();
  });

  it("shows budget health, with what is left and what is over", async () => {
    await render(<ReportDetail />);
    expect(await screen.findByText("Wants")).toBeTruthy();
    expect(screen.getByText("82,000 RWF of 100,000 RWF · 18,000 RWF left")).toBeTruthy();
    expect(screen.getByText("60,000 RWF of 50,000 RWF · 10,000 RWF over")).toBeTruthy();
    expect(screen.getByText("Over budget")).toBeTruthy();
  });

  it("says so when there is no active budget", async () => {
    mockFetch.mockResolvedValue(loaded({ budget: null }));
    await render(<ReportDetail />);
    expect(await screen.findByText("No active RWF budget for this period.")).toBeTruthy();
  });

  it("shows trends with their change, and spells the tone out for a screen reader", async () => {
    await render(<ReportDetail />);
    expect(await screen.findByText("+20%")).toBeTruthy();
    expect(screen.getByLabelText("Spending 30,000 RWF, +20% up, worth a look")).toBeTruthy();
    expect(screen.getByLabelText("Transactions 7, +40%")).toBeTruthy();
  });

  it("says when there are no trends or alerts or spending", async () => {
    mockFetch.mockResolvedValue(loaded({ trends: [], alerts: [], categories: [] }));
    await render(<ReportDetail />);
    expect(await screen.findByText("Not enough history yet for a trend comparison.")).toBeTruthy();
    expect(screen.getByText("No financial alerts detected.")).toBeTruthy();
    expect(screen.getByText("No spending recorded for this day.")).toBeTruthy();
  });

  it("shows the watch-outs as the server's own sentences", async () => {
    await render(<ReportDetail />);
    expect(await screen.findByText("Total spending today (30,000 RWF) was higher than usual.")).toBeTruthy();
  });

  it("shows the outlook and the AI commentary with its disclaimer", async () => {
    await render(<ReportDetail />);
    expect(await screen.findByText(/projected to reach 31,001 RWF by month end/)).toBeTruthy();
    expect(screen.getByText("A projection, not a promise.")).toBeTruthy();
    expect(screen.getByText("Spending was steady.")).toBeTruthy();
    expect(screen.getByText("• Food led.")).toBeTruthy();
    expect(screen.getByText(/not financial advice/)).toBeTruthy();
  });

  it("says when there is no projection, and shows no insights section without commentary", async () => {
    mockFetch.mockResolvedValue(loaded({ forecast: null, insights: null }));
    await render(<ReportDetail />);
    expect(await screen.findByText("Not enough history yet for a month-end projection.")).toBeTruthy();
    expect(screen.queryByText("ONELEDGER INSIGHTS")).toBeNull();
  });

  it("shows a dash, not zero, when the closing balance isn't known", async () => {
    mockFetch.mockResolvedValue(loaded({ snapshot: { ...full().snapshot, closingBalanceRwf: null } }));
    await render(<ReportDetail />);
    expect(await screen.findByLabelText("Closing balance not available")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("explains a report that failed to generate, with the reason", async () => {
    mockFetch.mockResolvedValue(loaded({ status: "generation_failed", statusLabel: "Generation failed", snapshot: null, hasDocument: false, errorMessage: "The ledger was unavailable." }));
    await render(<ReportDetail />);
    expect(await screen.findByText("This report could not be generated")).toBeTruthy();
    expect(screen.getByText("The ledger was unavailable.")).toBeTruthy();
    expect(screen.queryByText("Download PDF")).toBeNull();
  });

  it("explains a report that hasn't been generated yet", async () => {
    mockFetch.mockResolvedValue(loaded({ status: "scheduled", statusLabel: "Scheduled", snapshot: null, hasDocument: false, generatedLabel: null }));
    await render(<ReportDetail />);
    expect(await screen.findByText("Report not yet available")).toBeTruthy();
    expect(screen.queryByText("Download PDF")).toBeNull();
  });

  it("offers a retry when loading fails (a failed read is not 'not found')", async () => {
    mockFetch.mockResolvedValue({ ok: false, reason: "error", message: "Couldn't load that report. Check your connection and try again." });
    await render(<ReportDetail />);
    expect(await screen.findByText(/Couldn't load that report/)).toBeTruthy();
    expect(screen.getByText("Try again")).toBeTruthy();
  });

  it("explains a report that can't be found, with no retry", async () => {
    mockFetch.mockResolvedValue({ ok: false, reason: "not_found", message: "That report couldn't be found." });
    await render(<ReportDetail />);
    expect(await screen.findByText("That report couldn't be found.")).toBeTruthy();
    expect(screen.queryByText("Try again")).toBeNull();
  });

  describe("the PDF", () => {
    it("asks for a fresh link and opens it", async () => {
      mockDownload.mockResolvedValue({ ok: true, url: "https://files.example.test/r1.pdf?token=abc" });
      mockOpenUrl.mockResolvedValue(undefined);
      await render(<ReportDetail />);

      await fireEvent.press(await screen.findByText("Download PDF"));
      await waitFor(() => expect(mockOpenUrl).toHaveBeenCalledWith("https://files.example.test/r1.pdf?token=abc"));
      expect(mockDownload).toHaveBeenCalledWith("r1");
    });

    it("asks again on every tap (the link only lives five minutes)", async () => {
      mockDownload.mockResolvedValueOnce({ ok: true, url: "https://f.test/1" }).mockResolvedValueOnce({ ok: true, url: "https://f.test/2" });
      mockOpenUrl.mockResolvedValue(undefined);
      await render(<ReportDetail />);

      await fireEvent.press(await screen.findByText("Download PDF"));
      await waitFor(() => expect(mockOpenUrl).toHaveBeenCalledWith("https://f.test/1"));
      await fireEvent.press(screen.getByText("Download PDF"));
      await waitFor(() => expect(mockOpenUrl).toHaveBeenCalledWith("https://f.test/2"));
      expect(mockDownload).toHaveBeenCalledTimes(2);
    });

    it("says why when the PDF can't be prepared", async () => {
      mockDownload.mockResolvedValue({ ok: false, reason: "error", message: "Couldn't prepare the PDF. Try again." });
      await render(<ReportDetail />);
      await fireEvent.press(await screen.findByText("Download PDF"));
      expect(await screen.findByText("Couldn't prepare the PDF. Try again.")).toBeTruthy();
      expect(mockOpenUrl).not.toHaveBeenCalled();
    });

    it("says so when the link can't be opened", async () => {
      mockDownload.mockResolvedValue({ ok: true, url: "https://f.test/1" });
      mockOpenUrl.mockRejectedValue(new Error("no handler"));
      await render(<ReportDetail />);
      await fireEvent.press(await screen.findByText("Download PDF"));
      expect(await screen.findByText("Couldn't open the PDF. Try again.")).toBeTruthy();
    });

    it("treats a double tap as one request", async () => {
      let finish: (v: unknown) => void = () => {};
      mockDownload.mockReturnValue(new Promise((resolve) => (finish = resolve)));
      mockOpenUrl.mockResolvedValue(undefined);
      await render(<ReportDetail />);

      const button = await screen.findByText("Download PDF");
      await act(async () => {
        fireEvent.press(button);
        fireEvent.press(button);
        fireEvent.press(button);
      });
      expect(mockDownload).toHaveBeenCalledTimes(1);
      await act(async () => finish({ ok: true, url: "https://f.test/1" }));
    });
  });
});
