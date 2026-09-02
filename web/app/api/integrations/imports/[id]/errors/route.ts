import { NextResponse } from "next/server";
import { getActiveWorkspaceId } from "../../../../../../lib/queries";
import { isImportStudioEnabled } from "../../../../../../lib/integrations/gate";
import { getImportBatch } from "../../../../../../lib/integrations/queries";

// Download the rows that could not be imported, as CSV, so the user can
// fix them in their spreadsheet and re-upload. Session-authenticated via
// the app middleware; getImportBatch is RLS-scoped. Values are prefixed
// with a quote when they could be read as a spreadsheet formula
// (=, +, -, @) - CSV-injection defence, formalised further in PR 5.

function safeCell(value: string): string {
  const v = value ?? "";
  const needsGuard = /^[=+\-@\t\r]/.test(v);
  const escaped = (needsGuard ? `'${v}` : v).replace(/"/g, '""');
  return `"${escaped}"`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const workspaceId = await getActiveWorkspaceId();
  if (!isImportStudioEnabled(workspaceId)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const result = await getImportBatch(id);
  if (!result) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const headers =
    ((result.batch.detected as { headers?: string[] }).headers as string[]) ?? [];
  const invalid = result.records.filter((r) => r.status === "invalid");

  const lines: string[] = [];
  lines.push([...headers, "Why it failed"].map(safeCell).join(","));
  for (const record of invalid) {
    const cells = (record.rawCells.cells as string[] | undefined) ?? [];
    const issues = (record.validation as { issues?: { message: string }[] }).issues;
    const reason = Array.isArray(issues)
      ? issues.map((i) => i.message).join("; ")
      : "Could not be read with the current mapping.";
    lines.push(
      [...headers.map((_, i) => cells[i] ?? ""), reason].map(safeCell).join(","),
    );
  }

  return new NextResponse(lines.join("\r\n"), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="import-${id}-errors.csv"`,
    },
  });
}
