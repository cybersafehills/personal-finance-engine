import { NextRequest, NextResponse } from "next/server";
import { isFinancialStatementsEnabled } from "../../../../../../lib/financial-statements";
import { supabaseSession } from "../../../../../../lib/supabase-session-server";
import { supabaseServer } from "../../../../../../lib/supabase-server";

// Download an uploaded provider-original statement. Ownership is the
// caller's session (provider_statements grants authenticated SELECT, RLS
// scopes it to their workspace); the signed URL is issued with the
// service-role client because the "provider-statements" bucket grants
// authenticated nothing. Short TTL, forced attachment.
const SIGNED_URL_TTL_SECONDS = 300;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isFinancialStatementsEnabled()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const { id } = await params;

  const session = await supabaseSession();
  const { data: row, error } = await session
    .from("provider_statements")
    .select("id, storage_path, original_filename")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const admin = supabaseServer();
  const { data: signed, error: signError } = await admin.storage
    .from("provider-statements")
    .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS, {
      download: row.original_filename || "provider-statement",
    });

  if (signError || !signed) {
    return NextResponse.json({ error: "failed to create download link" }, {
      status: 500,
    });
  }
  return NextResponse.redirect(signed.signedUrl);
}
