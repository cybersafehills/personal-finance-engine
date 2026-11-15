import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { supabase } from "@/api/supabase";
import { deviceStore } from "@/lib/device-store";

import { isExpoPushToken } from "./push-routing";
import { pushFailureMessage } from "./push-errors";

// Push notifications (ADR 0019 section 8). The phone registers an Expo push
// token against the signed-in user; the server then pushes that user's
// unread in-app notifications to it. Permission is asked only when the
// user turns notifications on, never at launch.

const TOKEN_KEY = "push.token";

export type ActionResult = { ok: true } | { ok: false; message: string };

/** Real phones only: simulators, emulators and the web preview can't receive pushes. */
export const pushSupported = Platform.OS !== "web" && Device.isDevice;

/** Whether this install currently has a registered token. */
export async function isPushEnabled(): Promise<boolean> {
  return (await deviceStore.get(TOKEN_KEY)) !== null;
}

function projectId(): string | null {
  const id =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  return typeof id === "string" && id ? id : null;
}

async function register(token: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.rpc("register_push_device", {
    p_token: token,
    p_platform: Platform.OS === "ios" ? "ios" : "android",
  });
  return !error;
}

/** Asks for permission, gets this install's token and registers it. */
export async function enablePush(): Promise<ActionResult> {
  if (!pushSupported) {
    return { ok: false, message: "Notifications need a real phone." };
  }
  const id = projectId();
  if (!id) {
    return {
      ok: false,
      message: "Notifications aren't set up in this version of the app yet.",
    };
  }

  try {
    if (Platform.OS === "android") {
      // Android shows nothing without a channel; this is also the name the
      // user sees in system settings.
      await Notifications.setNotificationChannelAsync("default", {
        name: "OneLedger updates",
        // Exported through an `export *` the lint resolver can't follow;
        // TypeScript resolves and type-checks it.
        // eslint-disable-next-line import/namespace
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== "granted") {
      return {
        ok: false,
        message:
          "Notifications are blocked for OneLedger. Allow them in your phone's settings, then try again.",
      };
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId: id,
    });
    if (!isExpoPushToken(token) || !(await register(token))) {
      return { ok: false, message: "Couldn't turn notifications on. Try again." };
    }
    await deviceStore.set(TOKEN_KEY, token);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: pushFailureMessage(error) };
  }
}

/**
 * Removes this install's token from the server and forgets it locally.
 * Must run while still signed in (the server only deletes the caller's own
 * rows); best-effort, never throws.
 */
export async function disablePush(): Promise<void> {
  try {
    const token = await deviceStore.get(TOKEN_KEY);
    if (token && supabase) {
      await supabase.rpc("unregister_push_device", { p_token: token });
    }
  } catch {
    // The server disables a dead token itself when a push bounces.
  } finally {
    await deviceStore.remove(TOKEN_KEY);
  }
}

/**
 * On launch: if notifications are on, re-register so the server knows the
 * token is alive (and to pick up a rotated token). Silent; never prompts.
 */
export async function refreshPushRegistration(): Promise<void> {
  if (!pushSupported || !(await isPushEnabled())) return;
  const id = projectId();
  if (!id) return;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") return;
    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId: id,
    });
    if (isExpoPushToken(token) && (await register(token))) {
      await deviceStore.set(TOKEN_KEY, token);
    }
  } catch {
    // Try again next launch.
  }
}
