import { NextResponse } from "next/server";
import { getActiveWorkspaceId } from "../../../../../lib/queries";
import { supabaseSession } from "../../../../../lib/supabase-session-server";
import { supabaseServer } from "../../../../../lib/supabase-server";
import { isExportCenterEnabled } from "../../../../../lib/integrations/gate";

// Hand a finished export to the user as a short-lived signed URL and
// redirect to it - never a permanent public object. Session-authenticated
// via the app middleware; the export_jobs row is RLS-scoped, and we also
// require integration.export in the owning workspace.
const SIGNED_URL_TTL_SECONDS = 300;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const workspaceId = await getActiveWorkspaceId();
  if (!isExportCenterEnabled(workspaceId)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const supabase = await supabaseSession();
  const { data: job, error } = await supabase
    .from("export_jobs")
    .select("workspace_id, status, storage_path")
    .eq("id", id)
    .maybeSingle();
  if (error || !job) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (job.status !== "completed" || !job.storage_path) {
    return NextResponse.json({ error: "export not ready" }, { status: 409 });
  }

  const { data: allowed } = await supabase.rpc("has_space_capability", {
    p_workspace_id: job.workspace_id,
    p_capability: "integration.export",
  });
  if (allowed !== true) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = supabaseServer();
  const { data: signed, error: signError } = await admin.storage
    .from("integration-exports")
    .createSignedUrl(job.storage_path as string, SIGNED_URL_TTL_SECONDS);
  if (signError || !signed?.signedUrl) {
    console.error("export download: sign failed", signError?.message);
    return NextResponse.json({ error: "could not sign download" }, { status: 500 });
  }

  return NextResponse.redirect(signed.signedUrl);
}
