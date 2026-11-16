import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import Mfa from "@/app/mfa";

const mockVerify = jest.fn();
const mockSignOut = jest.fn();
const mockRelease = jest.fn();

jest.mock("@/features/auth/SessionProvider", () => ({
  useSession: () => ({ verifyMfa: (c: string) => mockVerify(c), signOut: () => mockSignOut() }),
}));
jest.mock("@/features/lock/LockProvider", () => ({
  useLock: () => ({ releaseAfterSignIn: () => mockRelease() }),
}));

beforeEach(() => [mockVerify, mockSignOut, mockRelease].forEach((m) => m.mockReset()));

describe("Two-step verification screen", () => {
  it("verifies a 6-digit code and lifts the lock", async () => {
    mockVerify.mockResolvedValue({ ok: true });
    await render(<Mfa />);
    await fireEvent.changeText(screen.getByLabelText("Code"), "123456");
    await fireEvent.press(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => expect(mockVerify).toHaveBeenCalledWith("123456"));
    await waitFor(() => expect(mockRelease).toHaveBeenCalled());
  });

  it("accepts a code typed with spaces by keeping only the digits", async () => {
    mockVerify.mockResolvedValue({ ok: true });
    await render(<Mfa />);
    await fireEvent.changeText(screen.getByLabelText("Code"), "12 34 56");
    await fireEvent.press(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(mockVerify).toHaveBeenCalledWith("123456"));
  });

  it("refuses a code that is not six digits, without calling the server", async () => {
    await render(<Mfa />);
    await fireEvent.changeText(screen.getByLabelText("Code"), "123");
    await fireEvent.press(screen.getByRole("button", { name: "Verify" }));

    // The same sentence is also the screen's instruction, so match the alert.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Enter the 6-digit code from your authenticator app.");
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("shows why a wrong code failed and clears the field for another try", async () => {
    mockVerify.mockResolvedValue({ ok: false, message: "That code didn't match. Try again." });
    await render(<Mfa />);
    await fireEvent.changeText(screen.getByLabelText("Code"), "000000");
    await fireEvent.press(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByText("That code didn't match. Try again.")).toBeTruthy();
    expect(screen.getByLabelText("Code").props.value).toBe("");
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it("lets the person give up and sign out", async () => {
    await render(<Mfa />);
    await fireEvent.press(screen.getByText("Sign out"));
    expect(mockSignOut).toHaveBeenCalled();
  });
});
