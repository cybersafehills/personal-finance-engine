import { NextRequest } from "next/server";

import { isBillsEnabled, billsSignedUrlTtlSeconds } from "../../../../../../lib/bills/gate";
import { logBillError } from "../../../../../../lib/bills/analytics";
import { isUuid } from "../../../../../../lib/mobile-pay";
import { MobileApiError, mobilePost, mobilePostOptions } from "../../../../../../lib/mobile-request";
import { getActiveWorkspaceId } from "../../../../../../lib/queries";
import { supabaseServer } from "../../../../../../lib/supabase-server";
import { supabaseSession } from "../../../../../../lib/supabase-session-server";

// POST /api/mobile/bills/:id/original - a fresh, short-lived signed URL for one
// document's immutable original, as JSON (the app fetches with a bearer token and
// then opens the URL). The web's /api/bills/:id/original does the same behind a
// cookie. It is a POST because asking is not read-only: record_bill_original_download
// writes an audit row and a journal event every time, exactly as the web does.
//
// That function checks workspace membership and bill.download_original for the
// document's OWN Space, not the Space the app is viewing, so this route first
// requires the document to be in the active Space (otherwise a document from
// another Space would open under this Space's gate). The URL lives minutes and
// must never be stored or logged. Own rate-limit bucket (POST: 20 a minute).

export const OPTIONS = mobilePostOptions;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return mobilePost(request, "bills-original", async () => {
    const workspaceId = await getActiveWorkspaceId();
    if (!workspaceId || !isBillsEnabled(workspaceId)) {
      throw new MobileApiError(404, "not_found", "Bills isn't available here.");
    }
    if (!isUuid(id)) throw new MobileApiError(404, "not_found", "That document wasn't found.");

    const session = await supabaseSession();
    const { data: inSpace, error: lookupError } = await session
      .from("bill_documents")
      .select("id")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (lookupError) throw new Error(`bill lookup failed: ${lookupError.message}`);
    if (!inSpace) throw new MobileApiError(404, "not_found", "That document wasn't found.");

    const { data: storageKey, error: gateError } = await session.rpc("record_bill_original_download", {
      p_bill_document_id: id,
    });
    if (gateError) {
      const msg = gateError.message.toLowerCase();
      if (msg.includes("not_found")) {
        throw new MobileApiError(404, "not_found", "That document wasn't found.");
      }
      if (msg.includes("not_authorized") || msg.includes("insufficient")) {
        throw new MobileApiError(403, "forbidden", "You don't have permission to open the original.");
      }
      logBillError("signed_url", gateError);
      throw new Error("could not prepare the original");
    }
    if (!storageKey || typeof storageKey !== "string") {
      throw new MobileApiError(404, "not_found", "That document wasn't found.");
    }

    const { data: signed, error: signError } = await supabaseServer()
      .storage.from("bill-documents")
      .createSignedUrl(storageKey, billsSignedUrlTtlSeconds());
    if (signError || !signed) {
      logBillError("signed_url", signError);
      throw new Error("could not create the download link");
    }
    return { download: { url: signed.signedUrl } };
  });
}
