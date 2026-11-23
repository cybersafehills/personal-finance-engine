import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Platform, Share } from "react-native";

import PayReview from "@/app/(app)/pay/[id]";
import { resetRouterMock, router, setParams } from "@/test/router-mock";

const mockFetch = jest.fn();
const mockHandoff = jest.fn();
const mockSettle = jest.fn();
const mockOpenUrl = jest.fn();

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("expo-linking", () => ({ openURL: (url: string) => mockOpenUrl(url) }));
jest.mock("@/api/mobile-api", () => ({
  fetchPayIntent: (id: string) => mockFetch(id),
  recordPayHandoff: (id: string, body: unknown) => mockHandoff(id, body),
  settlePayIntent: (id: string, outcome: string) => mockSettle(id, outcome),
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
  recipientMsisdn: "250788123456",
  merchantCode: null,
  expiresAt: null,
  updatedAt: new Date(Date.now() - 5_000).toISOString(),
  verified: false,
  instruction: { ok: true, display: "*182*1*1*0788123456*5000#", telHref: "tel:*182*1*1*0788123456*5000%23" },
  ...over,
});
const loaded = (over: Record<string, unknown> = {}) => ({ ok: true, intent: intent(over), existed: false });

let shareSpy: jest.SpyInstance;

beforeEach(() => {
  resetRouterMock();
  setParams({ id: "intent-9" });
  [mockFetch, mockHandoff, mockSettle, mockOpenUrl].forEach((m) => m.mockReset());
  mockFetch.mockResolvedValue(loaded());
  mockHandoff.mockResolvedValue(loaded({ state: "awaiting_verification" }));
  shareSpy = jest.spyOn(Share, "share").mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
});
afterEach(() => {
  shareSpy.mockRestore();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("Pay review screen", () => {
  it("shows the amount, recipient, code and who authorises it, as a draft", async () => {
    await render(<PayReview />);
    expect(await screen.findByText("*182*1*1*0788123456*5000#")).toBeTruthy();
    expect(screen.getByText("5,000 RWF")).toBeTruthy();
    // The whole number: the payer must be able to check who they are paying.
    expect(screen.getByText("Jean · 078 812 3456")).toBeTruthy();
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

  describe.each(["android", "ios"] as const)("on %s", (os) => {
    beforeEach(() => jest.replaceProperty(Platform, "OS", os));

    it("never dials by itself: only an explicit tap opens the dialer, then the payment is waiting", async () => {
      await render(<PayReview />);
      await screen.findByText("Open phone dialer");
      expect(mockOpenUrl).not.toHaveBeenCalled();

      mockOpenUrl.mockResolvedValue(undefined);
      await fireEvent.press(screen.getByText("Open phone dialer"));
      await waitFor(() => expect(mockOpenUrl).toHaveBeenCalledWith("tel:*182*1*1*0788123456*5000%23"));
      await waitFor(() =>
        expect(mockHandoff).toHaveBeenCalledWith("intent-9", { method: "dialer", outcome: "dialer_opened" }),
      );
      // The live status takes over: a spinner, not a tick.
      expect(await screen.findByText("Waiting for confirmation")).toBeTruthy();
      expect(screen.getByTestId("status-spinner")).toBeTruthy();
      expect(screen.queryByTestId("status-tick")).toBeNull();
    });

    it("falls back to sharing, and records it, when the dialer can't open", async () => {
      mockOpenUrl.mockRejectedValue(new Error("no handler"));
      await render(<PayReview />);
      await fireEvent.press(await screen.findByText("Open phone dialer"));
      await waitFor(() =>
        expect(mockHandoff).toHaveBeenCalledWith("intent-9", { method: "dialer", outcome: "dialer_unsupported" }),
      );
    });

    it("records a copy hand-off only when the share completes", async () => {
      await render(<PayReview />);
      await fireEvent.press(await screen.findByText("Share or copy code"));
      await waitFor(() => expect(mockHandoff).toHaveBeenCalledWith("intent-9", { method: "copy", outcome: "copied" }));
      expect(shareSpy).toHaveBeenCalledWith({ message: "*182*1*1*0788123456*5000#" });
    });
  });

  it("records nothing when the share sheet is dismissed (iPhone reports it)", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    shareSpy.mockResolvedValue({ action: Share.dismissedAction, activityType: undefined });
    await render(<PayReview />);
    await fireEvent.press(await screen.findByText("Share or copy code"));
    await waitFor(() => expect(shareSpy).toHaveBeenCalled());
    expect(mockHandoff).not.toHaveBeenCalled();
    expect(screen.getByText("Draft")).toBeTruthy();
  });

  it("says so, and keeps the code, when the hand-off couldn't be recorded", async () => {
    mockHandoff.mockResolvedValue({ ok: false, reason: "error", message: "x" });
    await render(<PayReview />);
    await fireEvent.press(await screen.findByText("Share or copy code"));
    expect(await screen.findByText("Couldn't record that. Your payment isn't affected.")).toBeTruthy();
    expect(screen.getByText("*182*1*1*0788123456*5000#")).toBeTruthy();
  });
});

describe("Payment status", () => {
  it("shows the whole number on the status screen too, never masked", async () => {
    mockFetch.mockResolvedValue(loaded({ state: "awaiting_verification" }));
    await render(<PayReview />);
    expect(await screen.findByText("Jean · 078 812 3456")).toBeTruthy();
    expect(screen.queryByText(/••••/)).toBeNull();
  });

  it("falls back to the masked number from an older server that does not send it", async () => {
    mockFetch.mockResolvedValue(loaded({ recipientMsisdn: null }));
    await render(<PayReview />);
    expect(await screen.findByText("Jean · •••• ••• 3456")).toBeTruthy();
  });

  it("shows a spinner, and no tick, while a handed-off payment waits for the provider", async () => {
    mockFetch.mockResolvedValue(loaded({ state: "awaiting_verification" }));
    await render(<PayReview />);
    expect(await screen.findByText("Waiting for confirmation")).toBeTruthy();
    expect(screen.getByTestId("status-spinner")).toBeTruthy();
    expect(screen.queryByText(/money sent|marked as sent/i)).toBeNull();
  });

  it("shows a blue tick and 'Money sent' once the provider's message confirmed it", async () => {
    mockFetch.mockResolvedValue(loaded({ state: "successful", verified: true }));
    await render(<PayReview />);
    expect(await screen.findByText("Money sent")).toBeTruthy();
    expect(screen.getByTestId("status-tick")).toBeTruthy();
    expect(screen.getByText(/confirmed by your provider/)).toBeTruthy();
  });

  it("says 'Marked as sent' (not provider-confirmed) when you confirmed it yourself", async () => {
    mockFetch.mockResolvedValue(loaded({ state: "successful", verified: false }));
    await render(<PayReview />);
    expect(await screen.findByText("Marked as sent")).toBeTruthy();
    expect(screen.getByText(/you confirmed this payment/)).toBeTruthy();
  });

  it.each([
    ["failed", "Payment didn't go through"],
    ["expired", "Payment didn't go through"],
    ["reversed", "Payment reversed"],
  ])("shows a red cross for %s", async (state, title) => {
    mockFetch.mockResolvedValue(loaded({ state }));
    await render(<PayReview />);
    expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.getByTestId("status-cross")).toBeTruthy();
    expect(screen.getByText("Try again")).toBeTruthy();
  });

  it("closes with Done once settled", async () => {
    mockFetch.mockResolvedValue(loaded({ state: "successful", verified: true }));
    await render(<PayReview />);
    await fireEvent.press(await screen.findByText("Done"));
    expect(router.back).toHaveBeenCalled();
  });

  it("checks again every few seconds and flips to the tick by itself", async () => {
    jest.useFakeTimers();
    mockFetch.mockResolvedValueOnce(loaded({ state: "awaiting_verification" }));
    await render(<PayReview />);
    expect(await screen.findByText("Waiting for confirmation")).toBeTruthy();

    mockFetch.mockResolvedValue(loaded({ state: "successful", verified: true }));
    await act(async () => {
      jest.advanceTimersByTime(4100);
    });
    expect(await screen.findByText("Money sent")).toBeTruthy();
    expect(screen.getByTestId("status-tick")).toBeTruthy();
  });

  it("stops asking once the payment is settled", async () => {
    jest.useFakeTimers();
    mockFetch.mockResolvedValue(loaded({ state: "failed" }));
    await render(<PayReview />);
    await screen.findByText("Payment didn't go through");
    mockFetch.mockClear();
    await act(async () => {
      jest.advanceTimersByTime(20_000);
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  describe("when no provider message arrives", () => {
    const old = () => loaded({ state: "awaiting_verification", updatedAt: new Date(Date.now() - 5 * 60_000).toISOString() });

    it("asks you what happened, after a while", async () => {
      mockFetch.mockResolvedValue(old());
      await render(<PayReview />);
      expect(await screen.findByText("Still waiting?")).toBeTruthy();
      expect(screen.getByText("I sent it")).toBeTruthy();
      expect(screen.getByText("It didn't go through")).toBeTruthy();
    });

    it("does not ask straight away", async () => {
      mockFetch.mockResolvedValue(loaded({ state: "awaiting_verification" }));
      await render(<PayReview />);
      await screen.findByText("Waiting for confirmation");
      expect(screen.queryByText("Still waiting?")).toBeNull();
    });

    it("'I sent it' confirms it as yours, not as provider-verified", async () => {
      mockFetch.mockResolvedValue(old());
      mockSettle.mockResolvedValue(loaded({ state: "successful", verified: false }));
      await render(<PayReview />);
      await fireEvent.press(await screen.findByText("I sent it"));
      await waitFor(() => expect(mockSettle).toHaveBeenCalledWith("intent-9", "sent"));
      expect(await screen.findByText("Marked as sent")).toBeTruthy();
    });

    it("'It didn't go through' marks it failed", async () => {
      mockFetch.mockResolvedValue(old());
      mockSettle.mockResolvedValue(loaded({ state: "failed" }));
      await render(<PayReview />);
      await fireEvent.press(await screen.findByText("It didn't go through"));
      await waitFor(() => expect(mockSettle).toHaveBeenCalledWith("intent-9", "failed"));
      expect(await screen.findByTestId("status-cross")).toBeTruthy();
    });

    it("shows why it couldn't be settled", async () => {
      mockFetch.mockResolvedValue(old());
      mockSettle.mockResolvedValue({ ok: false, reason: "error", message: "That isn't allowed from this payment's current state." });
      await render(<PayReview />);
      await fireEvent.press(await screen.findByText("I sent it"));
      expect(await screen.findByText("That isn't allowed from this payment's current state.")).toBeTruthy();
    });
  });
});
