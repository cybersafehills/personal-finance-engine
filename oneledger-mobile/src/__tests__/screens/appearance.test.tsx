import { fireEvent, render, screen } from "@testing-library/react-native";

import Appearance from "@/app/(app)/appearance";
import { ThemeProvider } from "@/theme/ThemeProvider";

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("expo-status-bar", () => ({ StatusBar: () => null }));
const mockStore = new Map<string, string>();
jest.mock("@/lib/device-store", () => ({
  deviceStore: { get: async (k: string) => mockStore.get(k) ?? null, set: async (k: string, v: string) => void mockStore.set(k, v), remove: async () => {} },
}));

beforeEach(() => mockStore.clear());

describe("Appearance screen", () => {
  it("offers Automatic, Light and Dark, with the current one marked", async () => {
    await render(<ThemeProvider initialPreference="system"><Appearance /></ThemeProvider>);
    expect(screen.getByLabelText("Automatic, selected")).toBeTruthy();
    expect(screen.getByLabelText("Light")).toBeTruthy();
    expect(screen.getByLabelText("Dark")).toBeTruthy();
  });

  it("switches and shows what is now drawn", async () => {
    await render(<ThemeProvider initialPreference="light"><Appearance /></ThemeProvider>);
    expect(screen.getByLabelText("Preview, showing the light appearance")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Dark"));
    expect(screen.getByLabelText("Dark, selected")).toBeTruthy();
    expect(screen.getByLabelText("Preview, showing the dark appearance")).toBeTruthy();
  });
});
