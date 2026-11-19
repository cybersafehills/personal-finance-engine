import { fireEvent, render, screen } from "@testing-library/react-native";

import PaymentActivity from "@/app/(app)/payment-activity";
import PaymentTemplates from "@/app/(app)/payment-templates";
import { resetRouterMock, router } from "@/test/router-mock";

const mockActivity = jest.fn();
const mockTemplates = jest.fn();

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/features/pay/activity", () => ({
  ...jest.requireActual("@/features/pay/activity"),
  getPaymentActivity: () => mockActivity(),
  getPaymentTemplates: () => mockTemplates(),
}));

beforeEach(() => {
  resetRouterMock();
  mockActivity.mockReset();
  mockTemplates.mockReset();
});

describe("Payment activity", () => {
  it("lists payments with where each stands and opens one", async () => {
    mockActivity.mockResolvedValue([
      { id: "i1", type: "pay_person", state: "awaiting_verification", amountMinor: 5000, currency: "RWF", recipient: "Amy", createdAt: "2026-11-18T10:00:00Z" },
    ]);
    await render(<PaymentActivity />);
    await fireEvent.press(await screen.findByRole("button", { name: "Amy, Person · Awaiting verification" }));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/pay/[id]", params: { id: "i1" } });
  });

  it("says when there are none", async () => {
    mockActivity.mockResolvedValue([]);
    await render(<PaymentActivity />);
    expect(await screen.findByText("No payments yet")).toBeTruthy();
  });

  it("offers a retry when loading fails", async () => {
    mockActivity.mockRejectedValue(new Error("x"));
    await render(<PaymentActivity />);
    expect(await screen.findByText("Try again")).toBeTruthy();
  });
});

describe("Payment templates", () => {
  const tpl = (over = {}) => ({ id: "t1", name: "Rent", type: "pay_merchant", defaultAmountMinor: 150000, recipientName: "Landlord", merchantCode: "445566", trustedRecipientId: null, ...over });

  it("opens the Pay form filled from a template", async () => {
    mockTemplates.mockResolvedValue([tpl()]);
    await render(<PaymentTemplates />);
    await fireEvent.press(await screen.findByRole("button", { name: "Rent" }));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/pay-new", params: { type: "pay_merchant", template: "t1" } });
  });

  it("keeps templates it can't fill in, and says so, without a way to use them", async () => {
    mockTemplates.mockResolvedValue([tpl({ id: "t2", name: "Airtime", type: "buy_airtime" })]);
    await render(<PaymentTemplates />);
    expect(await screen.findByText(/can't be filled in here yet/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Airtime" })).toBeNull();
  });

  it("says when there are none", async () => {
    mockTemplates.mockResolvedValue([]);
    await render(<PaymentTemplates />);
    expect(await screen.findByText("No templates yet")).toBeTruthy();
  });
});
