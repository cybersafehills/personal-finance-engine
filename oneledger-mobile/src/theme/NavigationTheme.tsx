import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from "expo-router";
import type { ReactNode } from "react";

import type { Palette } from "./colors";
import type { ColorScheme } from "./preference";
import { useTheme } from "./ThemeProvider";

// Hands the palette to the navigator, so what the app doesn't draw itself (native
// headers, back buttons, sheet backgrounds, the screen behind a transition) matches.

export function navigationColors(scheme: ColorScheme, colors: Palette) {
  const base = scheme === "dark" ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.accent,
      background: colors.background,
      card: colors.surface,
      text: colors.textPrimary,
      border: colors.borderSubtle,
      notification: colors.notificationBadge,
    },
  };
}

export function NavigationTheme({ children }: { children: ReactNode }) {
  const { scheme, colors } = useTheme();
  return <NavigationThemeProvider value={navigationColors(scheme, colors)}>{children}</NavigationThemeProvider>;
}
