import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Platform, Share } from "react-native";

import PayReview from "@/app/(app)/pay/[id]";
import { resetRouterMock, setParams } from "@/test/router-mock";

const mockFetch = jest.fn();
const mockHandoff = jest.fn();
const mockOpenUrl = jest.fn();

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("expo-linking", () => ({ openURL: (url: string) => mockOpenUrl(url) }));
jest.mock("@/api/mobile-api", () => ({
  fetchPayIntent: (id: string) => mockFetch(id),
  recordPayHandoff: (id: string, body: unknown) => mockHandoff(id, body),
}));

const intent = (over: Record<string, unknown> = {}) => ({
  id: "intent-9",
  state: "draft",
  paymentType: "pay_person",
  provider: "mtn",
  currency: "RWF",
  amountMinor: 5000,
  recipientName: "Jean",
  recipientMasked: "•••• ••• 3456",
  merchantCode: null,
  expiresAt: null,
  instruction: { ok: true, display: "*182*1*1*0788123456*5000#", telHref: "tel:*182*1*1*0788123456*5000%23" },
  ...over,
});
const loaded = (over: Record<string, unknown> = {}) => ({ ok: true, intent: intent(over), existed: false });

let shareSpy: jest.SpyInstance;

beforeEach(() => {
  resetRouterMock();
  setParams({ id: "intent-9" });
  [mockFetch, mockHandoff, mockOpenUrl].forEach((m) => m.mockReset());
  mockFetch.mockResolvedValue(loaded());
  mockHandoff.mockResolvedValue(loaded({ state: "awaiting_verification" }));
  shareSpy = jest.spyOn(Share, "share").mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
});
afterEach(() => {
  shareSpy.mockRestore();
  jest.restoreAllMocks();
});

describe("Pay review screen", () => {
  it("shows the amount, recipient, code and who authorises it, as a draft", async () => {
    await render(<PayReview />);
    expect(await screen.findByText("*182*1*1*0788123456*5000#")).toBeTruthy();
    expect(screen.getByText("5,000 RWF")).toBeTruthy();
    expect(screen.getByText("Jean · •••• ••• 3456")).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getByText(/never asks for your Mobile Money or banking PIN/)).toBeTruthy();
  });

  it("offers no action, and says why, when there is no verified route", async () => {
    mockFetch.mockResolvedValue(loaded({ instruction: null }));
    await render(<PayReview />);
    expect(await screen.findByText("No verified route yet")).toBeTruthy();
    expect(screen.queryByText("Share or copy code")).toBeNull();
    expect(screen.queryByText("Open phone dialer")).toBeNull();
  });

  it("explains a code it couldn't build instead of offering it", async () => {
    mockFetch.mockResolvedValue(loaded({ instruction: { ok: false, error: "Merchant code should be 3-12 digits." } }));
    await render(<PayReview />);
    expect(await screen.findByText("Merchant code should be 3-12 digits.")).toBeTruthy();
    expect(screen.queryByText("Share or copy code")).toBeNull();
  });

  it("records a copy hand-off only when the share completes", async () => {
    await render(<PayReview />);
    await fireEvent.press(await screen.findByText("Share or copy code"));

    await waitFor(() => expect(mockHandoff).toHaveBeenCalledWith("intent-9", { method: "copy", outcome: "copied" }));
    expect(shareSpy).toHaveBeenCalledWith({ message: "*182*1*1*0788123456*5000#" });
    expect(await screen.findByText("Awaiting verification")).toBeTruthy();
  });

  it("records nothing when the share sheet is dismissed", async () => {
    shareSpy.mockResolvedValue({ action: Share.dismissedAction, activityType: undefined });
    await render(<PayReview />);
    await fireEvent.press(await screen.findByText("Share or copy code"));
    await waitFor(() => expect(shareSpy).toHaveBeenCalled());
    expect(mockHandoff).not.toHaveBeenCalled();
    expect(screen.getByText("Draft")).toBeTruthy();
  });

  it("never claims success, even after a hand-off", async () => {
    mockHandoff.mockResolvedValue(loaded({ state: "successful" }));
    await render(<PayReview />);
    await fireEvent.press(await screen.findByText("Share or copy code"));
    await screen.findByText(/isn't proof of payment/);
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(screen.queryByText(/success|verified$|completed|paid/i)).toBeNull();
  });

  it("says so, and keeps the code, when the hand-off couldn't be recorded", async () => {
    mockHandoff.mockResolvedValue({ ok: false, reason: "error", message: "x" });
    await render(<PayReview />);
    await fireEvent.press(await screen.findByText("Share or copy code"));
    expect(await screen.findByText("Couldn't record that. Your payment isn't affected.")).toBeTruthy();
    expect(screen.getByText("*182*1*1*0788123456*5000#")).toBeTruthy();
  });

  describe("on Android", () => {
    beforeEach(() => jest.replaceProperty(Platform, "OS", "android"));

    it("never dials by itself: only an explicit tap opens the dialer", async () => {
      await render(<PayReview />);
      await screen.findByText("Open phone dialer");
      expect(mockOpenUrl).not.toHaveBeenCalled();

      mockOpenUrl.mockResolvedValue(undefined);
      await fireEvent.press(screen.getByText("Open phone dialer"));
      await waitFor(() => expect(mockOpenUrl).toHaveBeenCalledWith("tel:*182*1*1*0788123456*5000%23"));
      await waitFor(() =>
        expect(mockHandoff).toHaveBeenCalledWith("intent-9", { method: "dialer", outcome: "dialer_opened" }),
      );
    });

    it("falls back to sharing, and records it, when the dialer can't open", async () => {
      mockOpenUrl.mockRejectedValue(new Error("no handler"));
      await render(<PayReview />);
      await fireEvent.press(await screen.findByText("Open phone dialer"));

      expect(await screen.findByText(/Couldn't open the dialer/)).toBeTruthy();
      await waitFor(() =>
        expect(mockHandoff).toHaveBeenCalledWith("intent-9", { method: "dialer", outcome: "dialer_unsupported" }),
      );
    });
  });

  describe("on iPhone", () => {
    beforeEach(() => jest.replaceProperty(Platform, "OS", "ios"));

    it("offers no dial button, only share/copy and how to dial it", async () => {
      await render(<PayReview />);
      expect(await screen.findByText("Share or copy code")).toBeTruthy();
      expect(screen.queryByText("Open phone dialer")).toBeNull();
      expect(screen.getByText(/dial it in the Phone app/)).toBeTruthy();
    });
  });

  it("explains a payment that can't be found", async () => {
    mockFetch.mockResolvedValue({ ok: false, reason: "not_found", message: "That payment couldn't be found." });
    await render(<PayReview />);
    expect(await screen.findByText("That payment couldn't be found.")).toBeTruthy();
    expect(screen.queryByText("Try again")).toBeNull();
  });
});
