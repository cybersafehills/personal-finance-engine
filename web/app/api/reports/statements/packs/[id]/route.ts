import { NextRequest, NextResponse } from "next/server";
import { isFinancialStatementsEnabled } from "../../../../../../lib/financial-statements";
import { supabaseSession } from "../../../../../../lib/supabase-session-server";
import { supabaseServer } from "../../../../../../lib/supabase-server";

// Download a Financial Pack ZIP. Ownership via the caller's session (RLS on
// statement_packs); the signed URL is issued with the service-role client
// because the bucket grants authenticated nothing. 300s, single-use-ish.
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
  const { data: pack, error } = await session
    .from("statement_packs")
    .select("id, pack_id, storage_path, status")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  }
  if (!pack) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (pack.status !== "ready" || !pack.storage_path) {
    return NextResponse.json({ error: "not ready" }, { status: 409 });
  }

  const admin = supabaseServer();
  const { data: signed, error: signError } = await admin.storage
    .from("statement-artifacts")
    .createSignedUrl(pack.storage_path, SIGNED_URL_TTL_SECONDS, {
      download: `OneLedger-Pack-${pack.pack_id}.zip`,
    });

  if (signError || !signed) {
    return NextResponse.json({ error: "failed to create download link" }, {
      status: 500,
    });
  }
  return NextResponse.redirect(signed.signedUrl);
}
