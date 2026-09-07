import { NextResponse } from "next/server";
import { getActiveWorkspaceId } from "../../../../../../lib/queries";
import { isImportStudioEnabled } from "../../../../../../lib/integrations/gate";
import {
  buildRegisterTemplateCsv,
  isRegisterTemplateKey,
} from "../../../../../../lib/integrations/register-templates";
import { buildRegisterTemplateXlsx } from "../../../../../../lib/integrations/register-templates-workbook";

// Download a blank starter register template (master prompt §13). The
// bytes are generated on the fly - no storage object, no capability
// beyond seeing the Import Studio. `?format=xlsx` for Excel (default
// csv); `?sample=0` drops the example row from the CSV.
//
// Session-authenticated via the app middleware; the Studio gate is the
// only authorization needed to download an empty form.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const workspaceId = await getActiveWorkspaceId();
  if (!isImportStudioEnabled(workspaceId)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!isRegisterTemplateKey(key)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const search = new URL(request.url).searchParams;
  const format = search.get("format") === "xlsx" ? "xlsx" : "csv";
  const filename = `oneledger-${key}-template.${format}`;
  const disposition = `attachment; filename="${filename}"`;

  if (format === "csv") {
    const body = buildRegisterTemplateCsv(key, {
      withSample: search.get("sample") !== "0",
    });
    return new NextResponse(body, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": disposition,
        "cache-control": "private, max-age=3600",
      },
    });
  }

  const XLSX_MIME =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const buffer = await buildRegisterTemplateXlsx(key);
  return new NextResponse(new Blob([buffer], { type: XLSX_MIME }), {
    status: 200,
    headers: {
      "content-type": XLSX_MIME,
      "content-disposition": disposition,
      "cache-control": "private, max-age=3600",
    },
  });
}
