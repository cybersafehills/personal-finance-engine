import { NextResponse } from "next/server";
import { getActiveWorkspaceId } from "../../../../../lib/queries";
import { supabaseSession } from "../../../../../lib/supabase-session-server";
import { supabaseServer } from "../../../../../lib/supabase-server";
import { isWorkbooksEnabled } from "../../../../../lib/integrations/gate";
import { signWorkbookDownload } from "../../../../../lib/integrations/workbooks/registry";

// Download the current `manual_file` workbook as a short-lived signed URL.
// Session-authenticated via the app middleware; the connected_workbooks
// row is RLS-scoped to integration.view.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const workspaceId = await getActiveWorkspaceId();
  if (!isWorkbooksEnabled(workspaceId)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const supabase = await supabaseSession();
  const { data: workbook, error } = await supabase
    .from("connected_workbooks")
    .select("external_ref, status")
    .eq("id", id)
    .maybeSingle();
  if (error || !workbook || !workbook.external_ref) {
    return NextResponse.json({ error: "no file yet" }, { status: 404 });
  }

  const signed = await signWorkbookDownload(
    supabaseServer(),
    workbook.external_ref as string,
  );
  if (!signed) {
    return NextResponse.json({ error: "could not sign download" }, { status: 500 });
  }
  return NextResponse.redirect(signed);
}
