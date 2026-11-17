import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import More from "@/app/(app)/(tabs)/more";
import { resetRouterMock, router } from "@/test/router-mock";

const mockSignOut = jest.fn();
const mockHealth = jest.fn();
const mockUnread = jest.fn();
const mockIsPushEnabled = jest.fn();
const mockEnablePush = jest.fn();
const mockDisablePush = jest.fn();
const mockFlags = jest.fn();
const flags = { pushSupported: true, captureSupported: true };

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/api/mobile-api", () => ({ fetchMoreFlags: () => mockFlags() }));
jest.mock("@/features/auth/SessionProvider", () => ({
  useSession: () => ({
    session: { user: { email: "me@example.com" } },
    signOut: () => mockSignOut(),
  }),
}));
jest.mock("@/api/mobile-api", () => ({ fetchMoreFlags: () => mockFlags() }));
jest.mock("@/features/capture/capture", () => ({
  get captureSupported() {
    return flags.captureSupported;
  },
  getCaptureHealth: () => mockHealth(),
}));
jest.mock("@/features/ios-shortcuts/IosStatusCard", () => ({
  IosStatusCard: () => {
    const { Text } = jest.requireActual("react-native");
    return <Text>IPHONE STATUS CARD</Text>;
  },
}));
jest.mock("@/features/notifications/queries", () => ({
  getUnreadNotificationCount: () => mockUnread(),
}));
jest.mock("@/features/push/push", () => ({
  get pushSupported() {
    return flags.pushSupported;
  },
  isPushEnabled: () => mockIsPushEnabled(),
  enablePush: () => mockEnablePush(),
  disablePush: () => mockDisablePush(),
}));

beforeEach(() => {
  resetRouterMock();
  [mockFlags, mockSignOut, mockHealth, mockUnread, mockIsPushEnabled, mockEnablePush, mockDisablePush].forEach((m) => m.mockReset());
  flags.pushSupported = true;
  flags.captureSupported = true;
  mockFlags.mockResolvedValue(null);
  mockHealth.mockResolvedValue({ state: "active" });
  mockUnread.mockResolvedValue(0);
  mockIsPushEnabled.mockResolvedValue(false);
  mockEnablePush.mockResolvedValue({ ok: true });
  mockDisablePush.mockResolvedValue(undefined);
});

describe("More screen: Bills", () => {
  it("offers Bills only where the server says it is on for this Space", async () => {
    mockFlags.mockResolvedValue({ bills: true });
    await render(<More />);
    await fireEvent.press(await screen.findByText("Bills"));
    expect(router.push).toHaveBeenCalledWith("/bills");
  });

  it("hides Bills when the server cannot say", async () => {
    mockFlags.mockResolvedValue(null);
    await render(<More />);
    await waitFor(() => expect(mockFlags).toHaveBeenCalled());
    expect(screen.queryByText("Bills")).toBeNull();
  });

  it("hides Bills when it is off", async () => {
    await render(<More />);
    await waitFor(() => expect(mockFlags).toHaveBeenCalled());
    expect(screen.queryByText("Bills")).toBeNull();
  });
});

describe("More screen", () => {
  it("shows who is signed in and the recording status", async () => {
    await render(<More />);
    expect(screen.getByText("me@example.com")).toBeTruthy();
    expect(await screen.findByText("Working")).toBeTruthy();
  });

  it("opens each area", async () => {
    await render(<More />);
    await screen.findByText("Working");
    for (const [label, path] of [
      ["Recording status", "/capture"],
      ["See notifications", "/notifications"],
      ["Statements", "/statements"],
      ["Goals", "/goals"],
      ["Payment requests", "/requests"],
      ["App lock", "/security"],
    ] as const) {
      await fireEvent.press(screen.getByText(label));
      expect(router.push).toHaveBeenLastCalledWith(path);
    }
  });

  it("groups the destinations under the web's headings", async () => {
    await render(<More />);
    expect(await screen.findByText("Manage money")).toBeTruthy();
    expect(screen.getByText("Pay & Services")).toBeTruthy();
    expect(screen.getByText("Account")).toBeTruthy();
  });

  it("hides a feature the server says is off", async () => {
    mockFlags.mockResolvedValue({ statements: false, insights: true });
    await render(<More />);
    await screen.findByText("Insights");
    await waitFor(() => expect(screen.queryByText("Statements")).toBeNull());
  });

  it("offers to set up recording only when it needs it", async () => {
    mockHealth.mockResolvedValue({ state: "permission_required" });
    await render(<More />);
    await fireEvent.press(await screen.findByText("Set it up"));
    expect(router.push).toHaveBeenCalledWith("/connect");
  });

  it("shows no setup button when recording is working", async () => {
    await render(<More />);
    await screen.findByText("Working");
    expect(screen.queryByText("Set it up")).toBeNull();
  });

  it("shows the iPhone status card on iOS", async () => {
    await render(<More />);
    expect(await screen.findByText("IPHONE STATUS CARD")).toBeTruthy();
  });

  it("badges unread notifications", async () => {
    mockUnread.mockResolvedValue(3);
    await render(<More />);
    expect(await screen.findByText("3 new")).toBeTruthy();
  });

  it("turns phone alerts on, and shows why when that fails", async () => {
    await render(<More />);
    await fireEvent.press(await screen.findByText("Turn on phone alerts"));
    await waitFor(() => expect(mockEnablePush).toHaveBeenCalled());

    mockEnablePush.mockResolvedValue({ ok: false, message: "Phone alerts aren't set up in this version of the app yet." });
    await fireEvent.press(await screen.findByText("Turn on phone alerts"));
    expect(await screen.findByText("Phone alerts aren't set up in this version of the app yet.")).toBeTruthy();
  });

  it("turns phone alerts off when they are on", async () => {
    mockIsPushEnabled.mockResolvedValue(true);
    await render(<More />);
    await fireEvent.press(await screen.findByText("Turn off phone alerts"));
    await waitFor(() => expect(mockDisablePush).toHaveBeenCalled());
    expect(mockEnablePush).not.toHaveBeenCalled();
  });

  it("explains that alerts need a real phone when they are not supported", async () => {
    flags.pushSupported = false;
    await render(<More />);
    expect(await screen.findByText("Phone alerts need the app installed on a real phone.")).toBeTruthy();
    expect(screen.queryByText("Turn on phone alerts")).toBeNull();
  });

  it("signs out", async () => {
    await render(<More />);
    await fireEvent.press(screen.getByText("Sign out"));
    expect(mockSignOut).toHaveBeenCalled();
  });
});
