import * as Linking from "expo-linking";
import { fireEvent, render, screen } from "@testing-library/react-native";

import { PayLauncher } from "@/components/shell/PayLauncher";
import { resetRouterMock, router } from "@/test/router-mock";

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("expo-linking", () => ({ openURL: jest.fn() }));
jest.mock("@/lib/config", () => ({ config: { apiBaseUrl: "https://www.example.test" } }));

const onClose = jest.fn();
const ON = { pay: true, assistedPay: true, ussdDirectory: true, scanToPay: true };

beforeEach(() => {
  resetRouterMock();
  onClose.mockReset();
  (Linking.openURL as jest.Mock).mockReset();
});

describe("Pay launcher", () => {
  it("prepares a person payment in the app and closes", async () => {
    await render(<PayLauncher onClose={onClose} config={ON} />);
    await fireEvent.press(screen.getByRole("button", { name: "Pay a person" }));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/pay-new", params: { type: "pay_person" } });
    expect(onClose).toHaveBeenCalled();
  });

  it("disables the prepare-here actions where assisted pay is off, never faking one", async () => {
    await render(<PayLauncher onClose={onClose} config={{ pay: true, assistedPay: false }} />);
    await fireEvent.press(screen.getByRole("button", { name: "Pay a merchant" }));
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getAllByText("Coming later").length).toBe(2);
  });

  it.each([
    ["Pay a bill", "utilities"],
    ["Buy electricity", "utilities"],
    ["Buy airtime or data", "airtime_data"],
    ["Government services", "government"],
  ])("%s opens the in-app directory on %s, not the web", async (label, category) => {
    await render(<PayLauncher onClose={onClose} config={ON} />);
    await fireEvent.press(screen.getByRole("button", { name: label }));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/ussd", params: { category, title: label } });
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it("falls back to the web page for those tiles only where the directory is off", async () => {
    await render(<PayLauncher onClose={onClose} config={{ pay: true, assistedPay: true }} />);
    await fireEvent.press(screen.getByRole("button", { name: "Buy electricity" }));
    expect(Linking.openURL).toHaveBeenCalledWith("https://www.example.test/pay/new/buy_electricity");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("opens the directory in the app where it is on", async () => {
    await render(<PayLauncher onClose={onClose} config={ON} />);
    await fireEvent.press(screen.getByRole("button", { name: "Open USSD directory" }));
    expect(router.push).toHaveBeenCalledWith("/ussd");
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it("opens the directory on the web where it is off", async () => {
    await render(<PayLauncher onClose={onClose} config={{ pay: true }} />);
    await fireEvent.press(screen.getByRole("button", { name: "Open USSD directory" }));
    expect(Linking.openURL).toHaveBeenCalledWith("https://www.example.test/pay/ussd");
  });

  it("offers Scan to pay only where the server has it on", async () => {
    await render(<PayLauncher onClose={onClose} config={{ pay: true }} />);
    expect(screen.queryByRole("button", { name: "Scan to pay" })).toBeNull();
  });

  it("opens the scanner", async () => {
    await render(<PayLauncher onClose={onClose} config={ON} />);
    await fireEvent.press(screen.getByRole("button", { name: "Scan to pay" }));
    expect(router.push).toHaveBeenCalledWith("/scan");
  });

  it("holds only what is needed to start a payment: no activity, templates, recipients or favourites", async () => {
    await render(<PayLauncher onClose={onClose} config={{ ...ON, trustedRecipients: true }} />);
    for (const gone of ["View payment activity", "Use a payment template", "Saved recipients"]) {
      expect(screen.queryByText(gone)).toBeNull();
    }
  });

  it("closes", async () => {
    await render(<PayLauncher onClose={onClose} config={{ pay: true }} />);
    await fireEvent.press(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
