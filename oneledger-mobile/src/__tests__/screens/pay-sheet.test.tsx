import * as Linking from "expo-linking";
import { fireEvent, render, screen } from "@testing-library/react-native";

import { PaySheet } from "@/components/shell/PaySheet";
import { resetRouterMock, router } from "@/test/router-mock";

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("expo-linking", () => ({ openURL: jest.fn() }));
jest.mock("@/lib/config", () => ({ config: { apiBaseUrl: "https://www.example.test" } }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const onClose = jest.fn();

beforeEach(() => {
  resetRouterMock();
  onClose.mockReset();
  (Linking.openURL as jest.Mock).mockReset();
});

describe("Pay sheet", () => {
  it("prepares a person payment in the app and closes", async () => {
    await render(<PaySheet open onClose={onClose} config={{ pay: true, assistedPay: true }} />);
    await fireEvent.press(screen.getByRole("button", { name: "Pay a person" }));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/pay-new", params: { type: "pay_person" } });
    expect(onClose).toHaveBeenCalled();
  });

  it("disables the prepare-here actions where assisted pay is off, never faking one", async () => {
    await render(<PaySheet open onClose={onClose} config={{ pay: true, assistedPay: false }} />);
    await fireEvent.press(screen.getByRole("button", { name: "Pay a merchant" }));
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getAllByText("Coming later").length).toBe(2);
  });

  it("opens the web for the payment kinds the app has no verified route for", async () => {
    await render(<PaySheet open onClose={onClose} config={{ pay: true, assistedPay: true }} />);
    await fireEvent.press(screen.getByRole("button", { name: "Buy electricity" }));
    expect(Linking.openURL).toHaveBeenCalledWith("https://www.example.test/pay/new/buy_electricity");
  });

  it("opens the USSD directory, activity and templates on the web", async () => {
    await render(<PaySheet open onClose={onClose} config={{ pay: true }} />);
    await fireEvent.press(screen.getByRole("button", { name: "Open USSD directory" }));
    expect(Linking.openURL).toHaveBeenLastCalledWith("https://www.example.test/pay/ussd");
    await fireEvent.press(screen.getByRole("button", { name: "Payment activity" }));
    expect(Linking.openURL).toHaveBeenLastCalledWith("https://www.example.test/pay/activity");
  });

  it("closes", async () => {
    await render(<PaySheet open onClose={onClose} config={{ pay: true }} />);
    await fireEvent.press(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
