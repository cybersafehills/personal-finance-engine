import { act, fireEvent, render, screen } from "@testing-library/react-native";

import Transactions from "@/app/(app)/(tabs)/transactions";
import type { TransactionRow } from "@/features/transactions/queries";
import { resetRouterMock, router, setParams } from "@/test/router-mock";

const mockGetTransactions = jest.fn();

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/features/transactions/queries", () => {
  const actual = jest.requireActual("@/features/transactions/queries");
  return { ...actual, getTransactions: (args: unknown) => mockGetTransactions(args) };
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
});
afterEach(() => jest.useRealTimers());

describe("Transactions screen", () => {
  it("lists transactions and opens the add form", async () => {
    mockGetTransactions.mockResolvedValue([row("1", "Kigali Fresh"), row("2", "Simba Market")]);
    await render(<Transactions />);

    expect(await screen.findByText("Kigali Fresh")).toBeTruthy();
    expect(screen.getByText("Simba Market")).toBeTruthy();

    await fireEvent.press(screen.getByText("Add"));
    expect(router.push).toHaveBeenCalledWith("/add-transaction");
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

  describe("opened from Categories", () => {
    it("shows only that category and says so", async () => {
      setParams({ category: "Food" });
      mockGetTransactions.mockResolvedValue([row("1", "Kigali Fresh")]);
      await render(<Transactions />);

      expect(await screen.findByText("Category: Food")).toBeTruthy();
      expect(mockGetTransactions).toHaveBeenCalledWith(expect.objectContaining({ category: "Food" }));
    });

    it("clears the category", async () => {
      setParams({ category: "Food" });
      mockGetTransactions.mockResolvedValue([row("1", "Kigali Fresh")]);
      await render(<Transactions />);

      await fireEvent.press(await screen.findByText("Clear"));
      expect(router.setParams).toHaveBeenCalledWith({ category: undefined });
      expect(router.replace).not.toHaveBeenCalled();
    });

    it("has no category chip when opened normally", async () => {
      mockGetTransactions.mockResolvedValue([row("1", "Kigali Fresh")]);
      await render(<Transactions />);
      await screen.findByText("Kigali Fresh");
      expect(screen.queryByText(/^Category:/)).toBeNull();
    });

    it("explains an empty category rather than showing the empty ledger message", async () => {
      setParams({ category: "Food" });
      mockGetTransactions.mockResolvedValue([]);
      await render(<Transactions />);
      expect(await screen.findByText("Nothing matches that search")).toBeTruthy();
    });
  });
});
