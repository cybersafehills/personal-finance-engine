import * as Linking from "expo-linking";
import { fireEvent, render, screen } from "@testing-library/react-native";

import Settings from "@/app/(app)/settings";
import { SETTINGS_GROUPS, visibleSettingsGroups } from "@/features/settings/groups";
import { resetRouterMock, router } from "@/test/router-mock";

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
const mockFlags = jest.fn();
jest.mock("@/api/mobile-api", () => ({ fetchMoreFlags: () => mockFlags() }));
jest.mock("expo-linking", () => ({ openURL: jest.fn() }));
jest.mock("@/lib/config", () => ({ config: { apiBaseUrl: "https://www.example.test" } }));

const mockSignOut = jest.fn();
const lockState = { loading: false, available: true, enabled: false };
jest.mock("@/features/lock/LockProvider", () => ({ useLock: () => lockState }));
jest.mock("@/features/auth/SessionProvider", () => ({ useSession: () => ({ session: { user: { email: "me@example.com" } }, signOut: () => mockSignOut() }) }));

beforeEach(() => {
  resetRouterMock();
  mockSignOut.mockReset();
  lockState.enabled = false;
  (Linking.openURL as jest.Mock).mockReset();
  mockFlags.mockReset();
  mockFlags.mockResolvedValue({});
});

describe("Settings screen", () => {
  it("requires confirmation before signing out and lets the person cancel", async () => {
    await render(<Settings />);
    await fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
    expect(mockSignOut).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(screen.queryByText("Sign out?")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
    await fireEvent.press(screen.getByRole("button", { name: "Sign out of OneLedger" }));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it("shows the actual appearance and app-lock values", async () => {
    lockState.enabled = true;
    await render(<Settings />);
    expect(screen.getByText("Automatic")).toBeTruthy();
    expect(screen.getByText("On")).toBeTruthy();
  });

  it("explains a failed browser launch", async () => {
    (Linking.openURL as jest.Mock).mockRejectedValueOnce(new Error("no browser"));
    await render(<Settings />);
    await fireEvent.press(screen.getByRole("link", { name: "Financial accounts" }));
    expect(await screen.findByText("Couldn't open your browser. Please try again.")).toBeTruthy();
  });

  it("shows compact mobile settings groups", async () => {
    await render(<Settings />);
    for (const g of visibleSettingsGroups(null)) expect(screen.getByText(g.title)).toBeTruthy();
  });

  it("opens a native screen where the app has one", async () => {
    await render(<Settings />);
    await fireEvent.press(screen.getByRole("link", { name: "App lock" }));
    expect(router.push).toHaveBeenCalledWith("/security");
  });

  it("opens the native profile editor", async () => {
    await render(<Settings />);
    await fireEvent.press(screen.getByRole("link", { name: "Profile & region" }));
    expect(router.push).toHaveBeenCalledWith("/profile");
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it("gives every row somewhere to go", () => {
    for (const g of SETTINGS_GROUPS) for (const r of g.rows) expect(Boolean(r.route) !== Boolean(r.webPath)).toBe(true);
  });

  it("hides dark features unless the server says they are on", async () => {
    await render(<Settings />);
    expect(screen.queryByText("Integrations")).toBeNull();
    expect(screen.queryByText("Developer platform")).toBeNull();
    expect(screen.queryByText("Account sharing")).toBeNull();
  });

  it("shows Integrations, Developer platform and Account sharing when on", async () => {
    mockFlags.mockResolvedValue({ integrations: true, developer: true, spaces: true });
    await render(<Settings />);
    await fireEvent.press(await screen.findByRole("link", { name: "Integrations" }));
    expect(Linking.openURL).toHaveBeenCalledWith("https://www.example.test/integrations");
    expect(screen.getByRole("link", { name: "Developer platform" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Account sharing" })).toBeTruthy();
  });
});
