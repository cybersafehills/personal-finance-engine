import { act, fireEvent, render, screen } from "@testing-library/react-native";

import Transactions from "@/app/(app)/(tabs)/transactions";
import type { TransactionRow } from "@/features/transactions/queries";
import { resetRouterMock, router, setParams } from "@/test/router-mock";

const mockGetTransactions = jest.fn();
const mockLifetime = jest.fn();
const mockReviewCount = jest.fn();
const mockSpace = { activeId: "w1" };
jest.mock("@/features/spaces/ActiveSpaceProvider", () => ({ useActiveSpace: () => mockSpace }));

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/features/transactions/queries", () => {
  const actual = jest.requireActual("@/features/transactions/queries");
  return {
    ...actual,
    getTransactions: (args: unknown) => mockGetTransactions(args),
    getLifetimeFlowTotals: (space: string) => mockLifetime(space),
    getReviewQueueCount: (space: string) => mockReviewCount(space),
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
  mockSpace.activeId = "w1";
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

    await fireEvent.press(screen.getByRole("button", { name: "Add transaction" }));
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

  it("keeps search and the filters in one compact block above the list", async () => {
    mockGetTransactions.mockResolvedValue([]);
    await render(<Transactions />);
    expect(await screen.findByLabelText("Search")).toBeTruthy();
    // Direction, period and review are chips on a single row.
    for (const label of ["All", "In", "Out", "All time", "7 days", "30 days", "This month", "To review"]) {
      expect(screen.getAllByRole("button", { name: new RegExp(`^${label}(, selected)?$`) }).length).toBeGreaterThan(0);
    }
  });
});


describe("live ledger accuracy", () => {
  it("scopes list and totals to the selected Space and clears old rows immediately", async () => {
    mockGetTransactions.mockResolvedValue([row("old", "Previous Space merchant")]);
    const view = await render(<Transactions />);
    await screen.findByText("Previous Space merchant");
    expect(mockGetTransactions).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceId: "w1" }));
    expect(mockLifetime).toHaveBeenCalledWith("w1");
    let resolveNew: (rows: TransactionRow[]) => void = () => {};
    mockGetTransactions.mockImplementation(() => new Promise(resolve => { resolveNew = resolve; }));
    mockSpace.activeId = "w2";
    await view.rerender(<Transactions />);
    expect(screen.queryByText("Previous Space merchant")).toBeNull();
    expect(mockGetTransactions).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceId: "w2" }));
    await act(async () => { resolveNew([row("new", "Current Space merchant")]); });
    expect(await screen.findByText("Current Space merchant")).toBeTruthy();
  });
  it("clears a previous search and category when Home opens View all", async () => {
    setParams({ category: "Food", period: "month" });
    mockGetTransactions.mockResolvedValue([row("1", "Merchant")]);
    const view = await render(<Transactions />);
    await screen.findByText("Merchant");
    await fireEvent.changeText(screen.getByLabelText("Search"), "old search");
    await act(async () => { jest.advanceTimersByTime(400); });
    setParams({ category: "", period: "all", reset: "new" });
    await view.rerender(<Transactions />);
    expect(screen.queryByText("Category: Food")).toBeNull();
    expect(mockGetTransactions).toHaveBeenLastCalledWith(expect.objectContaining({ q: "", category: undefined, filters: expect.objectContaining({period:"all"}) }));
  });
  it("distinguishes pending, failed and reversed attempts and preserves currency and fees", async () => {
    mockGetTransactions.mockResolvedValue([
      {...row("1", "Pending merchant"), status: "pending", settlement_state: "pending"},
      {...row("2", "Failed merchant"), status: "failed", settlement_state: "failed"},
      {...row("3", "Reversed merchant"), status: "success", settlement_state: "reversed"},
      {...row("4", "Dollar merchant"), currency: "USD", amount_rwf: 12345, fee_rwf: 100},
    ]);
    await render(<Transactions />);
    expect(await screen.findByText("Pending")).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.getByText("Reversed")).toBeTruthy();
    expect(screen.getAllByText("RWF 1,000")).toHaveLength(3);
    expect(screen.getByText("−$123.45")).toBeTruthy();
    expect(screen.getByText("Fee $1.00")).toBeTruthy();
  });
});


it("keeps the selected wallet filter when opened from wallet detail", async () => {
 setParams({accountId:"wallet-1",walletName:"My wallet",period:"all",reset:"wallet"});
 mockGetTransactions.mockResolvedValue([row("t1","Wallet merchant")]);
 await render(<Transactions />);await screen.findByText("Wallet merchant");
 expect(mockGetTransactions).toHaveBeenCalledWith(expect.objectContaining({workspaceId:"w1",accountId:"wallet-1"}));
 expect(screen.getByText("My wallet")).toBeTruthy();
 expect(screen.queryByLabelText(/through OneLedger/)).toBeNull();
 await fireEvent.press(screen.getByText("All wallets"));
 expect(router.setParams).toHaveBeenCalledWith({accountId:undefined,walletName:undefined});
});
