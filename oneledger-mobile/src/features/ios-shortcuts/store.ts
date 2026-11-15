import { deviceStore } from "@/lib/device-store";

// Remembers which server-side device credential belongs to THIS iPhone's
// Shortcut, so the app can show its health later and reopen the guide where
// the user left off. The id is not a secret (the Shortcut holds the secret
// itself and the app never sees it); it is kept in the device store anyway.

const KEY = "oneledger.ios.deviceCredentialId";

export async function saveIosDeviceCredentialId(id: string): Promise<void> {
  try {
    await deviceStore.set(KEY, id);
  } catch {
    // Not remembered: the guide simply starts from the top next time.
  }
}

export async function loadIosDeviceCredentialId(): Promise<string | null> {
  try {
    return await deviceStore.get(KEY);
  } catch {
    return null;
  }
}

export async function clearIosDeviceCredentialId(): Promise<void> {
  try {
    await deviceStore.remove(KEY);
  } catch {
    // Nothing to clear.
  }
}
