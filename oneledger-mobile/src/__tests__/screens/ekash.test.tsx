import * as Linking from "expo-linking";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import Ekash from "@/app/(app)/ekash";

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("expo-linking", () => ({ openURL: jest.fn() }));

beforeEach(() => (Linking.openURL as jest.Mock).mockReset().mockResolvedValue(undefined));

describe("Use eKash screen", () => {
  it("asks for the receiver's ID, the amount and an optional reference", async () => {
    await render(<Ekash />);
    expect(screen.getByLabelText("Receiver's ID")).toBeTruthy();
    expect(screen.getByLabelText("Amount (RWF)")).toBeTruthy();
    expect(screen.getByLabelText("Reference (optional)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pay with eKash" }).props.accessibilityState.disabled).toBe(true);
  });

  it("builds the code and opens the dialer with it, never before a tap", async () => {
    await render(<Ekash />);
    await fireEvent.changeText(screen.getByLabelText("Receiver's ID"), "0781234567");
    await fireEvent.changeText(screen.getByLabelText("Amount (RWF)"), "5000");
    await fireEvent.changeText(screen.getByLabelText("Reference (optional)"), "Rent");
    expect(await screen.findByLabelText("Code to dial: *182*1*2*0781234567*5000#")).toBeTruthy();
    expect(Linking.openURL).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Pay with eKash" }));
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith("tel:*182*1*2*0781234567*5000%23"));
  });

  it("explains a bad amount and keeps the button off", async () => {
    await render(<Ekash />);
    await fireEvent.changeText(screen.getByLabelText("Receiver's ID"), "0781234567");
    await fireEvent.changeText(screen.getByLabelText("Amount (RWF)"), "5,000");
    expect(screen.getByRole("button", { name: "Pay with eKash" }).props.accessibilityState.disabled).toBe(true);
    expect(screen.queryByLabelText(/Code to dial/)).toBeNull();
  });
});
