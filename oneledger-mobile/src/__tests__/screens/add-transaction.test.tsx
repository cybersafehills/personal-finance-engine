import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import AddTransaction from "@/app/(app)/add-transaction";
import { ManualEntryError } from "@/features/manual/actions";
import { resetRouterMock, router } from "@/test/router-mock";

const mockListAccounts = jest.fn();
const mockCreate = jest.fn();

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/features/manual/actions", () => {
  const actual = jest.requireActual("@/features/manual/actions");
  return {
    ...actual,
    listManualAccounts: () => mockListAccounts(),
    createManualTransaction: (args: unknown) => mockCreate(args),
  };
});

const momo = { id: "acct-1", name: "MTN MoMo", workspaceId: "w1", currency: "RWF" };
const euro = { id: "acct-2", name: "Euro savings", workspaceId: "w1", currency: "EUR" };

beforeEach(() => {
  resetRouterMock();
  mockListAccounts.mockReset();
  mockCreate.mockReset();
});

describe("Add transaction screen", () => {
  it("saves a money-out entry and opens its detail", async () => {
    mockListAccounts.mockResolvedValue([momo]);
    mockCreate.mockResolvedValue("new-txn-id");
    await render(<AddTransaction />);

    await fireEvent.changeText(await screen.findByLabelText("Amount (RWF)"), "4200");
    await fireEvent.changeText(screen.getByLabelText("Fee (optional)"), "100");
    await fireEvent.changeText(screen.getByLabelText("Who or what (optional)"), "Kigali Fresh");
    await fireEvent.press(screen.getByText("Add transaction"));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith({
      p_account_id: "acct-1",
      p_transaction_type: "merchant_payment",
      p_direction: "out",
      p_amount_minor: 4200,
      p_fee_minor: 100,
      p_occurred_at: expect.any(String),
      p_counterparty_name: "Kigali Fresh",
      p_notes: null,
    });
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith({
        pathname: "/transaction/[id]",
        params: { id: "new-txn-id" },
      }),
    );
  });

  it("explains a missing amount and does not call the server", async () => {
    mockListAccounts.mockResolvedValue([momo]);
    await render(<AddTransaction />);

    await fireEvent.press(await screen.findByText("Add transaction"));

    expect(await screen.findByText("Enter a valid amount.")).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("switches to money in for a received type, with no fee field", async () => {
    mockListAccounts.mockResolvedValue([momo]);
    mockCreate.mockResolvedValue("in-id");
    await render(<AddTransaction />);

    expect(await screen.findByLabelText("Fee (optional)")).toBeTruthy();
    await fireEvent.press(screen.getByText("Received money"));
    expect(screen.queryByLabelText("Fee (optional)")).toBeNull();

    await fireEvent.changeText(screen.getByLabelText("Amount (RWF)"), "5000");
    await fireEvent.press(screen.getByText("Add transaction"));

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      p_transaction_type: "money_received",
      p_direction: "in",
      p_amount_minor: 5000,
      p_fee_minor: 0,
    });
  });

  it("lets the person choose an account and uses its currency", async () => {
    mockListAccounts.mockResolvedValue([momo, euro]);
    mockCreate.mockResolvedValue("eur-id");
    await render(<AddTransaction />);

    await fireEvent.press(await screen.findByText("Euro savings (EUR)"));
    await fireEvent.changeText(screen.getByLabelText("Amount (EUR)"), "12.50");
    await fireEvent.press(screen.getByText("Add transaction"));

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ p_account_id: "acct-2", p_amount_minor: 1250 });
  });

  it("keeps the form and shows the reason when saving fails", async () => {
    mockListAccounts.mockResolvedValue([momo]);
    mockCreate.mockRejectedValue(new ManualEntryError("You can't add transactions to this account."));
    await render(<AddTransaction />);

    await fireEvent.changeText(await screen.findByLabelText("Amount (RWF)"), "100");
    await fireEvent.press(screen.getByText("Add transaction"));

    expect(await screen.findByText("You can't add transactions to this account.")).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
    // Still editable, and the button works again.
    expect(screen.getByLabelText("Amount (RWF)")).toBeTruthy();
    expect(screen.getByText("Add transaction")).toBeTruthy();
  });

  it("asks for a date when picking a custom time, and rejects a bad one", async () => {
    mockListAccounts.mockResolvedValue([momo]);
    await render(<AddTransaction />);

    await fireEvent.changeText(await screen.findByLabelText("Amount (RWF)"), "100");
    await fireEvent.press(screen.getByText("Pick a date"));
    await fireEvent.changeText(screen.getByLabelText("Date (YYYY-MM-DD)"), "2026-02-30");
    await fireEvent.press(screen.getByText("Add transaction"));

    expect(await screen.findByText("That date doesn't exist.")).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("tells the person to add an account first when there are none", async () => {
    mockListAccounts.mockResolvedValue([]);
    await render(<AddTransaction />);
    expect(await screen.findByText("Add an account first")).toBeTruthy();
  });

  it("offers a retry when the accounts cannot be loaded", async () => {
    mockListAccounts.mockRejectedValue(new Error("network"));
    await render(<AddTransaction />);
    expect(await screen.findByText("Try again")).toBeTruthy();
  });
});
