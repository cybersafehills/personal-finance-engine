import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AppState, Linking, Platform } from "react-native";

import Connect from "@/app/(app)/connect";
import type { CaptureHealth } from "@/features/capture/capture";
import { resetRouterMock, router, setParams } from "@/test/router-mock";

const mockHealth = jest.fn();
const mockPair = jest.fn();
const mockSendTest = jest.fn();
const mockOpenAccessSettings = jest.fn();
const mockListAccounts = jest.fn();
const mockConnectThisPhone = jest.fn();
const mockStore = new Map<string, string>();
const flags = { supported: true };

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/features/capture/capture", () => ({
  captureIsDemo: false,
  get captureSupported() {
    return flags.supported;
  },
  getCaptureHealth: () => mockHealth(),
  pairDevice: (input: string) => mockPair(input),
  sendCaptureTest: () => mockSendTest(),
  openNotificationAccessSettings: () => mockOpenAccessSettings(),
}));
jest.mock("@/features/pairing/pairing", () => ({
  listPairableAccounts: () => mockListAccounts(),
  connectThisPhone: (account: unknown) => mockConnectThisPhone(account),
}));
jest.mock("@/lib/device-store", () => ({
  deviceStore: {
    get: async (key: string) => mockStore.get(key) ?? null,
    set: async (key: string, value: string) => {
      mockStore.set(key, value);
    },
  },
}));
jest.mock("@/lib/config", () => ({ config: { apiBaseUrl: "https://app.example.test" } }));

const account = { id: "a1", name: "MTN MoMo", provider: "mtn_momo", workspaceId: "w1" };
const health = (over: Partial<CaptureHealth> = {}): CaptureHealth => ({
  state: "setup_required",
  detail: "Not connected yet.",
  paired: false,
  notificationAccessGranted: false,
  lastSuccessAtMs: 0,
  pendingCount: 0,
  deadCount: 0,
  ...over,
});

let appState: ((s: string) => void) | undefined;

beforeEach(() => {
  resetRouterMock();
  mockStore.clear();
  [mockHealth, mockPair, mockSendTest, mockOpenAccessSettings, mockListAccounts, mockConnectThisPhone].forEach((m) =>
    m.mockReset(),
  );
  flags.supported = true;
  mockHealth.mockResolvedValue(health());
  mockListAccounts.mockResolvedValue({ ok: true, accounts: [account] });
  appState = undefined;
  jest.spyOn(AppState, "addEventListener").mockImplementation(((_t: string, handler: (s: string) => void) => {
    appState = handler;
    return { remove: jest.fn() };
  }) as never);
  jest.spyOn(Linking, "openURL").mockResolvedValue(true as never);
  jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined as never);
});
afterEach(() => jest.restoreAllMocks());

async function acceptDisclosure() {
  await fireEvent.press(await screen.findByText("I agree, continue"));
}

describe("Connect wizard: disclosure and connecting", () => {
  it("starts with a plain disclosure of what is read, sent and kept", async () => {
    await render(<Connect />);
    expect(await screen.findByText("What it reads")).toBeTruthy();
    expect(screen.getByText("What is sent to OneLedger")).toBeTruthy();
    expect(screen.getByText("What stays on your phone")).toBeTruthy();
    expect(screen.getByText(/does not read your SMS inbox/)).toBeTruthy();
    // Nothing is connected or enabled before the person agrees.
    expect(mockConnectThisPhone).not.toHaveBeenCalled();
    expect(mockOpenAccessSettings).not.toHaveBeenCalled();
  });

  it("leaves without enabling anything when the person says not now", async () => {
    await render(<Connect />);
    await fireEvent.press(await screen.findByText("Not now"));
    expect(router.back).toHaveBeenCalled();
  });

  it("connects this phone to the chosen account, then moves on to allowing access", async () => {
    mockConnectThisPhone.mockResolvedValue({ ok: true });
    await render(<Connect />);
    await acceptDisclosure();

    expect(await screen.findByText("Which account do this phone's MoMo messages belong to?")).toBeTruthy();
    mockHealth.mockResolvedValue(health({ paired: true, state: "permission_required" }));
    await fireEvent.press(screen.getByText("Connect this phone"));

    await waitFor(() => expect(mockConnectThisPhone).toHaveBeenCalledWith(account));
    expect(await screen.findByText("Open notification settings")).toBeTruthy();
  });

  it("shows why connecting failed and stays on the step", async () => {
    mockConnectThisPhone.mockResolvedValue({ ok: false, message: "Couldn't reach OneLedger." });
    await render(<Connect />);
    await acceptDisclosure();
    await fireEvent.press(await screen.findByText("Connect this phone"));
    expect(await screen.findByText("Couldn't reach OneLedger.")).toBeTruthy();
    expect(screen.getByText("Connect this phone")).toBeTruthy();
  });

  it("explains when there is no MoMo account yet, with a way to add one on the web", async () => {
    mockListAccounts.mockResolvedValue({ ok: true, accounts: [] });
    await render(<Connect />);
    await acceptDisclosure();
    expect(await screen.findByText("No MTN MoMo account yet")).toBeTruthy();
    await fireEvent.press(screen.getByText("Open OneLedger on the web"));
    expect(Linking.openURL).toHaveBeenCalledWith("https://app.example.test/settings/accounts");
  });

  it("shows the reason when accounts cannot be loaded", async () => {
    mockListAccounts.mockResolvedValue({ ok: false, message: "Couldn't load your accounts. Try again." });
    await render(<Connect />);
    await acceptDisclosure();
    expect(await screen.findByText("Couldn't load your accounts. Try again.")).toBeTruthy();
  });
});

describe("Connect wizard: connecting with a code", () => {
  it("pairs with a pasted code, trimmed", async () => {
    mockPair.mockResolvedValue({ ok: true });
    await render(<Connect />);
    await acceptDisclosure();
    await fireEvent.press(await screen.findByText("I have a code from the web"));
    await fireEvent.changeText(screen.getByLabelText("Code from OneLedger on the web"), "  olp_abc123  ");
    await fireEvent.press(screen.getByText("Connect with this code"));
    await waitFor(() => expect(mockPair).toHaveBeenCalledWith("olp_abc123"));
  });

  it("asks for a code when the field is empty", async () => {
    await render(<Connect />);
    await acceptDisclosure();
    await fireEvent.press(await screen.findByText("I have a code from the web"));
    await fireEvent.press(screen.getByText("Connect with this code"));
    expect(await screen.findByText("Enter the code shown in OneLedger on the web.")).toBeTruthy();
    expect(mockPair).not.toHaveBeenCalled();
  });

  it("prefills the code from a link", async () => {
    setParams({ code: "olp_fromlink" });
    await render(<Connect />);
    await acceptDisclosure();
    const field = await screen.findByLabelText("Code from OneLedger on the web");
    expect(field.props.value).toBe("olp_fromlink");
  });

  it("shows the engine's reason when a code is refused", async () => {
    mockPair.mockResolvedValue({ ok: false, message: "That code has expired." });
    await render(<Connect />);
    await acceptDisclosure();
    await fireEvent.press(await screen.findByText("I have a code from the web"));
    await fireEvent.changeText(screen.getByLabelText("Code from OneLedger on the web"), "olp_old");
    await fireEvent.press(screen.getByText("Connect with this code"));
    expect(await screen.findByText("That code has expired.")).toBeTruthy();
  });
});

describe("Connect wizard: resuming from real state", () => {
  it("tells a disconnected phone to connect again", async () => {
    mockHealth.mockResolvedValue(health({ paired: true, state: "reauthentication_required" }));
    await render(<Connect />);
    await acceptDisclosure();
    expect(await screen.findByText(/This phone was disconnected from OneLedger/)).toBeTruthy();
  });

  it("walks through allowing notification access, with help for the greyed-out switch", async () => {
    mockHealth.mockResolvedValue(health({ paired: true, state: "permission_required" }));
    await render(<Connect />);

    await fireEvent.press(await screen.findByText("Open notification settings"));
    expect(mockOpenAccessSettings).toHaveBeenCalled();

    await fireEvent.press(screen.getByText("The switch is greyed out"));
    expect(screen.getByText(/Allow restricted settings/)).toBeTruthy();
    await fireEvent.press(screen.getByText("Open app settings"));
    expect(Linking.openSettings).toHaveBeenCalled();
  });

  it("re-checks when the person returns from system settings", async () => {
    mockHealth.mockResolvedValue(health({ paired: true, state: "permission_required" }));
    await render(<Connect />);
    await screen.findByText("Open notification settings");

    mockHealth.mockResolvedValue(health({ paired: true, notificationAccessGranted: true, state: "active" }));
    await act(async () => {
      appState!("active");
    });
    expect(await screen.findByText("Keep it running")).toBeTruthy();
  });

  it("finishes the battery step and remembers it was seen", async () => {
    mockHealth.mockResolvedValue(health({ paired: true, notificationAccessGranted: true, state: "active", detail: "Recording is working." }));
    await render(<Connect />);

    expect(await screen.findByText(/stop apps in the background to save battery/)).toBeTruthy();
    await fireEvent.press(screen.getByText("Done"));

    expect(await screen.findByText("Automatic recording is on")).toBeTruthy();
    expect(mockStore.get("connect.keepRunningSeen")).toBe("1");
    expect(screen.getByText("Recording is working.")).toBeTruthy();
  });

  it("lands straight on the finished state once everything is in place", async () => {
    mockStore.set("connect.keepRunningSeen", "1");
    mockHealth.mockResolvedValue(health({ paired: true, notificationAccessGranted: true, state: "active", detail: "All good." }));
    await render(<Connect />);
    expect(await screen.findByText("Automatic recording is on")).toBeTruthy();
    expect(screen.queryByText(/Step \d of/)).toBeNull();
  });
});

describe("Connect wizard: the finished state", () => {
  beforeEach(() => {
    mockStore.set("connect.keepRunningSeen", "1");
    mockHealth.mockResolvedValue(health({ paired: true, notificationAccessGranted: true, state: "active" }));
  });

  it("sends a test and confirms OneLedger received it", async () => {
    mockSendTest.mockResolvedValue("ok");
    await render(<Connect />);
    await fireEvent.press(await screen.findByText("Send a test"));
    expect(await screen.findByText("Test sent. OneLedger received it.")).toBeTruthy();
  });

  it("says plainly when the test did not get through", async () => {
    mockSendTest.mockResolvedValue("unreachable");
    await render(<Connect />);
    await fireEvent.press(await screen.findByText("Send a test"));
    expect(await screen.findByText("The test didn't get through. Check your connection and try again.")).toBeTruthy();
  });

  it("finishes", async () => {
    await render(<Connect />);
    await fireEvent.press(await screen.findByText("Finish"));
    expect(router.back).toHaveBeenCalled();
  });
});

describe("Connect wizard: where automatic recording is not available", () => {
  beforeEach(() => {
    flags.supported = false;
  });

  it("sends an iPhone to the Shortcuts guide", async () => {
    await render(<Connect />);
    expect(await screen.findByText("iPhone uses a Shortcut")).toBeTruthy();
    await fireEvent.press(screen.getByText("Set up on iPhone"));
    expect(router.replace).toHaveBeenCalledWith("/shortcuts");
  });

  it("explains it is not available on other devices", async () => {
    jest.replaceProperty(Platform, "OS", "web");
    await render(<Connect />);
    expect(await screen.findByText("Not available on this device")).toBeTruthy();
    expect(screen.queryByText("Set up on iPhone")).toBeNull();
  });
});
