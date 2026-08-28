import "server-only";
import type { supabaseServer } from "../supabase-server";
import { getResendClient } from "../resend";
import { siteUrl } from "../site-url";
import { logBillError } from "./analytics";

// Bills & Expenses notifications (master prompt §23). Deliberately
// minimal and privacy-conscious: the email says only that a document is
// ready for review and links to it - never the supplier, amount, or any
// OCR text. OPT-IN via BILLS_NOTIFICATIONS_ENABLED (off unless exactly
// "true"), and best-effort: a failed send is logged, never thrown.
//
// De-duplication is a marker on bill_documents.metadata
// (review_notified), set by the worker after the first send, so a
// re-run tick doesn't re-notify.

type Admin = ReturnType<typeof supabaseServer>;

function enabled(): boolean {
  return process.env.BILLS_NOTIFICATIONS_ENABLED === "true";
}

/** Email every workspace member who can review bills that a document is
 *  waiting. Returns the number of recipients notified (0 if disabled,
 *  already notified, or nothing to send). */
export async function notifyBillReadyForReview(
  admin: Admin,
  billDocumentId: string,
  workspaceId: string,
): Promise<number> {
  if (!enabled()) return 0;
  const client = getResendClient();
  const from = process.env.RESEND_FROM_EMAIL;
  if (!client || !from) return 0;

  try {
    const { data: doc } = await admin
      .from("bill_documents")
      .select("metadata, sanitized_filename")
      .eq("id", billDocumentId)
      .maybeSingle();
    const metadata = (doc?.metadata as Record<string, unknown> | null) ?? {};
    if (metadata.review_notified) return 0;

    // Owners/admins always hold bill.review; plus any member granted it.
    const [{ data: members }, { data: grants }] = await Promise.all([
      admin
        .from("workspace_memberships")
        .select("user_id, role")
        .eq("workspace_id", workspaceId)
        .eq("status", "active"),
      admin
        .from("space_member_capability_grants")
        .select("user_id")
        .eq("workspace_id", workspaceId)
        .eq("capability", "bill.review"),
    ]);

    const grantedIds = new Set((grants ?? []).map((g: { user_id: string }) => g.user_id));
    const recipientIds = new Set<string>();
    for (const m of (members ?? []) as Array<{ user_id: string; role: string }>) {
      if (m.role === "owner" || m.role === "admin" || grantedIds.has(m.user_id)) {
        recipientIds.add(m.user_id);
      }
    }
    if (recipientIds.size === 0) return 0;

    // Resolve emails.
    const { data: userList } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const emailById = new Map(
      (userList?.users ?? [])
        .filter((u) => u.email)
        .map((u) => [u.id, u.email as string]),
    );

    const url = `${siteUrl()}/bills/${billDocumentId}`;
    let sent = 0;
    for (const id of recipientIds) {
      const to = emailById.get(id);
      if (!to) continue;
      try {
        const { error } = await client.emails.send({
          from,
          to,
          subject: "A document is ready for review",
          html:
            `<p>A document is waiting for review in OneLedger.</p>` +
            `<p><a href="${url}">Open it</a></p>` +
            `<p style="color:#888;font-size:12px">No document details are included in this email.</p>`,
          text: `A document is waiting for review in OneLedger.\nOpen it: ${url}`,
        });
        if (!error) sent += 1;
      } catch (err) {
        logBillError("record", err);
      }
    }

    await admin
      .from("bill_documents")
      .update({ metadata: { ...metadata, review_notified: true } })
      .eq("id", billDocumentId);

    return sent;
  } catch (err) {
    logBillError("record", err);
    return 0;
  }
}
