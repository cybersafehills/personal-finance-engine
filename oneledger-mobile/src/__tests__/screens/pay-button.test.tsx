import { act, fireEvent, render, screen } from "@testing-library/react-native";

import PayButtonSettings from "@/app/(app)/pay-button";
import { PayTabButton } from "@/components/shell/PayTabButton";
import { setPayConfigCache } from "@/features/pay/config-cache";
import { getHoldPrefs, resetHoldPrefs } from "@/features/pay/hold-store";

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));

const mockStore = new Map<string, string>();
jest.mock("@/lib/device-store", () => ({
  deviceStore: {
    get: async (k: string) => mockStore.get(k) ?? null,
    set: async (k: string, v: string) => void mockStore.set(k, v),
    remove: async (k: string) => void mockStore.delete(k),
  },
}));

const all = { pay: true, assistedPay: true, ussdDirectory: true, scanToPay: true, trustedRecipients: true, paymentRequests: true };

beforeEach(() => {
  mockStore.clear();
  resetHoldPrefs();
  setPayConfigCache(all);
});

describe("Pay button settings", () => {
  it("starts on Scan to pay, half a second", async () => {
    await render(<PayButtonSettings />);
    expect(await screen.findByLabelText("Scan to pay, selected")).toBeTruthy();
    expect(screen.getByLabelText("0.5 seconds, selected")).toBeTruthy();
  });

  it("changes and keeps the action and the time", async () => {
    await render(<PayButtonSettings />);
    await fireEvent.press(await screen.findByLabelText("USSD directory"));
    await fireEvent.press(screen.getByLabelText("1 second"));
    expect(getHoldPrefs()).toEqual({ action: "ussd", durationMs: 1000 });
    expect(JSON.parse(mockStore.get("ol.pay-hold.v1") as string)).toEqual({ action: "ussd", durationMs: 1000 });
    expect(await screen.findByLabelText("USSD directory, selected")).toBeTruthy();
  });

  it("only offers what this account can use", async () => {
    setPayConfigCache({ ...all, scanToPay: false, paymentRequests: false });
    await render(<PayButtonSettings />);
    await screen.findByLabelText("Pay a person");
    expect(screen.queryByLabelText(/^Scan to pay/)).toBeNull();
    expect(screen.queryByLabelText(/^Request payment/)).toBeNull();
  });

  it("hides the timing when holding does nothing extra", async () => {
    await render(<PayButtonSettings />);
    await fireEvent.press(await screen.findByLabelText("Nothing extra"));
    expect(screen.queryByLabelText("0.5 seconds")).toBeNull();
  });
});

describe("Pay tab button", () => {
  it("opens the sheet on a tap and the chosen action on a hold, after the set time", async () => {
    const onPress = jest.fn();
    const onHold = jest.fn();
    await render(<PayTabButton onPress={onPress} onHold={onHold} holdMs={800} />);
    const button = screen.getByRole("button", { name: "Pay" });
    await act(async () => {
      fireEvent(button, "longPress");
    });
    expect(onHold).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
