"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { getActiveWorkspaceId } from "../../../lib/queries";

export type NotificationPrefResult = { ok: true } | { ok: false; error: string };

const CHANNELS = ["in_app", "email"] as const;

function isChannel(v: string): v is (typeof CHANNELS)[number] {
  return (CHANNELS as readonly string[]).includes(v);
}

/**
 * Sets (or clears) one event/channel notification preference for the
 * caller in the active Space. Absence of a row means "use the default"
 * (see notification_default_enabled) - passing enabled === null deletes
 * the row to return to that. RLS
 * (space_member_notification_prefs_*_own) enforces that a member can only
 * touch their own rows in a Space they belong to.
 */
export async function setNotificationPreference(
  eventKey: string,
  channel: string,
  enabled: boolean | null,
): Promise<NotificationPrefResult> {
  if (!isChannel(channel)) {
    return { ok: false, error: "Unknown channel." };
  }
  if (!eventKey.trim()) {
    return { ok: false, error: "Missing event." };
  }

  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const workspaceId = await getActiveWorkspaceId();

  if (!user || !workspaceId) {
    return { ok: false, error: "Could not resolve your Space." };
  }

  if (enabled === null) {
    const { error } = await supabase
      .from("space_member_notification_prefs")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .eq("event_key", eventKey)
      .eq("channel", channel);
    if (error) return { ok: false, error: "Could not update your preferences." };
  } else {
    const { error } = await supabase
      .from("space_member_notification_prefs")
      .upsert(
        {
          workspace_id: workspaceId,
          user_id: user.id,
          event_key: eventKey,
          channel,
          enabled,
        },
        { onConflict: "workspace_id,user_id,event_key,channel" },
      );
    if (error) return { ok: false, error: "Could not update your preferences." };
  }

  revalidatePath("/settings/notifications");
  return { ok: true };
}
