import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import PayAgain from "@/app/(app)/pay-again";
import { resetRouterMock, router, setParams } from "@/test/router-mock";

const mockCreate = jest.fn();

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/api/mobile-api", () => ({ createPayIntent: (body: unknown) => mockCreate(body) }));

const person = {
  type: "pay_person",
  recipient: "250788123456",
  name: "Jean",
  accountId: "acct-1",
  accountName: "MTN MoMo",
};
const created = { ok: true, intent: { id: "intent-9" }, existed: false };

beforeEach(() => {
  resetRouterMock();
  setParams(person);
  mockCreate.mockReset();
});

describe("Pay again screen", () => {
  it("shows who you're paying and never prefills the amount", async () => {
    await render(<PayAgain />);
    expect(screen.getByText("Jean")).toBeTruthy();
    expect(screen.getByText("•••• ••• 3456")).toBeTruthy();
    expect(screen.getByText("Pay from MTN MoMo")).toBeTruthy();
    expect(screen.getByLabelText("Amount (RWF)").props.value).toBe("");
  });

  it("refuses an empty, zero or non-whole amount without asking the server", async () => {
    await render(<PayAgain />);
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

    await fireEvent.changeText(screen.getByLabelText("Amount (RWF)"), "5,000");
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
    await fireEvent.changeText(screen.getByLabelText("Amount (RWF)"), "5000");

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

    await fireEvent.changeText(screen.getByLabelText("Amount (RWF)"), "5000");
    await fireEvent.press(screen.getByText("Prepare payment"));
    await screen.findByText("Could not prepare the payment.");
    await fireEvent.press(screen.getByText("Prepare payment"));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
    const [first, retry] = mockCreate.mock.calls.map((c) => c[0].idempotencyKey);
    expect(retry).toBe(first); // a retry of the same ask returns the same draft

    await fireEvent.changeText(screen.getByLabelText("Amount (RWF)"), "6000");
    await fireEvent.press(screen.getByText("Prepare payment"));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(3));
    expect(mockCreate.mock.calls[2][0].idempotencyKey).not.toBe(first); // an edited amount must not get the old draft back
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("shows the server's message when it refuses, and stays on the form", async () => {
    mockCreate.mockResolvedValue({ ok: false, reason: "error", message: "Assisted Quick Pay is turned off for your account." });
    await render(<PayAgain />);
    await fireEvent.changeText(screen.getByLabelText("Amount (RWF)"), "5000");
    await fireEvent.press(screen.getByText("Prepare payment"));
    expect(await screen.findByText("Assisted Quick Pay is turned off for your account.")).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("prepares a merchant payment with the merchant code and the paying account", async () => {
    setParams({ type: "pay_merchant", recipient: "123456", name: "", accountId: "acct-1", accountName: "MTN MoMo" });
    mockCreate.mockResolvedValue(created);
    await render(<PayAgain />);
    expect(screen.getByText("Merchant code 123456")).toBeTruthy();

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

  it.each([
    ["a landline", { type: "pay_person", recipient: "0221234567" }],
    ["a merchant reference that isn't a code", { type: "pay_merchant", recipient: "REF-7", accountId: "acct-1" }],
    ["a merchant with no paying account", { type: "pay_merchant", recipient: "123456" }],
    ["airtime", { type: "buy_airtime", recipient: "250788123456" }],
    ["nothing at all", {}],
  ])("won't open for %s", async (_label, params) => {
    setParams(params as Record<string, string>);
    await render(<PayAgain />);
    expect(screen.getByText("We can't prepare this payment")).toBeTruthy();
    expect(screen.queryByText("Prepare payment")).toBeNull();
  });
});
