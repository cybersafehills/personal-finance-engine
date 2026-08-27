import { NextRequest, NextResponse } from "next/server";
import { getDirectoryAccess } from "../../../../../../lib/pay/directory-perms";
import { supabaseServer } from "../../../../../../lib/supabase-server";

// Short-lived signed download URL for one directory_evidence file. The
// bytes live in the private `directory-evidence` bucket (no
// authenticated/anon storage grants). The caller's directory.view_evidence
// permission is re-checked here against their own session - exactly the
// pattern app/api/reports/[id]/pdf/route.ts uses for report-artifacts.
const SIGNED_URL_TTL_SECONDS = 300;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const access = await getDirectoryAccess();
  if (!access.has("directory.view_evidence")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = supabaseServer();
  const { data: row, error } = await admin
    .from("directory_evidence")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("directory evidence: lookup failed", error.message);
    return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  }
  if (!row?.storage_path) {
    return NextResponse.json({ error: "no file attached" }, { status: 404 });
  }

  const { data: signed, error: signError } = await admin.storage
    .from("directory-evidence")
    .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS);

  if (signError || !signed) {
    console.error("directory evidence: signed URL failed", signError?.message);
    return NextResponse.json({ error: "failed to create download link" }, { status: 500 });
  }

  return NextResponse.redirect(signed.signedUrl);
}
