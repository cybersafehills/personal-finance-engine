import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import PayNew from "@/app/(app)/pay-new";
import { resetRouterMock, router, setParams } from "@/test/router-mock";

const mockCreate = jest.fn();
const mockAccounts = jest.fn();

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/api/mobile-api", () => ({ createPayIntent: (b: unknown) => mockCreate(b) }));
jest.mock("@/features/pay/payment-accounts", () => ({ loadPayableAccounts: () => mockAccounts() }));

const account = { id: "acc1", name: "MTN MoMo" };

beforeEach(() => {
  resetRouterMock();
  mockCreate.mockReset();
  mockAccounts.mockReset();
  mockAccounts.mockResolvedValue([account]);
  mockCreate.mockResolvedValue({ ok: true, intent: { id: "i1" }, existed: false });
  setParams({ type: "pay_person" });
});

async function fill(recipient: string, amount: string) {
  await fireEvent.changeText(await screen.findByLabelText("Mobile number"), recipient);
  await fireEvent.changeText(screen.getByLabelText("Amount (RWF)"), amount);
}

describe("Pay a person (from the Pay button)", () => {
  it("prepares a draft from the typed number, amount and account, then opens the review", async () => {
    await render(<PayNew />);
    await fill("078 123 4567", "5,000");
    await fireEvent.press(await screen.findByRole("button", { name: "Prepare payment" }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentType: "pay_person",
        amountMinor: 5000,
        recipientMsisdn: "250781234567",
        sourceAccountId: "acc1",
      }),
    );
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: "/pay/[id]", params: { id: "i1" } }));
  });

  it("refuses a number that is not a Rwandan mobile and sends nothing", async () => {
    await render(<PayNew />);
    await fill("12345", "5000");
    await fireEvent.press(await screen.findByRole("button", { name: "Prepare payment" }));
    expect(await screen.findByText("Enter a Rwandan mobile number, like 078 123 4567.")).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("refuses a missing amount", async () => {
    await render(<PayNew />);
    await fill("0781234567", "");
    await fireEvent.press(await screen.findByRole("button", { name: "Prepare payment" }));
    expect(await screen.findByText("Enter an amount greater than zero, in whole RWF.")).toBeTruthy();
  });

  it("shows the server's reason when the draft can't be prepared", async () => {
    mockCreate.mockResolvedValue({ ok: false, reason: "error", message: "Not allowed here." });
    await render(<PayNew />);
    await fill("0781234567", "1000");
    await fireEvent.press(await screen.findByRole("button", { name: "Prepare payment" }));
    expect(await screen.findByText("Not allowed here.")).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("explains when there is no account to pay from, and offers no way to submit", async () => {
    mockAccounts.mockResolvedValue([]);
    await render(<PayNew />);
    expect(await screen.findByText("You need a mobile-money account in OneLedger to prepare a payment.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Prepare payment" }).props.accessibilityState.disabled).toBe(true);
  });
});

describe("Pay a merchant", () => {
  it("sends the merchant code", async () => {
    setParams({ type: "pay_merchant" });
    await render(<PayNew />);
    await fireEvent.changeText(await screen.findByLabelText("Merchant code"), "123456");
    await fireEvent.changeText(screen.getByLabelText("Amount (RWF)"), "2000");
    await fireEvent.press(await screen.findByRole("button", { name: "Prepare payment" }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ paymentType: "pay_merchant", merchantCode: "123456" })));
  });
});

describe("an unsupported type", () => {
  it("offers nothing to pay", async () => {
    setParams({ type: "buy_airtime" });
    await render(<PayNew />);
    expect(await screen.findByText("Nothing to pay here")).toBeTruthy();
  });
});
