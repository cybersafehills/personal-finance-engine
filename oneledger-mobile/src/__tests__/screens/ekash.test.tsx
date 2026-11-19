import * as Linking from "expo-linking";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import Ekash from "@/app/(app)/ekash";

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("expo-linking", () => ({ openURL: jest.fn() }));
const mockSaved = jest.fn();
const mockCreate = jest.fn();
jest.mock("@/features/pay/recipients", () => ({
  ...jest.requireActual("@/features/pay/recipients"),
  getTrustedRecipients: () => mockSaved(),
  createTrustedRecipient: (...a: unknown[]) => mockCreate(...a),
}));
const mockPick = jest.fn();
jest.mock("@/features/pay/phone-contacts", () => ({ pickPhoneContact: () => mockPick() }));

beforeEach(() => {
  (Linking.openURL as jest.Mock).mockReset().mockResolvedValue(undefined);
  mockSaved.mockReset().mockResolvedValue([]);
  mockCreate.mockReset().mockResolvedValue(null);
  mockPick.mockReset();
});

const person = { id: "1", name: "Mum", kind: "phone", msisdn: "250781234567", merchantCode: null, accountReference: null, trusted: false, relationship: null };

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

  it("fills the receiver and name from a saved contact", async () => {
    mockSaved.mockResolvedValue([person]);
    await render(<Ekash />);
    await fireEvent.press(await screen.findByText("Mum"));
    expect(screen.getByLabelText("Receiver's ID").props.value).toBe("0781234567");
    expect(screen.getByLabelText("Name (optional)").props.value).toBe("Mum");
  });

  it("fills the receiver and name from the phone's contacts, and the name can still be changed", async () => {
    mockPick.mockResolvedValue({ ok: true, contact: { name: "Joe Doe", number: "0788123456" } });
    await render(<Ekash />);
    await fireEvent.press(screen.getByRole("button", { name: "Choose from my phone's contacts" }));
    await waitFor(() => expect(screen.getByLabelText("Receiver's ID").props.value).toBe("0788123456"));
    expect(screen.getByLabelText("Name (optional)").props.value).toBe("Joe Doe");
    await fireEvent.changeText(screen.getByLabelText("Name (optional)"), "Joe");
    expect(screen.getByLabelText("Name (optional)").props.value).toBe("Joe");
  });

  it("shows why a contact couldn't be used", async () => {
    mockPick.mockResolvedValue({ ok: false, cancelled: false, message: "That contact has no Rwandan mobile number." });
    await render(<Ekash />);
    await fireEvent.press(screen.getByRole("button", { name: "Choose from my phone's contacts" }));
    expect(await screen.findByText("That contact has no Rwandan mobile number.")).toBeTruthy();
    // The message sits on the Receiver's ID field, and goes away when they type.
    expect(screen.getByLabelText("Receiver's ID").props["aria-invalid"]).toBe(true);
    await fireEvent.changeText(screen.getByLabelText("Receiver's ID"), "0788");
    expect(screen.queryByText("That contact has no Rwandan mobile number.")).toBeNull();
  });

  it("can pick a second contact after the first, replacing the number", async () => {
    mockPick
      .mockResolvedValueOnce({ ok: true, contact: { name: "Joe Doe", number: "0788123456" } })
      .mockResolvedValueOnce({ ok: true, contact: { name: "Amy", number: "0722000111" } });
    await render(<Ekash />);
    const button = () => screen.getByRole("button", { name: "Choose from my phone's contacts" });
    await fireEvent.press(button());
    await waitFor(() => expect(screen.getByLabelText("Receiver's ID").props.value).toBe("0788123456"));
    await fireEvent.press(button());
    await waitFor(() => expect(screen.getByLabelText("Receiver's ID").props.value).toBe("0722000111"));
    expect(screen.getByLabelText("Name (optional)").props.value).toBe("Amy");
  });

  it("saves the receiver as a contact when asked, a bank account as an account", async () => {
    await render(<Ekash />);
    await fireEvent.changeText(screen.getByLabelText("Receiver's ID"), "00012345678");
    await fireEvent.changeText(screen.getByLabelText("Amount (RWF)"), "5000");
    await fireEvent.changeText(screen.getByLabelText("Name (optional)"), "My bank");
    await fireEvent.press(screen.getByRole("switch", { name: "Save as contact" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Pay with eKash" }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith({ name: "My bank", kind: "account", number: "00012345678", trusted: false }));
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalled());
  });

  it("needs a name to save, and doesn't dial until it has one", async () => {
    await render(<Ekash />);
    await fireEvent.changeText(screen.getByLabelText("Receiver's ID"), "0781234567");
    await fireEvent.changeText(screen.getByLabelText("Amount (RWF)"), "5000");
    await fireEvent.press(screen.getByRole("switch", { name: "Save as contact" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Pay with eKash" }));
    expect(await screen.findByText("Add a name to save this receiver, or turn saving off.")).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(Linking.openURL).not.toHaveBeenCalled();
  });
});
