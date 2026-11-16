import { Alert } from "react-native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import Capture from "@/app/(app)/capture";
import { resetRouterMock, router } from "@/test/router-mock";

const mockHealth = jest.fn();
const mockTest = jest.fn();
const mockDisconnect = jest.fn();
const flags = { supported: true };

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/features/capture/capture", () => ({
  get captureSupported() {
    return flags.supported;
  },
  getCaptureHealth: () => mockHealth(),
  sendCaptureTest: () => mockTest(),
  disconnectDevice: () => mockDisconnect(),
}));

const paired = {
  state: "active",
  detail: "Listening for MoMo messages.",
  paired: true,
  lastSuccessAtMs: 0,
  pendingCount: 2,
  deadCount: 1,
};

beforeEach(() => {
  resetRouterMock();
  [mockHealth, mockTest, mockDisconnect].forEach((m) => m.mockReset());
  flags.supported = true;
  mockHealth.mockResolvedValue(paired);
  mockTest.mockResolvedValue("ok");
  mockDisconnect.mockResolvedValue(undefined);
});

// The screen re-reads its health after an action; let that settle inside act.
async function settle() {
  await act(async () => {});
}

describe("Automatic recording screen", () => {
  it("shows the status and the counters", async () => {
    await render(<Capture />);
    expect(await screen.findByText("Working")).toBeTruthy();
    expect(screen.getByText("Listening for MoMo messages.")).toBeTruthy();
    expect(screen.getByText("Never")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("explains when the device cannot record automatically", async () => {
    flags.supported = false;
    await render(<Capture />);
    expect(await screen.findByText("Not available on this device")).toBeTruthy();
  });

  it("sends a test and shows the result", async () => {
    await render(<Capture />);
    const test = await screen.findByRole("button", { name: "Send a test" });
    await act(async () => {
      await fireEvent.press(test);
    });
    expect(await screen.findByText("Test sent. OneLedger received it.")).toBeTruthy();
    await settle();
  });

  it("tells the user to reconnect when the test says the phone was disconnected", async () => {
    mockTest.mockResolvedValue("reauthentication_required");
    await render(<Capture />);
    const test = await screen.findByRole("button", { name: "Send a test" });
    await act(async () => {
      await fireEvent.press(test);
    });
    expect(
      await screen.findByText("This phone was disconnected from OneLedger. Connect it again."),
    ).toBeTruthy();
    await settle();
  });

  it("offers setup when the phone is not connected, and hides the paired details", async () => {
    mockHealth.mockResolvedValue({ ...paired, state: "setup_required", paired: false });
    await render(<Capture />);
    await fireEvent.press(await screen.findByRole("button", { name: "Set it up" }));
    expect(router.push).toHaveBeenCalledWith("/connect");
    expect(screen.queryByText("Send a test")).toBeNull();
    expect(screen.queryByText("Disconnect this phone")).toBeNull();
  });

  it("offers a fix when notification access is missing", async () => {
    mockHealth.mockResolvedValue({ ...paired, state: "permission_required" });
    await render(<Capture />);
    await fireEvent.press(await screen.findByRole("button", { name: "Fix this" }));
    expect(router.push).toHaveBeenCalledWith("/connect");
  });

  it("offers to connect again after the phone was disconnected", async () => {
    mockHealth.mockResolvedValue({ ...paired, state: "reauthentication_required" });
    await render(<Capture />);
    await fireEvent.press(await screen.findByRole("button", { name: "Connect again" }));
    expect(router.push).toHaveBeenCalledWith("/connect");
  });

  it("asks before disconnecting, and disconnects only when confirmed", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await render(<Capture />);
    await fireEvent.press(await screen.findByRole("button", { name: "Disconnect this phone" }));
    expect(mockDisconnect).not.toHaveBeenCalled();

    const buttons = alert.mock.calls[0][2] ?? [];
    await act(async () => {
      await buttons.find((b) => b.text === "Disconnect")?.onPress?.();
    });
    await waitFor(() => expect(mockDisconnect).toHaveBeenCalledTimes(1));
    await settle();
    alert.mockRestore();
  });
});
