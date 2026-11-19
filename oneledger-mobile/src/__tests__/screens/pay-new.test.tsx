import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import PayNew from "@/app/(app)/pay-new";
import { resetRouterMock, router, setParams } from "@/test/router-mock";

const mockCreate = jest.fn();
const mockAccounts = jest.fn();

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/api/mobile-api", () => ({ createPayIntent: (b: unknown) => mockCreate(b) }));
const mockSaved = jest.fn();
const mockRecent = jest.fn();
const mockSaveContact = jest.fn();
jest.mock("@/features/pay/recipients", () => ({
  ...jest.requireActual("@/features/pay/recipients"),
  createTrustedRecipient: (i: unknown) => mockSaveContact(i),
  getTrustedRecipients: () => mockSaved(),
  getRecentRecipients: () => mockRecent(),
}));
const mockTemplate = jest.fn();
jest.mock("@/features/pay/activity", () => ({ getPaymentTemplate: (id: string) => mockTemplate(id) }));
jest.mock("@/features/pay/payment-accounts", () => ({ loadPayableAccounts: () => mockAccounts() }));

const account = { id: "acc1", name: "MTN MoMo" };

beforeEach(() => {
  resetRouterMock();
  mockCreate.mockReset();
  mockAccounts.mockReset();
  mockSaved.mockReset();
  mockTemplate.mockReset();
  mockTemplate.mockResolvedValue(null);
  mockSaveContact.mockReset();
  mockSaveContact.mockResolvedValue(null);
  mockRecent.mockReset();
  mockSaved.mockResolvedValue([]);
  mockRecent.mockResolvedValue([]);
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

describe("saved and recent recipients", () => {
  it("fills the number and name from a saved person, then prepares with that number", async () => {
    mockSaved.mockResolvedValue([{ id: "r1", name: "Amy", kind: "phone", msisdn: "250781234567", merchantCode: null, trusted: true, relationship: null }]);
    await render(<PayNew />);
    await fireEvent.press(await screen.findByRole("button", { name: "Amy (trusted)" }));
    expect(screen.getByLabelText("Mobile number").props.value).toBe("078 123 4567");
    await fireEvent.changeText(screen.getByLabelText("Amount (RWF)"), "1000");
    await fireEvent.press(await screen.findByRole("button", { name: "Prepare payment" }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ recipientMsisdn: "250781234567", recipientName: "Amy" })));
  });

  it("fills only the name from a recent payee", async () => {
    mockRecent.mockResolvedValue([{ name: "Bob", maskedMsisdn: "•••• 1111", kind: "phone" }]);
    await render(<PayNew />);
    await fireEvent.press(await screen.findByRole("button", { name: "Bob" }));
    expect(screen.getByLabelText("Name (optional)").props.value).toBe("Bob");
    expect(screen.getByLabelText("Mobile number").props.value).toBe("");
  });

  it("still works by typing when saved recipients can't be read", async () => {
    mockSaved.mockRejectedValue(new Error("x"));
    mockRecent.mockRejectedValue(new Error("x"));
    await render(<PayNew />);
    expect(await screen.findByLabelText("Mobile number")).toBeTruthy();
    expect(screen.queryByText("Saved recipients")).toBeNull();
  });
});

describe("save as contact", () => {
  it("keeps the number and name as a contact after the draft is prepared", async () => {
    await render(<PayNew />);
    await fill("078 123 4567", "1000");
    await fireEvent.changeText(screen.getByLabelText("Name (optional)"), "Amy");
    await fireEvent.press(screen.getByRole("switch", { name: "Save as contact" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Prepare payment" }));
    await waitFor(() => expect(mockSaveContact).toHaveBeenCalledWith({ name: "Amy", kind: "phone", number: "0781234567", trusted: false }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
  });

  it("does not save anything unless asked", async () => {
    await render(<PayNew />);
    await fill("078 123 4567", "1000");
    await fireEvent.changeText(screen.getByLabelText("Name (optional)"), "Amy");
    await fireEvent.press(await screen.findByRole("button", { name: "Prepare payment" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(mockSaveContact).not.toHaveBeenCalled();
  });

  it("asks for a name first when saving is on, and sends nothing", async () => {
    await render(<PayNew />);
    await fill("078 123 4567", "1000");
    await fireEvent.press(screen.getByRole("switch", { name: "Save as contact" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Prepare payment" }));
    expect(await screen.findByText("Add a name to save this contact, or turn saving off.")).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("saves a merchant as a merchant contact", async () => {
    setParams({ type: "pay_merchant" });
    await render(<PayNew />);
    await fireEvent.changeText(await screen.findByLabelText("Merchant code"), "123456");
    await fireEvent.changeText(screen.getByLabelText("Amount (RWF)"), "2000");
    await fireEvent.changeText(screen.getByLabelText("Name (optional)"), "Kigali Shop");
    await fireEvent.press(screen.getByRole("switch", { name: "Save as contact" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Prepare payment" }));
    await waitFor(() => expect(mockSaveContact).toHaveBeenCalledWith({ name: "Kigali Shop", kind: "merchant", number: "123456", trusted: false }));
  });

  it("fills the form from a saved contact opened from People and merchants", async () => {
    setParams({ type: "pay_person", saved: "r1" });
    mockSaved.mockResolvedValue([{ id: "r1", name: "Amy", kind: "phone", msisdn: "250781234567", merchantCode: null, trusted: false, relationship: null }]);
    await render(<PayNew />);
    await waitFor(() => expect(screen.getByLabelText("Mobile number").props.value).toBe("078 123 4567"));
    expect(screen.getByLabelText("Name (optional)").props.value).toBe("Amy");
  });
});

describe("from a payment template", () => {
  it("fills a merchant's code, name and usual amount", async () => {
    setParams({ type: "pay_merchant", template: "t1" });
    mockTemplate.mockResolvedValue({ id: "t1", name: "Rent", type: "pay_merchant", defaultAmountMinor: 150000, recipientName: "Landlord", merchantCode: "445566", trustedRecipientId: null });
    await render(<PayNew />);
    await waitFor(() => expect(screen.getByLabelText("Merchant code").props.value).toBe("445566"));
    expect(screen.getByLabelText("Name (optional)").props.value).toBe("Landlord");
    expect(screen.getByLabelText("Amount (RWF)").props.value).toBe("150000");
  });

  it("gets a person's full number from the saved contact the template was linked to", async () => {
    setParams({ type: "pay_person", template: "t2" });
    mockTemplate.mockResolvedValue({ id: "t2", name: "Mum", type: "pay_person", defaultAmountMinor: null, recipientName: null, merchantCode: null, trustedRecipientId: "r9" });
    mockSaved.mockResolvedValue([{ id: "r9", name: "Mum", kind: "phone", msisdn: "250781234567", merchantCode: null, trusted: true, relationship: null }]);
    await render(<PayNew />);
    await waitFor(() => expect(screen.getByLabelText("Mobile number").props.value).toBe("078 123 4567"));
    expect(screen.getByLabelText("Name (optional)").props.value).toBe("Mum");
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

describe("Opened from a person's page", () => {
  it("fills the number and the name", async () => {
    setParams({ type: "pay_person", to: "0781234567", name: "Amy" });
    await render(<PayNew />);
    expect((await screen.findByLabelText("Mobile number")).props.value).toBe("0781234567");
    expect(screen.getByLabelText("Name (optional)").props.value).toBe("Amy");
  });
  it("fills a merchant code", async () => {
    setParams({ type: "pay_merchant", to: "123456", name: "Kigali Shop" });
    await render(<PayNew />);
    expect((await screen.findByLabelText("Merchant code")).props.value).toBe("123456");
  });
});
