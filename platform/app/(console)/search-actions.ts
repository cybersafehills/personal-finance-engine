"use server";

import { auditView, consoleRpc, requireSession } from "../../lib/console/access";
import { can } from "../../lib/console/permissions";

export type CustomerHit = { ref: string; id: string; name: string | null; status: string };

// Command-palette customer lookup. Same permission, MFA and masking as the
// Users directory (console_customer_directory); max 5 hits; short queries are
// rejected so the palette cannot be used to enumerate the directory.
export async function searchCustomers(query: string): Promise<CustomerHit[]> {
  const q = query.trim().slice(0, 60);
  if (q.length < 3) return [];
  const session = await requireSession();
  if (!can(session.access, "view_customer_metadata")) return [];
  // Same audited read as the Users page (one entry per lookup, no query text).
  await auditView(session, "customer_directory.viewed", "palette-search");
  const res = await consoleRpc<
    { id: string; customer_ref: string; display_name: string | null; status: string }[]
  >(session, "console_customer_directory", { p_search: q, p_limit: 5 });
  if (!res.ok) return [];
  return res.data.map((r) => ({ id: r.id, ref: r.customer_ref, name: r.display_name, status: r.status }));
}
