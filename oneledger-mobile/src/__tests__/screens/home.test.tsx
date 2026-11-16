import { fireEvent, render, screen } from "@testing-library/react-native";

import Home from "@/app/(app)/(tabs)/index";
import type { Budget } from "@/features/budgets/types";
import { PrivacyProvider } from "@/features/privacy/PrivacyProvider";
import type { TransactionRow } from "@/features/transactions/queries";
import { resetRouterMock, router } from "@/test/router-mock";

const mockBalance = jest.fn();
const mockToday = jest.fn();
const mockRecent = jest.fn();
const mockReviewCount = jest.fn();
const mockHealth = jest.fn();
const mockFetchBudgets = jest.fn();

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/api/mobile-api", () => ({ fetchBudgets: () => mockFetchBudgets() }));
jest.mock("@/features/capture/capture", () => ({
  captureSupported: true,
  getCaptureHealth: () => mockHealth(),
}));
jest.mock("@/features/transactions/queries", () => ({
  getCurrentBalance: () => mockBalance(),
  getTodayTotals: () => mockToday(),
  getTransactions: (options: unknown) => mockRecent(options),
  getReviewQueueCount: () => mockReviewCount(),
}));

const txn: TransactionRow = {
  id: "t1",
  transaction_type: "merchant_payment",
  direction: "out",
  status: "success",
  currency: "RWF",
  amount_rwf: 4200,
  fee_rwf: 0,
  balance_after_rwf: null,
  counterparty_name: "Kigali Fresh",
  counterparty_reference: null,
  occurred_at: "2026-11-14T10:00:00Z",
  category: "Food",
  subcategory: null,
  category_decision_status: "confirmed",
  suggested_category: null,
};

const budget: Budget = {
  id: "b1",
  name: "November",
  currency: "RWF",
  periodStart: "2026-11-01",
  periodEnd: "2026-11-30",
  elapsedFraction: 0.5,
  actualIncomeMinor: 0,
  allocations: [
    {
      type: "WANTS",
      label: "Wants",
      targetMinor: 100000,
      actualMinor: 40000,
      remainingMinor: 60000,
      percentConsumed: 40,
      projectedMinor: 80000,
      status: "healthy",
    },
  ],
  alerts: [],
  uncategorizedCount: 0,
  uncategorizedMinor: 0,
  unmappedCount: 0,
  unmappedMinor: 0,
};

function renderHome() {
  return render(
    <PrivacyProvider>
      <Home />
    </PrivacyProvider>,
  );
}

beforeEach(() => {
  resetRouterMock();
  mockBalance.mockResolvedValue({ amountRwf: 250000, asOfIso: "2026-11-14T12:00:00Z" });
  mockToday.mockResolvedValue({ receivedRwf: 5000, spentRwf: 4200 });
  mockRecent.mockResolvedValue([txn]);
  mockReviewCount.mockResolvedValue(0);
  mockHealth.mockResolvedValue({ state: "healthy" });
  mockFetchBudgets.mockResolvedValue({ ok: true, budgets: [] });
});

describe("Home screen", () => {
  it("shows the balance, today's totals and recent transactions", async () => {
    await renderHome();
    expect(await screen.findByText("Current balance")).toBeTruthy();
    expect(screen.getByText("250,000 RWF")).toBeTruthy();
    expect(screen.getByText("MTN Mobile Money")).toBeTruthy();
    expect(screen.getByText("Received today")).toBeTruthy();
    expect(screen.getByText("+5,000 RWF")).toBeTruthy();
    expect(screen.getByText("Spent today")).toBeTruthy();
    // The tile, and the same payment in the list below.
    expect(screen.getAllByText("−4,200 RWF").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("RECENT TRANSACTIONS")).toBeTruthy();
    expect(screen.getByText("Kigali Fresh")).toBeTruthy();
  });

  it("asks for six recent transactions, like the web", async () => {
    await renderHome();
    await screen.findByText("Kigali Fresh");
    expect(mockRecent).toHaveBeenCalledWith({ limit: 6 });
  });

  it("hides every amount with the eye on the balance card", async () => {
    await renderHome();
    await screen.findByText("250,000 RWF");
    await fireEvent.press(screen.getByLabelText("Hide current balance"));
    expect(screen.queryByText("250,000 RWF")).toBeNull();
    expect(screen.queryByText("+5,000 RWF")).toBeNull();
    expect(screen.queryByText("−4,200 RWF")).toBeNull();
    expect(screen.getByLabelText("Show current balance")).toBeTruthy();
  });

  it("shows the budget status card, and opens the budget", async () => {
    mockFetchBudgets.mockResolvedValue({ ok: true, budgets: [budget] });
    await renderHome();

    expect(await screen.findByText("BUDGET STATUS")).toBeTruthy();
    expect(screen.getByText("On track")).toBeTruthy();
    expect(screen.getByText("40,000 RWF of 100,000 RWF used")).toBeTruthy();
    expect(screen.getByText("Remaining")).toBeTruthy();
    expect(screen.getByText("60,000 RWF")).toBeTruthy();

    await fireEvent.press(screen.getByLabelText(/Open budget/));
    expect(router.push).toHaveBeenCalledWith("/budgets");
  });

  it("masks the budget amounts in privacy mode, but not the status", async () => {
    mockFetchBudgets.mockResolvedValue({ ok: true, budgets: [budget] });
    await renderHome();
    await screen.findByText("60,000 RWF");
    await fireEvent.press(screen.getByLabelText("Hide current balance"));
    expect(screen.queryByText(/60,000/)).toBeNull();
    expect(screen.getByText("••••• of ••••• used")).toBeTruthy();
    expect(screen.getByText("On track")).toBeTruthy();
  });

  it("says over, not a negative amount, when the budget is exceeded", async () => {
    mockFetchBudgets.mockResolvedValue({
      ok: true,
      budgets: [
        {
          ...budget,
          allocations: [{ ...budget.allocations[0], actualMinor: 120000, remainingMinor: -20000, status: "exceeded" }],
        },
      ],
    });
    await renderHome();
    expect(await screen.findByText("Over by")).toBeTruthy();
    expect(screen.getByText("20,000 RWF")).toBeTruthy();
    expect(screen.getByText("Over budget")).toBeTruthy();
  });

  it("hides the budget card when budgets are unavailable, without breaking Home", async () => {
    mockFetchBudgets.mockResolvedValue({ ok: false, reason: "unavailable", message: "Your budget isn't available yet." });
    await renderHome();
    expect(await screen.findByText("250,000 RWF")).toBeTruthy();
    expect(screen.queryByText("BUDGET STATUS")).toBeNull();
  });

  it("offers a way to review transactions when some need it", async () => {
    mockReviewCount.mockResolvedValue(3);
    await renderHome();
    expect(await screen.findByText("3 transactions to review")).toBeTruthy();
    await fireEvent.press(screen.getByText("Review now"));
    expect(router.push).toHaveBeenCalledWith("/inbox");
  });

  it("prompts to set up automatic recording when it is not working", async () => {
    mockHealth.mockResolvedValue({ state: "permission_required" });
    await renderHome();
    expect(await screen.findByText("Automatic recording is off")).toBeTruthy();
    await fireEvent.press(screen.getByText("Set it up"));
    expect(router.push).toHaveBeenCalledWith("/connect");
  });

  it("shows a retry when Home cannot load", async () => {
    mockBalance.mockRejectedValue(new Error("network"));
    await renderHome();
    expect(await screen.findByText("Try again")).toBeTruthy();
  });
});
