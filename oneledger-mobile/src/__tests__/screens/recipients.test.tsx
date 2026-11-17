import { Alert } from "react-native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import Recipients from "@/app/(app)/recipients";
import { resetRouterMock } from "@/test/router-mock";

const mockList = jest.fn();
const mockCreate = jest.fn();
const mockTrust = jest.fn();
const mockDelete = jest.fn();

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/features/pay/recipients", () => ({
  getTrustedRecipients: () => mockList(),
  createTrustedRecipient: (i: unknown) => mockCreate(i),
  setRecipientTrust: (id: string, t: boolean) => mockTrust(id, t),
  deleteTrustedRecipient: (id: string) => mockDelete(id),
}));

const amy = { id: "r1", name: "Amy", kind: "phone", msisdn: "250781234567", merchantCode: null, trusted: false, relationship: null };

beforeEach(() => {
  resetRouterMock();
  [mockList, mockCreate, mockTrust, mockDelete].forEach((m) => m.mockReset());
  mockList.mockResolvedValue([amy]);
  mockCreate.mockResolvedValue(null);
  mockTrust.mockResolvedValue(true);
  mockDelete.mockResolvedValue(true);
});

describe("Saved recipients", () => {
  it("lists recipients with the whole number", async () => {
    await render(<Recipients />);
    expect(await screen.findByText("Amy")).toBeTruthy();
    expect(screen.getByText("078 123 4567")).toBeTruthy();
  });

  it("marks one as trusted", async () => {
    await render(<Recipients />);
    await fireEvent.press(await screen.findByRole("button", { name: "Mark as trusted: Amy" }));
    await waitFor(() => expect(mockTrust).toHaveBeenCalledWith("r1", true));
  });

  it("asks before removing, and removes only when confirmed", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await render(<Recipients />);
    await fireEvent.press(await screen.findByRole("button", { name: "Remove Amy" }));
    expect(mockDelete).not.toHaveBeenCalled();
    await act(async () => {
      await (alert.mock.calls[0][2] ?? []).find((b) => b.text === "Remove")?.onPress?.();
    });
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("r1"));
    alert.mockRestore();
  });

  it("adds a recipient", async () => {
    await render(<Recipients />);
    await fireEvent.press(await screen.findByRole("button", { name: "Add a recipient" }));
    await fireEvent.changeText(screen.getByLabelText("Name"), "Kigali Shop");
    await fireEvent.press(screen.getByRole("button", { name: "A merchant" }));
    await fireEvent.changeText(screen.getByLabelText("Merchant code"), "123456");
    await fireEvent.press(screen.getByRole("button", { name: "Save recipient" }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ name: "Kigali Shop", kind: "merchant", number: "123456", trusted: false })));
  });

  it("shows why a save was refused", async () => {
    mockCreate.mockResolvedValue("You've already saved this recipient.");
    await render(<Recipients />);
    await fireEvent.press(await screen.findByRole("button", { name: "Add a recipient" }));
    await fireEvent.press(screen.getByRole("button", { name: "Save recipient" }));
    expect(await screen.findByText("You've already saved this recipient.")).toBeTruthy();
  });

  it("shows an empty state", async () => {
    mockList.mockResolvedValue([]);
    await render(<Recipients />);
    expect(await screen.findByText("No saved recipients yet")).toBeTruthy();
  });
});
