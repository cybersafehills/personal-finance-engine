// Runtime configuration. EXPO_PUBLIC_* values are inlined at build time and
// are public by design (the Supabase anon key is not a secret; Row Level
// Security is the boundary). Never put a service-role key or any other
// secret in an EXPO_PUBLIC_ variable.

export const config = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
  /** Origin of the OneLedger web app that serves /api/mobile/*. */
  apiBaseUrl: (process.env.EXPO_PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, ""),
  /** Published links verified in the live web setup on 2026-11-21. Build-time
   * overrides can replace or explicitly disable a link. iCloud link that adds the "Connect to OneLedger" Shortcut (may also
   *  carry "OneLedger Capture" when the two were shared as one link). */
  connectShortcutUrl: process.env.EXPO_PUBLIC_MOMO_SHORTCUT_URL ?? "https://www.oneledger.me/shortcuts/v2/Connect%20to%20OneLedger.shortcut",
  /** iCloud link for "OneLedger Capture", when it was shared separately. */
  captureShortcutUrl: process.env.EXPO_PUBLIC_MOMO_CAPTURE_SHORTCUT_URL ?? "https://www.oneledger.me/shortcuts/v2/OneLedger%20Capture.shortcut",
  /** Build-time kill switch for on-device storage and sync: set to "true" to ship a build that is online-only, as before. */
  offlineDisabled: process.env.EXPO_PUBLIC_OFFLINE_DISABLED === "true",
} as const;

export const isConfigured =
  config.supabaseUrl !== "" &&
  config.supabaseAnonKey !== "" &&
  config.apiBaseUrl !== "";
