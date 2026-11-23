// Runtime configuration. EXPO_PUBLIC_* values are inlined at build time and
// are public by design (the Supabase anon key is not a secret; Row Level
// Security is the boundary). Never put a service-role key or any other
// secret in an EXPO_PUBLIC_ variable.

export const config = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
  /** Origin of the OneLedger web app that serves /api/mobile/*. */
  apiBaseUrl: (process.env.EXPO_PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, ""),
  /** Apple-published combined release: one install for pairing and recording. */
  combinedShortcutUrl: process.env.EXPO_PUBLIC_COMBINED_SHORTCUT_URL ?? "https://www.icloud.com/shortcuts/d8ea3c4ec279424c9d08fe3512d350c9",
  /** Optional legacy two-shortcut configuration. Public iCloud links only. */
  connectShortcutUrl: process.env.EXPO_PUBLIC_MOMO_SHORTCUT_URL ?? "https://www.icloud.com/shortcuts/60d740e6248d400ab6bac9e1597eadf1",
  /** iCloud link for "OneLedger Capture", when it was shared separately. */
  captureShortcutUrl: process.env.EXPO_PUBLIC_MOMO_CAPTURE_SHORTCUT_URL ?? "https://www.icloud.com/shortcuts/d8ea3c4ec279424c9d08fe3512d350c9",
  /** Build-time kill switch for on-device storage and sync: set to "true" to ship a build that is online-only, as before. */
  offlineDisabled: process.env.EXPO_PUBLIC_OFFLINE_DISABLED === "true",
} as const;

export const isConfigured =
  config.supabaseUrl !== "" &&
  config.supabaseAnonKey !== "" &&
  config.apiBaseUrl !== "";
