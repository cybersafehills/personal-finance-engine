import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Appearance, Pressable, StyleSheet, Text, useColorScheme } from "react-native";

import { darkColors, lightColors } from "../colors";
import { makeStyles, ThemeProvider, useTheme } from "../ThemeProvider";

const mockStore = new Map<string, string>();
jest.mock("@/lib/device-store", () => ({
  deviceStore: {
    get: async (k: string) => mockStore.get(k) ?? null,
    set: async (k: string, v: string) => void mockStore.set(k, v),
    remove: async (k: string) => void mockStore.delete(k),
  },
}));
jest.mock("expo-status-bar", () => ({
  StatusBar: ({ style }: { style: string }) => {
    const { createElement } = jest.requireActual("react");
    const { Text: RNText } = jest.requireActual("react-native");
    return createElement(RNText, null, `statusbar:${style}`);
  },
}));
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({ __esModule: true, default: jest.fn() }));

const mockSystem = useColorScheme as unknown as jest.Mock;
const setScheme = jest.spyOn(Appearance, "setColorScheme").mockImplementation(() => {});

const useStyles = makeStyles((c) => StyleSheet.create({ box: { backgroundColor: c.surface, borderColor: c.accent } }));

function Probe() {
  const { preference, scheme, isDark, colors, setPreference } = useTheme();
  const styles = useStyles();
  return (
    <>
      <Text testID="state">{`${preference}|${scheme}|${isDark}|${colors.background}|${(StyleSheet.flatten(styles.box) as { backgroundColor: string }).backgroundColor}`}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="dark" onPress={() => setPreference("dark")} />
      <Pressable accessibilityRole="button" accessibilityLabel="system" onPress={() => setPreference("system")} />
    </>
  );
}

const state = () => String(screen.getByTestId("state").props.children);

beforeEach(() => {
  mockStore.clear();
  setScheme.mockClear();
  mockSystem.mockReturnValue("light");
});

describe("useTheme without a provider", () => {
  it("falls back to the light palette so nothing needs wrapping to render", async () => {
    await render(<Probe />);
    expect(state()).toBe(`system|light|false|${lightColors.background}|${lightColors.surface}`);
  });
});

describe("ThemeProvider", () => {
  it("follows the phone on Automatic, live", async () => {
    mockSystem.mockReturnValue("dark");
    const view = await render(<ThemeProvider initialPreference="system"><Probe /></ThemeProvider>);
    expect(state()).toBe(`system|dark|true|${darkColors.background}|${darkColors.surface}`);
    mockSystem.mockReturnValue("light");
    await view.rerender(<ThemeProvider initialPreference="system"><Probe /></ThemeProvider>);
    expect(state()).toContain("|light|false|");
  });

  it("applies a forced choice whatever the phone says, and styles follow it", async () => {
    mockSystem.mockReturnValue("light");
    await render(<ThemeProvider initialPreference="dark"><Probe /></ThemeProvider>);
    expect(state()).toBe(`dark|dark|true|${darkColors.background}|${darkColors.surface}`);
  });

  it("switches live, saves the choice and tells the phone", async () => {
    await render(<ThemeProvider initialPreference="system"><Probe /></ThemeProvider>);
    await fireEvent.press(screen.getByLabelText("dark"));
    expect(state()).toContain("dark|dark|true");
    expect(JSON.parse(mockStore.get("ol.theme.v1") as string)).toBe("dark");
    expect(setScheme).toHaveBeenLastCalledWith("dark");
    await fireEvent.press(screen.getByLabelText("system"));
    expect(setScheme).toHaveBeenLastCalledWith("unspecified");
  });

  it("restores the saved choice when the app starts", async () => {
    mockStore.set("ol.theme.v1", JSON.stringify("dark"));
    await render(<ThemeProvider><Probe /></ThemeProvider>);
    await waitFor(() => expect(state()).toContain("dark|dark|true"));
  });

  it("keeps the status bar readable: light icons on dark, dark icons on light", async () => {
    await render(<ThemeProvider initialPreference="dark"><Probe /></ThemeProvider>);
    expect(screen.getByText("statusbar:light")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("system"));
    await act(async () => {});
    expect(screen.getByText("statusbar:dark")).toBeTruthy();
  });
});

describe("makeStyles", () => {
  it("builds once per palette, not on every render", async () => {
    const factory = jest.fn((c: typeof lightColors) => StyleSheet.create({ a: { color: c.textPrimary } }));
    const useOnce = makeStyles(factory as never);
    function Uses() {
      useOnce();
      return null;
    }
    const view = await render(<Uses />);
    await view.rerender(<Uses />);
    await view.rerender(<Uses />);
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
