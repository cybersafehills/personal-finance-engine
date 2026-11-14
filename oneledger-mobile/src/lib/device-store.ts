import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import type { KeyValueStore } from "./chunked-storage";

// The device's secret store: Keychain (iOS) / Keystore-backed encrypted
// prefs (Android) via expo-secure-store.
//
// Web has no secure store. The web build exists only as a development
// preview, so it falls back to localStorage there. Do not ship the web
// build to users with this fallback.
const webStore: KeyValueStore = {
  async get(key) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  async set(key, value) {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Storage unavailable (private window): the session just won't persist.
    }
  },
  async remove(key) {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // Nothing to remove.
    }
  },
};

const nativeStore: KeyValueStore = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) =>
    SecureStore.setItemAsync(key, value, {
      // Readable after the first unlock following a reboot, so a background
      // token refresh still works; never synced to other devices.
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    }),
  remove: (key) => SecureStore.deleteItemAsync(key),
};

export const deviceStore: KeyValueStore =
  Platform.OS === "web" ? webStore : nativeStore;
