import { act, fireEvent, render, screen } from "@testing-library/react-native";

import Transactions from "@/app/(app)/(tabs)/transactions";
import type { TransactionRow } from "@/features/transactions/queries";
import { resetRouterMock, router } from "@/test/router-mock";

const mockGetTransactions = jest.fn();
const mockLifetime = jest.fn();
const mockReviewCount = jest.fn();

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/features/transactions/queries", () => {
  const actual = jest.requireActual("@/features/transactions/queries");
  return {
    ...actual,
    getTransactions: (args: unknown) => mockGetTransactions(args),
    getLifetimeFlowTotals: () => mockLifetime(),
    getReviewQueueCount: () => mockReviewCount(),
  };
});

const row = (id: string, name: string): TransactionRow => ({
  id,
  transaction_type: "merchant_payment",
  direction: "out",
  status: "success",
  currency: "RWF",
  amount_rwf: 1000,
  fee_rwf: 0,
  balance_after_rwf: null,
  counterparty_name: name,
  counterparty_reference: null,
  occurred_at: new Date().toISOString(),
  category: "Food",
  subcategory: null,
  category_decision_status: "confirmed",
  suggested_category: null,
});

beforeEach(() => {
  jest.useFakeTimers();
  resetRouterMock();
  mockGetTransactions.mockReset();
  mockLifetime.mockResolvedValue({
    sentRwf: 3830678,
    receivedRwf: 28950556,
    count: 40,
    accountCreatedIso: "2026-09-04T08:00:00Z",
  });
  mockReviewCount.mockResolvedValue(0);
});
afterEach(() => jest.useRealTimers());

describe("Transactions screen", () => {
  it("lists transactions and opens the add form", async () => {
    mockGetTransactions.mockResolvedValue([row("1", "Kigali Fresh"), row("2", "Simba Market")]);
    await render(<Transactions />);

    expect(await screen.findByText("Kigali Fresh")).toBeTruthy();
    expect(screen.getByText("Simba Market")).toBeTruthy();

    await fireEvent.press(screen.getByText("Add transaction"));
    expect(router.push).toHaveBeenCalledWith("/add-transaction");
  });

  it("shows the lifetime chips and explains them on tap", async () => {
    mockGetTransactions.mockResolvedValue([row("1", "Kigali Fresh")]);
    await render(<Transactions />);

    expect(await screen.findByText("3,830,678 RWF")).toBeTruthy();
    expect(screen.getByText("28,950,556 RWF")).toBeTruthy();

    await fireEvent.press(screen.getByLabelText(/Total sent through OneLedger/));
    expect(
      screen.getByText(
        "Total money sent through OneLedger since your account was created on 04/09/2026.",
      ),
    ).toBeTruthy();
  });

  it("hides the chips when there is no history yet", async () => {
    mockLifetime.mockResolvedValue({ sentRwf: 0, receivedRwf: 0, count: 0, accountCreatedIso: null });
    mockGetTransactions.mockResolvedValue([]);
    await render(<Transactions />);
    await screen.findByText("No transactions yet");
    expect(screen.queryByLabelText(/through OneLedger/)).toBeNull();
  });

  it("links to the review queue with its count", async () => {
    mockReviewCount.mockResolvedValue(3);
    mockGetTransactions.mockResolvedValue([row("1", "Kigali Fresh")]);
    await render(<Transactions />);

    await fireEvent.press(await screen.findByText("Review queue (3)"));
    expect(router.push).toHaveBeenCalledWith("/inbox");
  });

  it("still lists transactions when the totals cannot load", async () => {
    mockLifetime.mockRejectedValue(new Error("network"));
    mockGetTransactions.mockResolvedValue([row("1", "Kigali Fresh")]);
    await render(<Transactions />);
    expect(await screen.findByText("Kigali Fresh")).toBeTruthy();
    expect(screen.queryByLabelText(/through OneLedger/)).toBeNull();
  });

  it("searches after a short pause, not on every keystroke", async () => {
    mockGetTransactions.mockResolvedValue([row("1", "Kigali Fresh")]);
    await render(<Transactions />);
    await screen.findByText("Kigali Fresh");
    mockGetTransactions.mockClear();

    await fireEvent.changeText(screen.getByLabelText("Search"), "sim");
    await fireEvent.changeText(screen.getByLabelText("Search"), "simba");
    expect(mockGetTransactions).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    await screen.findByText("Kigali Fresh");
    expect(mockGetTransactions).toHaveBeenCalledTimes(1);
    // Filters are part of the query too (#192); this test is about the search.
    expect(mockGetTransactions).toHaveBeenCalledWith(expect.objectContaining({ q: "simba" }));
  });

  it("shows an empty state, and a different one when a search finds nothing", async () => {
    mockGetTransactions.mockResolvedValue([]);
    await render(<Transactions />);
    expect(await screen.findByText("No transactions yet")).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText("Search"), "zzz");
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    expect(await screen.findByText("Nothing matches that search")).toBeTruthy();
  });

  it("shows a retry when loading fails", async () => {
    mockGetTransactions.mockRejectedValue(new Error("network"));
    await render(<Transactions />);
    expect(await screen.findByText("Try again")).toBeTruthy();
  });
});
