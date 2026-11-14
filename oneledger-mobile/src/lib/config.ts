// Runtime configuration. EXPO_PUBLIC_* values are inlined at build time and
// are public by design (the Supabase anon key is not a secret; Row Level
// Security is the boundary). Never put a service-role key or any other
// secret in an EXPO_PUBLIC_ variable.

export const config = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
  /** Origin of the OneLedger web app that serves /api/mobile/*. */
  apiBaseUrl: (process.env.EXPO_PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, ""),
} as const;

export const isConfigured =
  config.supabaseUrl !== "" &&
  config.supabaseAnonKey !== "" &&
  config.apiBaseUrl !== "";
