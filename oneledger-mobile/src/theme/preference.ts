import { deviceStore } from "@/lib/device-store";

// The appearance setting. "system" follows the phone (and changes with it, even
// automatically at sunset); "light" and "dark" are the user's own choice. It is
// kept on this phone: it is about this screen, not about the account.

export type ThemePreference = "system" | "light" | "dark";
export type ColorScheme = "light" | "dark";

export const THEME_PREFERENCES: readonly { id: ThemePreference; label: string; description: string }[] = [
  { id: "system", label: "Automatic", description: "Match your phone's setting, including its automatic switch at night." },
  { id: "light", label: "Light", description: "Always use the light appearance." },
  { id: "dark", label: "Dark", description: "Always use the dark appearance." },
];

export const DEFAULT_PREFERENCE: ThemePreference = "system";

const KEY = "ol.theme.v1";

/** Anything stored (old, hand-edited, corrupt) becomes a valid setting. */
export function normalizePreference(raw: unknown): ThemePreference {
  return raw === "light" || raw === "dark" || raw === "system" ? raw : DEFAULT_PREFERENCE;
}

/** The scheme actually drawn: a forced choice wins; otherwise the phone's (light when it can't say). */
export function resolveScheme(preference: ThemePreference, system: ColorScheme | null | undefined): ColorScheme {
  if (preference === "light" || preference === "dark") return preference;
  return system === "dark" ? "dark" : "light";
}

export async function loadPreference(): Promise<ThemePreference> {
  try {
    const raw = await deviceStore.get(KEY);
    return raw ? normalizePreference(JSON.parse(raw)) : DEFAULT_PREFERENCE;
  } catch {
    return DEFAULT_PREFERENCE;
  }
}

export async function savePreference(preference: ThemePreference): Promise<void> {
  try {
    await deviceStore.set(KEY, JSON.stringify(preference));
  } catch {
    // Not saved: it still applies until the app closes.
  }
}
