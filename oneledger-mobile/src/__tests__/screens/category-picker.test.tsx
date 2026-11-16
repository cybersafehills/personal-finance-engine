import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import CategoryPicker from "@/app/(app)/category/[id]";
import { ReviewActionError } from "@/features/review/actions";
import type { TransactionRow } from "@/features/transactions/queries";
import { resetRouterMock, router, setParams } from "@/test/router-mock";

const mockGetTransaction = jest.fn();
const mockGetOptions = jest.fn();
const mockCorrect = jest.fn();

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/features/transactions/queries", () => ({
  getTransactionById: (id: string) => mockGetTransaction(id),
}));
jest.mock("@/features/categories/queries", () => ({ getCategoryOptions: () => mockGetOptions() }));
jest.mock("@/features/review/actions", () => {
  const actual = jest.requireActual("@/features/review/actions");
  return {
    ...actual,
    correctCategory: (...args: unknown[]) => mockCorrect(...args),
  };
});

const txn = (over: Partial<TransactionRow> = {}): TransactionRow => ({
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
  category: null,
  subcategory: null,
  category_decision_status: "suggested",
  suggested_category: "Food",
  ...over,
});

beforeEach(() => {
  resetRouterMock();
  setParams({ id: "t1" });
  [mockGetTransaction, mockGetOptions, mockCorrect].forEach((m) => m.mockReset());
  mockGetOptions.mockResolvedValue(["Food", "Transport", "Rent"]);
});

describe("Category picker screen", () => {
  it("lists categories, narrows them as you type, and saves the choice with a merchant rule", async () => {
    mockGetTransaction.mockResolvedValue(txn());
    mockCorrect.mockResolvedValue({ ruleSaved: true });
    await render(<CategoryPicker />);

    expect(await screen.findByText("Food")).toBeTruthy();
    expect(screen.getByText("Transport")).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText("Search or type a new category"), "tran");
    expect(screen.queryByText("Food")).toBeNull();
    expect(screen.getByText("Transport")).toBeTruthy();

    await fireEvent.press(screen.getByText("Transport"));
    await fireEvent.press(screen.getByText("Save as Transport"));

    await waitFor(() => expect(mockCorrect).toHaveBeenCalledWith("t1", "Transport", null, true));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it("offers to create a new category and saves it", async () => {
    mockGetTransaction.mockResolvedValue(txn());
    mockCorrect.mockResolvedValue({ ruleSaved: true });
    await render(<CategoryPicker />);

    await fireEvent.changeText(await screen.findByLabelText("Search or type a new category"), "  School  fees ");
    await fireEvent.press(await screen.findByText("Create “School fees”"));
    await fireEvent.press(screen.getByText("Save as School fees"));

    await waitFor(() => expect(mockCorrect).toHaveBeenCalledWith("t1", "School fees", null, true));
  });

  it("keeps the subcategory when the same category is chosen again", async () => {
    mockGetTransaction.mockResolvedValue(txn({ category: "Food", subcategory: "Lunch", category_decision_status: "confirmed" }));
    mockCorrect.mockResolvedValue({ ruleSaved: true });
    await render(<CategoryPicker />);

    await fireEvent.press(await screen.findByText("Food"));
    await fireEvent.press(screen.getByText("Save as Food"));

    await waitFor(() => expect(mockCorrect).toHaveBeenCalledWith("t1", "Food", "Lunch", true));
  });

  it("does not remember a rule when the switch is turned off", async () => {
    mockGetTransaction.mockResolvedValue(txn());
    mockCorrect.mockResolvedValue({ ruleSaved: null });
    await render(<CategoryPicker />);

    await fireEvent.press(await screen.findByText("Rent"));
    await fireEvent(screen.getByLabelText("Remember this category for Kigali Fresh"), "valueChange", false);
    await fireEvent.press(screen.getByText("Save as Rent"));

    await waitFor(() => expect(mockCorrect).toHaveBeenCalledWith("t1", "Rent", null, false));
  });

  it("hides the merchant rule when there is no counterparty", async () => {
    mockGetTransaction.mockResolvedValue(txn({ counterparty_name: null }));
    await render(<CategoryPicker />);
    await screen.findByText("Food");
    expect(screen.queryByText(/Remember for/)).toBeNull();
  });

  it("says the category is saved when only the rule could not be", async () => {
    mockGetTransaction.mockResolvedValue(txn());
    mockCorrect.mockResolvedValue({ ruleSaved: false });
    await render(<CategoryPicker />);

    await fireEvent.press(await screen.findByText("Food"));
    await fireEvent.press(screen.getByText("Save as Food"));

    expect(await screen.findByText("Category set to Food")).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
  });

  it("keeps the picker and shows the reason when saving fails", async () => {
    mockGetTransaction.mockResolvedValue(txn());
    mockCorrect.mockRejectedValue(new ReviewActionError("You can't change this transaction."));
    await render(<CategoryPicker />);

    await fireEvent.press(await screen.findByText("Food"));
    await fireEvent.press(screen.getByText("Save as Food"));

    expect(await screen.findByText("You can't change this transaction.")).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
  });

  it("will not save until something is chosen", async () => {
    mockGetTransaction.mockResolvedValue(txn());
    await render(<CategoryPicker />);
    await screen.findByText("Food");
    const save = screen.getByRole("button", { name: "Choose a category" });
    expect(save).toBeDisabled();
    await fireEvent.press(save);
    expect(mockCorrect).not.toHaveBeenCalled();
  });

  it("shows an unavailable state for a transaction that is gone", async () => {
    mockGetTransaction.mockResolvedValue(null);
    await render(<CategoryPicker />);
    expect(await screen.findByText("This transaction isn't available")).toBeTruthy();
  });
});
