import { supabase } from "@/api/supabase";

// In-app notifications, the same rows the web's bell shows. Reads are
// scoped to the caller by RLS; marking read goes through the database's
// own-rows-only functions.

export type NotificationRow = {
  id: string;
  title: string;
  body: string | null;
  resourceType: string | null;
  resourceId: string | null;
  readAt: string | null;
  createdAt: string;
};

export async function getNotifications(limit = 50): Promise<NotificationRow[]> {
  if (!supabase) throw new Error("not configured");
  const { data, error } = await supabase
    .from("notifications")
    .select("id, title, body, resource_type, resource_id, read_at, created_at")
    .eq("channel", "in_app")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    body: (row.body as string | null) ?? null,
    resourceType: (row.resource_type as string | null) ?? null,
    resourceId: (row.resource_id as string | null) ?? null,
    readAt: (row.read_at as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

/** Unread count for the badge; 0 on any error (a badge must never block). */
export async function getUnreadNotificationCount(): Promise<number> {
  if (!supabase) return 0;
  const { data, error } = await supabase.rpc("unread_notification_count");
  return error ? 0 : Number(data ?? 0);
}

export async function markNotificationRead(id: string): Promise<void> {
  await supabase?.rpc("mark_notification_read", { p_id: id });
}

export async function markAllNotificationsRead(): Promise<void> {
  await supabase?.rpc("mark_all_notifications_read");
}
