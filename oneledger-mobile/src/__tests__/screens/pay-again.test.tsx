import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import PayAgain from "@/app/(app)/pay-again";
import { resetRouterMock, router, setParams } from "@/test/router-mock";

const mockCreate = jest.fn();
const mockGetTransaction = jest.fn();
const mockOffer = jest.fn();

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/api/mobile-api", () => ({ createPayIntent: (body: unknown) => mockCreate(body) }));
jest.mock("@/features/transactions/queries", () => ({ getTransactionById: (id: string) => mockGetTransaction(id) }));
jest.mock("@/features/pay/context", () => ({ loadPayAgainOffer: (t: unknown) => mockOffer(t) }));

const personOffer = {
  target: { type: "pay_person", msisdn: "250788123456", name: "Jean" },
  account: { id: "acct-1", name: "MTN MoMo" },
};
const merchantOffer = {
  target: { type: "pay_merchant", merchantCode: "123456", name: null },
  account: { id: "acct-1", name: "MTN MoMo" },
};
const created = { ok: true, intent: { id: "intent-9" }, existed: false };

beforeEach(() => {
  resetRouterMock();
  setParams({ txn: "t1" });
  mockCreate.mockReset();
  mockGetTransaction.mockReset().mockResolvedValue({ id: "t1" });
  mockOffer.mockReset().mockResolvedValue(personOffer);
});

describe("Pay again screen", () => {
  it("shows who you're paying and never prefills the amount", async () => {
    await render(<PayAgain />);
    expect(await screen.findByText("Jean")).toBeTruthy();
    // The whole number, so it can be checked before paying (not masked).
    expect(screen.getByText("078 812 3456")).toBeTruthy();
    expect(screen.getByText("Pay from MTN MoMo")).toBeTruthy();
    expect(screen.getByLabelText("Amount (RWF)").props.value).toBe("");
  });

  it("refuses an empty, zero or non-whole amount without asking the server", async () => {
    await render(<PayAgain />);
    await screen.findByLabelText("Amount (RWF)");
    for (const text of ["", "0", "12.5", "abc", "1234567890"]) {
      await fireEvent.changeText(screen.getByLabelText("Amount (RWF)"), text);
      await fireEvent.press(screen.getByText("Prepare payment"));
      expect(await screen.findByText("Enter an amount greater than zero, in whole RWF.")).toBeTruthy();
    }
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("prepares a draft and opens the review, sending a request id", async () => {
    mockCreate.mockResolvedValue(created);
    await render(<PayAgain />);

    await fireEvent.changeText(await screen.findByLabelText("Amount (RWF)"), "5,000");
    await fireEvent.press(screen.getByText("Prepare payment"));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith({
      paymentType: "pay_person",
      amountMinor: 5000,
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
      recipientName: "Jean",
      recipientMsisdn: "250788123456",
      merchantCode: undefined,
      sourceAccountId: "acct-1",
    });
    expect(router.replace).toHaveBeenCalledWith({ pathname: "/pay/[id]", params: { id: "intent-9" } });
  });

  it("treats a double tap as one request", async () => {
    let finish: (v: unknown) => void = () => {};
    mockCreate.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await render(<PayAgain />);
    await fireEvent.changeText(await screen.findByLabelText("Amount (RWF)"), "5000");

    // Three taps while the first request is still in flight (not awaited one by
    // one: awaiting would wait on the pending request itself).
    const button = screen.getByText("Prepare payment");
    await act(async () => {
      fireEvent.press(button);
      fireEvent.press(button);
      fireEvent.press(button);
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);

    await act(async () => finish(created));
    expect(router.replace).toHaveBeenCalledTimes(1);
  });

  it("reuses the request id on a retry, but a new one once the amount changes", async () => {
    mockCreate.mockResolvedValue({ ok: false, reason: "error", message: "Could not prepare the payment." });
    await render(<PayAgain />);

    await fireEvent.changeText(await screen.findByLabelText("Amount (RWF)"), "5000");
    await fireEvent.press(screen.getByText("Prepare payment"));
    await screen.findByText("Could not prepare the payment.");
    await fireEvent.press(screen.getByText("Prepare payment"));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
    const [first, retry] = mockCreate.mock.calls.map((c) => c[0].idempotencyKey);
    expect(retry).toBe(first); // a retry of the same ask returns the same draft

    await fireEvent.changeText(await screen.findByLabelText("Amount (RWF)"), "6000");
    await fireEvent.press(screen.getByText("Prepare payment"));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(3));
    expect(mockCreate.mock.calls[2][0].idempotencyKey).not.toBe(first); // an edited amount must not get the old draft back
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("shows the server's message when it refuses, and stays on the form", async () => {
    mockCreate.mockResolvedValue({ ok: false, reason: "error", message: "Assisted Quick Pay is turned off for your account." });
    await render(<PayAgain />);
    await fireEvent.changeText(await screen.findByLabelText("Amount (RWF)"), "5000");
    await fireEvent.press(screen.getByText("Prepare payment"));
    expect(await screen.findByText("Assisted Quick Pay is turned off for your account.")).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("prepares a merchant payment with the merchant code and the paying account", async () => {
    mockOffer.mockResolvedValue(merchantOffer);
    mockCreate.mockResolvedValue(created);
    await render(<PayAgain />);
    expect(await screen.findByText("Merchant code 123456")).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText("Amount (RWF)"), "2500");
    await fireEvent.press(screen.getByText("Prepare payment"));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      paymentType: "pay_merchant",
      merchantCode: "123456",
      recipientMsisdn: undefined,
      sourceAccountId: "acct-1",
    });
  });

  it("ignores a recipient, name or account smuggled in through the route (deep links)", async () => {
    // Only `txn` is read. These are what a crafted oneledger:// link could carry.
    setParams({
      txn: "t1",
      type: "pay_person",
      recipient: "250799000111",
      name: "Attacker",
      accountId: "evil-account",
      accountName: "Evil",
    });
    mockCreate.mockResolvedValue(created);
    await render(<PayAgain />);

    expect(await screen.findByText("Jean")).toBeTruthy();
    expect(screen.queryByText("Attacker")).toBeNull();
    expect(screen.queryByText("079 900 0111")).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("Amount (RWF)"), "5000");
    await fireEvent.press(screen.getByText("Prepare payment"));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      recipientMsisdn: "250788123456",
      recipientName: "Jean",
      sourceAccountId: "acct-1",
    });
  });

  it("re-checks the transaction every time: a link with no id, an unknown id or no offer opens nothing", async () => {
    setParams({ type: "pay_person", recipient: "250799000111" });
    await render(<PayAgain />);
    expect(await screen.findByText("We can't prepare this payment")).toBeTruthy();
    expect(screen.queryByText("Prepare payment")).toBeNull();
    expect(mockGetTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["a transaction that can't be found", () => mockGetTransaction.mockResolvedValue(null)],
    ["no offer (config off, shared Space, unsupported...)", () => mockOffer.mockResolvedValue(null)],
    ["an offer that errors", () => mockOffer.mockRejectedValue(new Error("boom"))],
  ])("won't open for %s", async (_label, arrange) => {
    arrange();
    await render(<PayAgain />);
    expect(await screen.findByText("We can't prepare this payment")).toBeTruthy();
    expect(screen.queryByText("Prepare payment")).toBeNull();
  });
});
