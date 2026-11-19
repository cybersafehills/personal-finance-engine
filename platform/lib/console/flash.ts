import { redirect } from "next/navigation";

// Server actions finish by redirecting with ?ok= / ?err= so the page can show
// the outcome without client state. Messages are plain text, never HTML.
export function back(path: string, kind: "ok" | "err", message: string): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}${kind}=${encodeURIComponent(message.slice(0, 200))}`);
}
