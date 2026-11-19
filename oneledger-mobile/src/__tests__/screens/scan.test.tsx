import * as Linking from "expo-linking";
import { Platform } from "react-native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import Scan from "@/app/(app)/scan";
import { resetRouterMock } from "@/test/router-mock";

const mockClassify = jest.fn();
const mockPrepare = jest.fn();
const mockHandoff = jest.fn();
const mockCamera = { permission: { granted: true, canAskAgain: true } as { granted: boolean; canAskAgain: boolean } | null, request: jest.fn(), onScanned: undefined as undefined | ((e: { data: string }) => void) };

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("expo-linking", () => ({ openURL: jest.fn(), openSettings: jest.fn() }));
jest.mock("expo-camera", () => ({
  useCameraPermissions: () => [mockCamera.permission, mockCamera.request],
  CameraView: (props: { onBarcodeScanned?: (e: { data: string }) => void }) => {
    mockCamera.onScanned = props.onBarcodeScanned;
    return null;
  },
}));
jest.mock("@/api/mobile-api", () => ({
  classifyScan: (raw: string) => mockClassify(raw),
  prepareScan: (raw: string, amount?: number) => mockPrepare(raw, amount),
  recordPayHandoff: (...a: unknown[]) => mockHandoff(...a),
}));

const model = (over: Record<string, unknown> = {}) => ({
  class: "verified_ussd",
  route: { kind: "ussd", template: "*182*1*1*{phone}*{amount}#", literal: "*182*1*1*0788123456*1500#" },
  providerLabel: "MTN",
  providerVerified: true,
  recipientMasked: "•••• ••• 3456",
  amount: { minor: 1500, currency: "RWF" },
  amountEditable: false,
  reference: null,
  warnings: [],
  ...over,
});

async function scan(raw = "*182*1*1*0788123456*1500#") {
  await render(<Scan />);
  await act(async () => {
    mockCamera.onScanned?.({ data: raw });
  });
}

beforeEach(() => {
  resetRouterMock();
  [mockClassify, mockPrepare, mockHandoff, mockCamera.request, Linking.openURL as jest.Mock].forEach((m) => m.mockReset());
  mockCamera.permission = { granted: true, canAskAgain: true };
  mockCamera.onScanned = undefined;
  mockClassify.mockResolvedValue({ ok: true, result: { ok: true, model: model() } });
  mockPrepare.mockResolvedValue({ ok: true, outcome: { status: "prepared", intentId: "i1", telHref: "tel:*182*1*1*0788123456*1500%23", existed: false } });
  mockHandoff.mockResolvedValue({ ok: true });
  Platform.OS = "android";
});

describe("Scan to pay", () => {
  it("asks for camera access first, and explains that nothing is saved", async () => {
    mockCamera.permission = { granted: false, canAskAgain: true };
    await render(<Scan />);
    expect(await screen.findByText(/Nothing is photographed or saved/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Allow camera" }));
    expect(mockCamera.request).toHaveBeenCalled();
  });

  it("points to settings when camera access was refused for good", async () => {
    mockCamera.permission = { granted: false, canAskAgain: false };
    await render(<Scan />);
    await fireEvent.press(await screen.findByRole("button", { name: "Open settings" }));
    expect(Linking.openSettings).toHaveBeenCalled();
  });

  it("classifies a scanned code and shows what it is before anything is prepared", async () => {
    await scan();
    expect(await screen.findByText("Review this payment")).toBeTruthy();
    expect(mockClassify).toHaveBeenCalledWith("*182*1*1*0788123456*1500#");
    expect(screen.getByText("RWF 1,500")).toBeTruthy();
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it("only acts on the first code the camera reports", async () => {
    await scan();
    await act(async () => {
      mockCamera.onScanned?.({ data: "second" });
    });
    expect(mockClassify).toHaveBeenCalledTimes(1);
  });

  it("explains a rejected code in plain words and offers to scan again", async () => {
    mockClassify.mockResolvedValue({ ok: true, result: { ok: false, class: "suspicious", reason: "unsafe_scheme" } });
    await scan("javascript:alert(1)");
    expect(await screen.findByText("That code tries to open something that isn't a payment. It was blocked.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Scan again" })).toBeTruthy();
  });

  it("says when the check could not be made", async () => {
    mockClassify.mockResolvedValue({ ok: false, disabled: false, reason: "unavailable", message: "x" });
    await scan();
    expect(await screen.findByText(/couldn't check this code/)).toBeTruthy();
  });

  it("says so when Scan to pay is off for the account", async () => {
    mockClassify.mockResolvedValue({ ok: false, disabled: true, reason: "unavailable", message: "x" });
    await scan();
    expect(await screen.findByText(/isn't available on your account/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Scan again" })).toBeNull();
  });

  it("prepares a payment on tap, shows the code, and opens the dialer only on a further tap", async () => {
    await scan();
    await fireEvent.press(await screen.findByRole("button", { name: "Prepare payment" }));
    expect(await screen.findByLabelText("Code to dial: *182*1*1*0788123456*1500#")).toBeTruthy();
    expect(Linking.openURL).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: "Open phone dialer" }));
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith("tel:*182*1*1*0788123456*1500%23"));
    expect(mockHandoff).toHaveBeenCalledWith("i1", { method: "dialer", outcome: "dialer_opened" });
    expect(await screen.findByText("Awaiting confirmation")).toBeTruthy();
    // Never claims the payment went through.
    expect(screen.queryByText(/payment (was )?(successful|complete|sent)/i)).toBeNull();
  });

  it("asks for an amount when the code has none, and validates it before sending", async () => {
    mockClassify.mockResolvedValue({
      ok: true,
      result: { ok: true, model: model({ class: "oneledger_payment", route: { kind: "oneledger", provider: "mtn", merchantIdMasked: "••12", currency: "RWF" }, amount: null, amountEditable: true, warnings: ["merchant_unverified"] }) },
    });
    await scan("OLPAY");
    const prepare = await screen.findByRole("button", { name: "Prepare payment" });
    expect(prepare.props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(screen.getByLabelText("Amount to pay (RWF)"), "12.5");
    await fireEvent.press(screen.getByRole("button", { name: "Prepare payment" }));
    expect(await screen.findByText("Enter a whole RWF amount, digits only.")).toBeTruthy();
    expect(mockPrepare).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText("Amount to pay (RWF)"), "2,500");
    await fireEvent.press(screen.getByRole("button", { name: "Prepare payment" }));
    await waitFor(() => expect(mockPrepare).toHaveBeenCalledWith("OLPAY", 2500));
  });

  it("opens a menu code without recording a payment", async () => {
    mockClassify.mockResolvedValue({ ok: true, result: { ok: true, model: model({ amount: null, route: { kind: "ussd", template: "*182*6*1#", literal: "*182*6*1#" } }) } });
    mockPrepare.mockResolvedValue({ ok: true, outcome: { status: "info_only", telHref: "tel:*182*6*1%23" } });
    await scan("*182*6*1#");
    await fireEvent.press(await screen.findByRole("button", { name: "Open USSD menu" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Open USSD menu" }));
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith("tel:*182*6*1%23"));
    expect(mockHandoff).not.toHaveBeenCalled();
  });

  it("explains a code with no verified route instead of offering to continue", async () => {
    mockClassify.mockResolvedValue({
      ok: true,
      result: { ok: true, model: model({ class: "provider_link", route: { kind: "provider_link", provider: "x", url: "https://x" }, amount: null }) },
    });
    await scan("https://x");
    expect(await screen.findByText(/no verified USSD path/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Prepare payment" })).toBeNull();
  });

  it("on iPhone offers share/copy, not a dial button", async () => {
    Platform.OS = "ios";
    await scan();
    await fireEvent.press(await screen.findByRole("button", { name: "Prepare payment" }));
    expect(await screen.findByText(/dial it in the Phone app/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open phone dialer" })).toBeNull();
  });

  it("puts its title in the navigation header (the back arrow is native)", async () => {
    await render(<Scan />);
    expect(screen.getByRole("header", { name: "Scan to pay" })).toBeTruthy();
  });
});
