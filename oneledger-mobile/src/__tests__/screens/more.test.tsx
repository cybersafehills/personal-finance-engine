import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import More from "@/app/(app)/(tabs)/more";
import { resetRouterMock, router } from "@/test/router-mock";
const mockHealth = jest.fn();
const mockUnread = jest.fn();
const mockFlags = jest.fn();
const flags = { captureSupported: true };
jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/api/mobile-api", () => ({ fetchMoreFlags: () => mockFlags() }));
jest.mock("@/features/auth/SessionProvider", () => ({
  useSession: () => ({ session: { user: { email: "me@example.com" } }, signOut: jest.fn() }),
}));
jest.mock("@/features/capture/capture", () => ({
  get captureSupported() { return flags.captureSupported; },
  getCaptureHealth: () => mockHealth(),
}));
jest.mock("@/features/ios-shortcuts/IosStatusCard", () => ({
  IosStatusCard: ({ compact }: { compact?: boolean }) => {
    const { Text } = jest.requireActual("react-native");
    return <Text>{compact ? "IOS COMPACT STATUS" : "IOS STATUS CARD"}</Text>;
  },
}));
jest.mock("@/features/notifications/queries", () => ({ getUnreadNotificationCount: () => mockUnread() }));
beforeEach(() => {
  resetRouterMock();
  [mockFlags, mockHealth, mockUnread].forEach((m) => m.mockReset());
  flags.captureSupported = true;
  mockFlags.mockResolvedValue(null);
  mockHealth.mockResolvedValue({ state: "active" });
  mockUnread.mockResolvedValue(0);
});
describe("Option B More", () => {
  it("shows the real account and compact recording status", async () => {
    await render(<More />);
    expect(screen.getByText("me@example.com")).toBeTruthy();
    expect(await screen.findByText("Working")).toBeTruthy();
    expect(screen.queryByText("Sign out")).toBeNull();
  });
  it("keeps tools directly accessible without a category hub", async () => {
    await render(<More />);
    await screen.findByText("Working");
    for (const [label, path] of [["Wallets", "/wallets"], ["Categories", "/categories"], ["Automatic recording", "/capture"], ["Statements", "/statements"], ["Goals", "/goals"], ["Payment requests", "/requests"], ["Settings", "/settings"]] as const) {
      await fireEvent.press(screen.getByRole("link", { name: label }));
      expect(router.push).toHaveBeenLastCalledWith(path);
    }
    expect(screen.queryByText("Money tools")).toBeNull();
  });
  it("uses mobile group names", async () => {
    await render(<More />);
    for (const label of ["Money", "Documents", "Payments", "Account"]) expect(screen.getByRole("header", { name: label })).toBeTruthy();
  });
  it("opens the profile editor from the profile card", async () => {
    await render(<More />);
    await fireEvent.press(screen.getByRole("link", { name: "Your profile" }));
    expect(router.push).toHaveBeenCalledWith("/profile");
  });
  it("announces unread notifications and opens the inbox", async () => {
    mockUnread.mockResolvedValue(3);
    await render(<More />);
    await fireEvent.press(await screen.findByRole("link", { name: "Notifications, 3 unread" }));
    expect(router.push).toHaveBeenCalledWith("/notifications");
  });
  it("does not reveal disabled features, including through search", async () => {
    mockFlags.mockResolvedValue({ bills: false, statements: false, insights: false });
    await render(<More />);
    await waitFor(() => expect(screen.queryByText("Statements")).toBeNull());
    await fireEvent.changeText(screen.getByLabelText("Search tools"), "bills");
    expect(screen.queryByRole("link", { name: "Bills" })).toBeNull();
    expect(screen.getByText("No tools found")).toBeTruthy();
  });
  it("offers dark-by-default tools only when enabled", async () => {
    mockFlags.mockResolvedValue({ bills: true, assistedPay: true, ussdDirectory: true });
    await render(<More />);
    await fireEvent.press(await screen.findByRole("link", { name: "Bills" }));
    expect(router.push).toHaveBeenCalledWith("/bills");
    for (const label of ["Payment activity", "Payment templates", "USSD directory"]) expect(screen.getByRole("link", { name: label })).toBeTruthy();
  });
  it("searches existing tools and restores the list when cleared", async () => {
    await render(<More />);
    await fireEvent.changeText(screen.getByLabelText("Search tools"), "  wAlLeT  ");
    expect(screen.getByRole("link", { name: "Wallets" })).toBeTruthy();
    expect(screen.queryByText("Categories")).toBeNull();
    await fireEvent.press(screen.getByText("Wallets"));
    expect(router.push).toHaveBeenCalledWith("/wallets");
    await fireEvent.changeText(screen.getByLabelText("Search tools"), "");
    expect(screen.getByText("Categories")).toBeTruthy();
  });
  it("keeps the recording setup route when searching for it", async () => {
    mockHealth.mockResolvedValue({ state: "permission_required" });
    await render(<More />);
    await screen.findByText("Set it up");
    await fireEvent.changeText(screen.getByLabelText("Search tools"), "recording");
    await fireEvent.press(screen.getByRole("link", { name: "Automatic recording" }));
    expect(router.push).toHaveBeenCalledWith("/connect");
  });
  it("shows the compact iPhone row instead of the large setup card", async () => {
    flags.captureSupported = false;
    await render(<More />);
    expect(screen.getByText("IOS COMPACT STATUS")).toBeTruthy();
    expect(screen.queryByText("IOS STATUS CARD")).toBeNull();
  });
  it("keeps the recording entry reachable when status cannot load", async () => {
    mockHealth.mockRejectedValue(new Error("offline"));
    await render(<More />);
    await fireEvent.press(await screen.findByText("Check status"));
    expect(router.push).toHaveBeenCalledWith("/capture");
  });
});
