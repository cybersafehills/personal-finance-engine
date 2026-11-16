import { fireEvent, render, screen } from "@testing-library/react-native";

import TransactionDetail from "@/app/(app)/transaction/[id]";
import type { TransactionRow } from "@/features/transactions/queries";
import { resetRouterMock, router, setParams } from "@/test/router-mock";

const mockGetTransaction = jest.fn();
const mockOpenUrl = jest.fn();
const mockOffer = jest.fn();

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/features/transactions/queries", () => ({
  getTransactionById: (id: string) => mockGetTransaction(id),
}));
jest.mock("@/lib/config", () => ({ config: { apiBaseUrl: "https://app.example.test" } }));
jest.mock("@/features/pay/context", () => ({ loadPayAgainOffer: (t: unknown) => mockOffer(t) }));
jest.mock("expo-linking", () => ({ openURL: (url: string) => mockOpenUrl(url) }));

const txn = (over: Partial<TransactionRow> = {}): TransactionRow => ({
  id: "t1",
  transaction_type: "merchant_payment",
  direction: "out",
  status: "success",
  currency: "RWF",
  amount_rwf: 4200,
  fee_rwf: 100,
  balance_after_rwf: 90000,
  counterparty_name: "Kigali Fresh",
  counterparty_reference: "REF-7",
  occurred_at: "2026-11-14T10:00:00Z",
  category: "Food",
  subcategory: null,
  category_decision_status: "confirmed",
  suggested_category: null,
  ...over,
});

beforeEach(() => {
  resetRouterMock();
  setParams({ id: "t1" });
  mockGetTransaction.mockReset();
  mockOpenUrl.mockReset();
  mockOffer.mockReset();
  mockOffer.mockResolvedValue(null); // no "Pay again" unless a test says so
});

describe("Transaction detail screen", () => {
  it("shows the transaction's details, never masked", async () => {
    mockGetTransaction.mockResolvedValue(txn());
    await render(<TransactionDetail />);

    expect(await screen.findByText("Kigali Fresh")).toBeTruthy();
    expect(screen.getByText("−4,200 RWF")).toBeTruthy();
    expect(screen.getByText("Food")).toBeTruthy();
    expect(screen.getByText("REF-7")).toBeTruthy();
    expect(screen.getByText("90,000 RWF")).toBeTruthy();
  });

  it("opens the category picker to change the category", async () => {
    mockGetTransaction.mockResolvedValue(txn());
    await render(<TransactionDetail />);

    await fireEvent.press(await screen.findByText("Change category"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/category/[id]", params: { id: "t1" } });
  });

  it("invites a first category for an uncategorised transaction", async () => {
    mockGetTransaction.mockResolvedValue(txn({ category: null }));
    await render(<TransactionDetail />);
    expect(await screen.findByText("Choose a category")).toBeTruthy();
    expect(screen.getByText("Uncategorized")).toBeTruthy();
  });

  it("shows a failed transaction as moving no money and offers no recategorising", async () => {
    mockGetTransaction.mockResolvedValue(txn({ status: "failed" }));
    await render(<TransactionDetail />);

    expect(await screen.findByText("Failed: no money moved")).toBeTruthy();
    expect(screen.queryByText("Change category")).toBeNull();
  });

  it("shows the pending suggestion for a transaction that needs review", async () => {
    mockGetTransaction.mockResolvedValue(
      txn({ category: null, category_decision_status: "suggested", suggested_category: "Transport" }),
    );
    await render(<TransactionDetail />);

    expect(await screen.findByText("Needs review")).toBeTruthy();
    expect(screen.getByText("Transport")).toBeTruthy();
  });

  it("opens the web page for deeper edits", async () => {
    mockGetTransaction.mockResolvedValue(txn());
    await render(<TransactionDetail />);
    await fireEvent.press(await screen.findByText("Edit on the web"));
    expect(mockOpenUrl).toHaveBeenCalledWith("https://app.example.test/transactions/t1");
  });

  it("explains a transaction that is gone", async () => {
    mockGetTransaction.mockResolvedValue(null);
    await render(<TransactionDetail />);
    expect(await screen.findByText("This transaction isn't available")).toBeTruthy();
  });

  it("goes back", async () => {
    mockGetTransaction.mockResolvedValue(txn());
    await render(<TransactionDetail />);
    await fireEvent.press(await screen.findByText("Back"));
    expect(router.back).toHaveBeenCalled();
  });

  describe("Pay again", () => {
    const person = { type: "pay_person", msisdn: "250788123456", name: "Jean" } as const;

    it("offers it only when the offer says it can work, and passes only the transaction id", async () => {
      mockGetTransaction.mockResolvedValue(txn({ transaction_type: "send_money", counterparty_reference: "0788123456", counterparty_name: "Jean" }));
      mockOffer.mockResolvedValue({ target: person, account: { id: "acct-1", name: "MTN MoMo" } });
      await render(<TransactionDetail />);

      await fireEvent.press(await screen.findByText("Pay Jean again"));
      // Only the transaction id travels: the form rebuilds the recipient from it.
      expect(router.push).toHaveBeenCalledWith({ pathname: "/pay-again", params: { txn: "t1" } });
    });

    it("opens the same form for a business payment", async () => {
      mockGetTransaction.mockResolvedValue(txn());
      mockOffer.mockResolvedValue({
        target: { type: "pay_merchant", merchantCode: "123456", name: null },
        account: { id: "acct-1", name: "MTN MoMo" },
      });
      await render(<TransactionDetail />);

      await fireEvent.press(await screen.findByText("Pay this recipient again"));
      expect(router.push).toHaveBeenCalledWith({ pathname: "/pay-again", params: { txn: "t1" } });
    });

    it("is absent when there is no offer (config off, shared Space, unsupported type...)", async () => {
      mockGetTransaction.mockResolvedValue(txn());
      mockOffer.mockResolvedValue(null);
      await render(<TransactionDetail />);

      await screen.findByText("Change category");
      expect(screen.queryByText(/again$/)).toBeNull();
    });
  });
});
