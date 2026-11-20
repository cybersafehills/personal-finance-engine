import { StatusBar } from "expo-status-bar";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Appearance, useColorScheme } from "react-native";

import { darkColors, lightPalette, type Palette } from "./colors";
import {
  DEFAULT_PREFERENCE,
  loadPreference,
  resolveScheme,
  savePreference,
  type ColorScheme,
  type ThemePreference,
} from "./preference";

// The theme: one provider at the root, two hooks for components.
//
//   const { colors } = useTheme();              // inline colours (icons, one-off styles)
//   const useStyles = makeStyles((c) => StyleSheet.create({ ... }));   // module scope
//   const styles = useStyles();                 // inside the component
//
// Components never import a palette. Without a provider (unit tests, previews) the
// light palette is used, so nothing needs wrapping to render.

export type Theme_ = {
  /** What the user chose. */
  preference: ThemePreference;
  /** What is drawn right now. */
  scheme: ColorScheme;
  isDark: boolean;
  colors: Palette;
  setPreference: (next: ThemePreference) => void;
};

const FALLBACK: Theme_ = {
  preference: DEFAULT_PREFERENCE,
  scheme: "light",
  isDark: false,
  colors: lightPalette,
  setPreference: () => {},
};

const ThemeContext = createContext<Theme_>(FALLBACK);

export function paletteFor(scheme: ColorScheme): Palette {
  return scheme === "dark" ? darkColors : lightPalette;
}

export function ThemeProvider({ children, initialPreference }: { children: ReactNode; initialPreference?: ThemePreference }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(initialPreference ?? DEFAULT_PREFERENCE);
  const system = useColorScheme();

  // The saved choice is read once. Until it arrives the phone's setting is used, so a
  // returning user on "Automatic" never sees a flash and the rest only a frame of it.
  useEffect(() => {
    if (initialPreference) return;
    let live = true;
    void loadPreference().then((p) => live && setPreferenceState(p));
    return () => {
      live = false;
    };
  }, [initialPreference]);

  const scheme = resolveScheme(preference, system);

  // Tell the phone too, so its own parts (keyboard, alerts, share sheet, scroll bars) match.
  // "unspecified" hands control back to the phone's setting.
  useEffect(() => {
    Appearance.setColorScheme(preference === "system" ? "unspecified" : preference);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    void savePreference(next);
  }, []);

  const value = useMemo<Theme_>(
    () => ({ preference, scheme, isDark: scheme === "dark", colors: paletteFor(scheme), setPreference }),
    [preference, scheme, setPreference],
  );

  return (
    <ThemeContext.Provider value={value}>
      <StatusBar style={value.isDark ? "light" : "dark"} />
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): Theme_ {
  return useContext(ThemeContext);
}

/**
 * Styles that depend on the palette. Declared once at module scope, like StyleSheet.create,
 * and built once per palette (not on every render).
 */
export function makeStyles<T extends object>(factory: (colors: Palette) => T): () => T {
  const cache = new Map<Palette, T>();
  return function useStyles(): T {
    const { colors } = useTheme();
    const cached = cache.get(colors);
    if (cached) return cached;
    const built = factory(colors);
    cache.set(colors, built);
    return built;
  };
}
