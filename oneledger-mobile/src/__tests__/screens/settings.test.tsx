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

beforeEach(() => {
  resetRouterMock();
  (Linking.openURL as jest.Mock).mockReset();
  mockFlags.mockReset();
  mockFlags.mockResolvedValue({});
});

describe("Settings screen", () => {
  it("shows the web's groups", async () => {
    await render(<Settings />);
    for (const g of visibleSettingsGroups(null)) expect(screen.getByText(g.title)).toBeTruthy();
  });

  it("opens a native screen where the app has one", async () => {
    await render(<Settings />);
    await fireEvent.press(screen.getByRole("link", { name: "App lock" }));
    expect(router.push).toHaveBeenCalledWith("/security");
  });

  it("opens the web page for the rest", async () => {
    await render(<Settings />);
    await fireEvent.press(screen.getByRole("link", { name: "Profile & region" }));
    expect(Linking.openURL).toHaveBeenCalledWith("https://www.example.test/settings/profile");
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
