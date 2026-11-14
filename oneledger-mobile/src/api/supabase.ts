import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";

import { createChunkedStorage } from "@/lib/chunked-storage";
import { config, isConfigured } from "@/lib/config";
import { deviceStore } from "@/lib/device-store";

// The app's Supabase client. Every query runs as the signed-in user under
// Row Level Security, exactly like the web's session client. The session is
// kept in the device's secure store, never in plain storage.
//
// null when the build has no EXPO_PUBLIC_* configuration, so screens can
// show a clear "not configured" state instead of crashing.
export const supabase: SupabaseClient | null = isConfigured
  ? createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        storage: createChunkedStorage(deviceStore),
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;

// Refresh tokens only while the app is in the foreground; timers do not run
// reliably in the background on a phone.
if (supabase && Platform.OS !== "web") {
  const client = supabase;
  AppState.addEventListener("change", (state) => {
    if (state === "active") client.auth.startAutoRefresh();
    else client.auth.stopAutoRefresh();
  });
}
