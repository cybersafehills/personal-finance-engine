import { redirect } from "next/navigation";

// Connections moved under the Integrations area. This permanent redirect
// keeps old links, bookmarks, and any missed internal reference working.
export default function ConnectionsMovedPage() {
  redirect("/integrations/connections");
}
