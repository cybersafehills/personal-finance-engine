import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import PayNew from "@/app/(app)/pay-new";
import { setPayConfigCache } from "@/features/pay/config-cache";
import { resetRouterMock, router, setParams } from "@/test/router-mock";

const mockOffer = jest.fn();
const mockStart = jest.fn();
const mockAccounts = jest.fn();

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/api/mobile-api", () => ({
  createPayIntent: jest.fn(),
  fetchSaveOnOffer: (b: unknown) => mockOffer(b),
  startSaveOn: (b: unknown) => mockStart(b),
}));
jest.mock("@/features/pay/recipients", () => ({
  ...jest.requireActual("@/features/pay/recipients"),
  getTrustedRecipients: () => Promise.resolve([]),
  getRecentRecipients: () => Promise.resolve([]),
}));
jest.mock("@/features/pay/activity", () => ({ getPaymentTemplate: () => Promise.resolve(null) }));
jest.mock("@/features/pay/payment-accounts", () => ({ loadPayableAccounts: () => mockAccounts() }));

const capacityOffer = {
  kind: "capacity",
  networkSlug: "ekash",
  totalMinor: "25000000",
  parts: [
    { index: 1, amountMinor: "8333334", feeMinor: "20" },
    { index: 2, amountMinor: "8333333", feeMinor: "20" },
    { index: 3, amountMinor: "8333333", feeMinor: "20" },
  ],
  singleFeeMinor: null,
  plannedFeeMinor: "60",
  savingsMinor: null,
  feeBasis: "verified_tariff",
  capacityMinor: "10000000",
  source: { label: "MTN Rwanda, MoMo Tariffs page", url: "https://www.mtn.co.rw/momo-tarrif/", asOf: "2026-11-24T10:00:00Z" },
};
const savingOffer = {
  kind: "fee_saving",
  networkSlug: null,
  totalMinor: "180000",
  parts: [
    { index: 1, amountMinor: "150000", feeMinor: "250" },
    { index: 2, amountMinor: "30000", feeMinor: "250" },
  ],
  singleFeeMinor: "1500",
  plannedFeeMinor: "500",
  savingsMinor: "1000",
  feeBasis: "verified_tariff",
  capacityMinor: null,
  source: { label: "MTN Rwanda, MoMo Tariffs page", url: "https://www.mtn.co.rw/momo-tarrif/", asOf: "2026-11-24T10:00:00Z" },
};

beforeEach(() => {
  resetRouterMock();
  mockOffer.mockReset();
  mockStart.mockReset();
  mockAccounts.mockReset();
  mockAccounts.mockResolvedValue([{ id: "acc1", name: "MTN MoMo" }]);
  mockOffer.mockResolvedValue({ ok: true, offer: null });
  setParams({ type: "pay_person" });
  setPayConfigCache({ paySplits: true });
});
afterEach(() => setPayConfigCache(null));

async function fill(recipient: string, amount: string) {
  await fireEvent.changeText(await screen.findByLabelText("Mobile number"), recipient);
  await fireEvent.changeText(screen.getByLabelText("Amount (RWF)"), amount);
}

describe("Pay a person with Save On", () => {
  it("offers a split above the eKash limit, then starts it with the parts decided by the server", async () => {
    mockOffer.mockResolvedValue({ ok: true, offer: capacityOffer });
    mockStart.mockResolvedValue({ ok: true, planId: "p1", intent: { id: "part1" }, index: null });
    await render(<PayNew />);
    await fireEvent.press(await screen.findByRole("button", { name: "Send over eKash" }));
    await fill("078 123 4567", "25000000");

    expect(await screen.findByText("Above the eKash limit for one transfer", {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.getByText(/Part 1 · 8,333,334 RWF/)).toBeTruthy();
    expect(screen.getByText(/OneLedger never moves money/)).toBeTruthy();
    // The offer was asked for over eKash, for the typed amount; the parts are not sent anywhere.
    expect(mockOffer).toHaveBeenLastCalledWith(
      expect.objectContaining({ paymentType: "pay_person", amountMinor: 25000000, networkSlug: "ekash", sourceAccountId: "acc1" }),
    );

    await fireEvent.press(screen.getByRole("button", { name: "Split into 3 parts" }));
    await waitFor(() => expect(mockStart).toHaveBeenCalled());
    const body = mockStart.mock.calls[0][0];
    expect(body).toMatchObject({ paymentType: "pay_person", amountMinor: 25000000, networkSlug: "ekash", recipientMsisdn: "250781234567" });
    expect(body).not.toHaveProperty("parts");
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: "/pay/[id]", params: { id: "part1" } }));
  });

  it("shows a fee saving for an MTN to MTN amount, and says it is one choice among two", async () => {
    mockOffer.mockResolvedValue({ ok: true, offer: savingOffer });
    await render(<PayNew />);
    await fill("078 123 4567", "180000");
    expect(await screen.findByText("Lower fees available", {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.getByText(/That saves 1,000 RWF/)).toBeTruthy();
    expect(screen.getByText(/send it as one transfer/i)).toBeTruthy();
    // No eKash choice made: the offer is asked for without a network.
    expect(mockOffer).toHaveBeenLastCalledWith(expect.objectContaining({ amountMinor: 180000, networkSlug: undefined }));
  });

  it("shows no card when the amount goes as one transfer", async () => {
    await render(<PayNew />);
    await fill("078 123 4567", "5000");
    await waitFor(() => expect(mockOffer).toHaveBeenCalled(), { timeout: 2000 });
    expect(screen.queryByText("Lower fees available")).toBeNull();
    expect(screen.queryByText("Above the eKash limit for one transfer")).toBeNull();
  });

  it("shows the server's reason when the split can't be started", async () => {
    mockOffer.mockResolvedValue({ ok: true, offer: savingOffer });
    mockStart.mockResolvedValue({ ok: false, reason: "error", code: "no_split", message: "No split is available for this payment." });
    await render(<PayNew />);
    await fill("078 123 4567", "180000");
    await fireEvent.press(await screen.findByRole("button", { name: "Split into 2 parts" }, { timeout: 2000 }));
    expect(await screen.findByText("No split is available for this payment.")).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("is invisible when Save On is off for this user", async () => {
    setPayConfigCache({ paySplits: false });
    await render(<PayNew />);
    await fill("078 123 4567", "25000000");
    expect(screen.queryByRole("button", { name: "Send over eKash" })).toBeNull();
    expect(screen.queryByRole("button", { name: "How Save On works" })).toBeNull();
    await new Promise((r) => setTimeout(r, 600));
    expect(mockOffer).not.toHaveBeenCalled();
  });
});
