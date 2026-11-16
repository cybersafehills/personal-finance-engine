import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import { LockScreen } from "@/features/lock/LockScreen";

const mockUnlock = jest.fn();
const mockSignOut = jest.fn();

jest.mock("@/features/lock/LockProvider", () => ({ useLock: () => ({ unlock: () => mockUnlock() }) }));
jest.mock("@/features/auth/SessionProvider", () => ({ useSession: () => ({ signOut: () => mockSignOut() }) }));

beforeEach(() => [mockUnlock, mockSignOut].forEach((m) => m.mockReset()));

describe("Lock screen", () => {
  it("asks the device to unlock as soon as it appears, once", async () => {
    mockUnlock.mockResolvedValue(true);
    const view = await render(<LockScreen mode="locked" />);
    await waitFor(() => expect(mockUnlock).toHaveBeenCalledTimes(1));
    await view.rerender(<LockScreen mode="locked" />);
    expect(mockUnlock).toHaveBeenCalledTimes(1);
  });

  it("says it is locked, then offers a retry when the check fails", async () => {
    mockUnlock.mockResolvedValue(false);
    await render(<LockScreen mode="locked" />);
    expect(await screen.findByText("Couldn't confirm it's you. Try again.")).toBeTruthy();

    mockUnlock.mockResolvedValue(true);
    await fireEvent.press(screen.getByText("Unlock"));
    await waitFor(() => expect(mockUnlock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("Couldn't confirm it's you. Try again.")).toBeNull());
  });

  it("lets the person sign out instead", async () => {
    mockUnlock.mockResolvedValue(false);
    await render(<LockScreen mode="locked" />);
    await fireEvent.press(await screen.findByText("Sign out"));
    expect(mockSignOut).toHaveBeenCalled();
  });

  it("covers the app in the app switcher with no controls and no prompt", async () => {
    await render(<LockScreen mode="cover" />);
    expect(screen.getByText("OneLedger")).toBeTruthy();
    expect(screen.queryByText("Unlock")).toBeNull();
    expect(screen.queryByText("Sign out")).toBeNull();
    expect(mockUnlock).not.toHaveBeenCalled();
  });
});
