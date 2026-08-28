import { NextRequest, NextResponse } from "next/server";
import { supabaseSession } from "../../../../../lib/supabase-session-server";
import { supabaseServer } from "../../../../../lib/supabase-server";
import { getActiveWorkspaceId } from "../../../../../lib/queries";
import { isBillsEnabled, billsSignedUrlTtlSeconds } from "../../../../../lib/bills/gate";
import { logBillError } from "../../../../../lib/bills/analytics";

// Signed-URL download for one bill document's immutable original
// (master prompt §6/§27). Authenticated via the caller's own session:
// record_bill_original_download() (SECURITY DEFINER) verifies workspace
// membership AND the bill.download_original capability, writes the audit
// + journal rows, and hands back the storage_key. Only then does the
// service-role client mint a short-lived signed URL against the private
// "bill-documents" bucket. The browser never sees a permanent public URL
// and never queries the bucket directly - the same boundary the reports
// PDF route uses.

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const workspaceId = await getActiveWorkspaceId();
  if (!isBillsEnabled(workspaceId)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const session = await supabaseSession();
  const { data: storageKey, error: gateError } = await session.rpc(
    "record_bill_original_download",
    { p_bill_document_id: id },
  );

  if (gateError) {
    const msg = gateError.message.toLowerCase();
    if (msg.includes("not_found")) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (msg.includes("not_authorized") || msg.includes("insufficient")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    logBillError("signed_url", gateError);
    return NextResponse.json({ error: "failed to prepare download" }, { status: 500 });
  }

  if (!storageKey || typeof storageKey !== "string") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const admin = supabaseServer();
  const { data: signed, error: signError } = await admin.storage
    .from("bill-documents")
    .createSignedUrl(storageKey, billsSignedUrlTtlSeconds());

  if (signError || !signed) {
    logBillError("signed_url", signError);
    return NextResponse.json({ error: "failed to create download link" }, { status: 500 });
  }

  return NextResponse.redirect(signed.signedUrl);
}
