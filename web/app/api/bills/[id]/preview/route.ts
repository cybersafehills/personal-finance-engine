import { NextRequest, NextResponse } from "next/server";
import { supabaseSession } from "../../../../../lib/supabase-session-server";
import { supabaseServer } from "../../../../../lib/supabase-server";
import { getActiveWorkspaceId } from "../../../../../lib/queries";
import { isBillsEnabled, billsSignedUrlTtlSeconds } from "../../../../../lib/bills/gate";
import { getBillDocumentById } from "../../../../../lib/bills/queries";
import { logBillError } from "../../../../../lib/bills/analytics";

// Signed-URL access to a bill document's rendered preview image, from the
// private "bill-derivatives" bucket. Shipped now so the review UI has a
// stable contract; in Phase 1 no previews are generated (that is Phase 2
// classification/rendering), so an existing, visible document with no
// preview_image artifact returns 409 `preview_not_ready` rather than 404.
//
// Optional ?page=N selects a page's preview (defaults to page 1).

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const workspaceId = await getActiveWorkspaceId();
  if (!isBillsEnabled(workspaceId)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // RLS confirms the caller may see this document at all.
  const doc = await getBillDocumentById(id);
  if (!doc) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const pageParam = Number(request.nextUrl.searchParams.get("page") ?? "1");
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;

  const session = await supabaseSession();
  const { data: artifact, error } = await session
    .from("bill_document_artifacts")
    .select("bucket, storage_path")
    .eq("bill_document_id", id)
    .eq("kind", "preview_image")
    .eq("page_number", page)
    .maybeSingle();

  if (error) {
    logBillError("signed_url", error);
    return NextResponse.json({ error: "failed to look up preview" }, { status: 500 });
  }
  if (!artifact) {
    return NextResponse.json({ error: "preview_not_ready" }, { status: 409 });
  }

  const admin = supabaseServer();
  const { data: signed, error: signError } = await admin.storage
    .from(artifact.bucket)
    .createSignedUrl(artifact.storage_path, billsSignedUrlTtlSeconds());

  if (signError || !signed) {
    logBillError("signed_url", signError);
    return NextResponse.json({ error: "failed to create preview link" }, { status: 500 });
  }

  return NextResponse.redirect(signed.signedUrl);
}
