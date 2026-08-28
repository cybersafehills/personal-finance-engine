"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../lib/supabase-session-server";

export type NotificationActionResult =
  | { ok: true; count?: number }
  | { ok: false; error: string };

function revalidateNotificationRoutes() {
  revalidatePath("/notifications");
  // The header bell's unread count is fetched in the root layout.
  revalidatePath("/", "layout");
}

export async function markNotificationRead(
  id: string,
): Promise<NotificationActionResult> {
  const supabase = await supabaseSession();
  const { error } = await supabase.rpc("mark_notification_read", { p_id: id });
  if (error) {
    return { ok: false, error: "Could not update that notification." };
  }
  revalidateNotificationRoutes();
  return { ok: true };
}

export async function markAllNotificationsRead(): Promise<NotificationActionResult> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase.rpc("mark_all_notifications_read", {});
  if (error) {
    return { ok: false, error: "Could not mark everything read." };
  }
  revalidateNotificationRoutes();
  return { ok: true, count: Number(data ?? 0) };
}
