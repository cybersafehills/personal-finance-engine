import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import Security from "@/app/(app)/security";
import { resetRouterMock } from "@/test/router-mock";

const mockSetEnabled = jest.fn();
const lockState = { available: true, enabled: false };

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/features/lock/LockProvider", () => ({
  useLock: () => ({ ...lockState, setEnabled: (next: boolean) => mockSetEnabled(next) }),
}));

beforeEach(() => {
  resetRouterMock();
  mockSetEnabled.mockReset();
  lockState.available = true;
  lockState.enabled = false;
});

describe("Security screen", () => {
  it("turns the app lock on", async () => {
    mockSetEnabled.mockResolvedValue(true);
    await render(<Security />);
    await fireEvent(screen.getByLabelText("App lock"), "valueChange", true);
    await waitFor(() => expect(mockSetEnabled).toHaveBeenCalledWith(true));
    expect(screen.queryByText(/nothing was changed/)).toBeNull();
  });

  it("says nothing was changed when the person could not be confirmed", async () => {
    mockSetEnabled.mockResolvedValue(false);
    await render(<Security />);
    await fireEvent(screen.getByLabelText("App lock"), "valueChange", true);
    expect(await screen.findByText("Couldn't confirm it's you, so nothing was changed.")).toBeTruthy();
  });

  it("turns the lock off, through the same switch", async () => {
    lockState.enabled = true;
    mockSetEnabled.mockResolvedValue(true);
    await render(<Security />);
    await fireEvent(screen.getByLabelText("App lock"), "valueChange", false);
    await waitFor(() => expect(mockSetEnabled).toHaveBeenCalledWith(false));
  });

  it("disables the switch and explains when the phone has no biometrics or passcode", async () => {
    lockState.available = false;
    await render(<Security />);
    expect(screen.getByLabelText("App lock").props.disabled).toBe(true);
    expect(screen.getByText(/needs a fingerprint, face or passcode/)).toBeTruthy();
  });

  it("reassures that recording continues while locked", async () => {
    await render(<Security />);
    expect(screen.getByText("Recording your MoMo messages keeps working while the app is locked.")).toBeTruthy();
  });
});
