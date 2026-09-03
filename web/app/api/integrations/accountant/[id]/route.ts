import { NextResponse } from "next/server";
import { getActiveWorkspaceId } from "../../../../../lib/queries";
import { supabaseSession } from "../../../../../lib/supabase-session-server";
import { supabaseServer } from "../../../../../lib/supabase-server";
import { isAccountantPackageEnabled } from "../../../../../lib/integrations/gate";

// Hand a finished accountant package to the user as a short-lived signed
// URL and redirect to it - never a permanent public object. Session
// authenticated via the app middleware; the accountant_packages row is
// RLS-scoped, and we also require integration.accountant_package in the
// owning workspace.
const SIGNED_URL_TTL_SECONDS = 300;
const BUCKET = "integration-accountant-packages";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const workspaceId = await getActiveWorkspaceId();
  if (!isAccountantPackageEnabled(workspaceId)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const supabase = await supabaseSession();
  const { data: pkg, error } = await supabase
    .from("accountant_packages")
    .select("workspace_id, status, storage_path")
    .eq("id", id)
    .maybeSingle();
  if (error || !pkg) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (pkg.status !== "ready" || !pkg.storage_path) {
    return NextResponse.json({ error: "package not ready" }, { status: 409 });
  }

  const { data: allowed } = await supabase.rpc("has_space_capability", {
    p_workspace_id: pkg.workspace_id,
    p_capability: "integration.accountant_package",
  });
  if (allowed !== true) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = supabaseServer();
  const { data: signed, error: signError } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(pkg.storage_path as string, SIGNED_URL_TTL_SECONDS, {
      download: true,
    });
  if (signError || !signed?.signedUrl) {
    console.error("accountant download: sign failed", signError?.message);
    return NextResponse.json(
      { error: "could not sign download" },
      { status: 500 },
    );
  }

  return NextResponse.redirect(signed.signedUrl);
}
