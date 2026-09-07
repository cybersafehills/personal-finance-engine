import "server-only";

import ExcelJS from "exceljs";
import { neutralizeFormula } from "./export/csv-safe.ts";
import {
  getRegisterTemplate,
  type RegisterTemplateKey,
  registerTemplateHeaders,
  registerTemplateSampleRows,
} from "./register-templates.ts";

// The XLSX form of a starter register template: one data sheet (frozen
// bold header + an example row) plus a "How to fill this in" sheet. Same
// exceljs + formula-neutralisation conventions as `export/workbook.ts`;
// server-only so exceljs never reaches the browser bundle.

export async function buildRegisterTemplateXlsx(
  key: RegisterTemplateKey,
): Promise<ArrayBuffer> {
  const template = getRegisterTemplate(key);
  const headers = registerTemplateHeaders(template);

  const wb = new ExcelJS.Workbook();
  wb.creator = "OneLedger";
  wb.created = new Date();

  const data = wb.addWorksheet(template.name.slice(0, 31));
  data.addRow(headers);
  data.getRow(1).font = { bold: true };
  data.views = [{ state: "frozen", ySplit: 1 }];
  for (const row of registerTemplateSampleRows(template)) {
    data.addRow(row.map((v) => neutralizeFormula(v)));
  }
  headers.forEach((h, i) => {
    data.getColumn(i + 1).width = Math.min(32, Math.max(12, h.length + 2));
  });

  const notes = wb.addWorksheet("How to fill this in");
  notes.addRow(["Column", "What to put here", "Required?"]);
  notes.getRow(1).font = { bold: true };
  for (const c of template.columns) {
    notes.addRow([
      neutralizeFormula(c.header),
      neutralizeFormula(c.hint),
      c.required ? "Yes" : "Optional",
    ]);
  }
  notes.addRow([]);
  notes.addRow(["", `Rows import as: ${template.creates}`, ""]);
  notes.addRow([
    "",
    "Keep the header row exactly as it is so OneLedger recognises the columns.",
    "",
  ]);
  notes.addRow([
    "",
    "The example row is just a guide — delete it, or skip it during review.",
    "",
  ]);
  notes.getColumn(1).width = 20;
  notes.getColumn(2).width = 64;
  notes.getColumn(3).width = 12;

  const buffer = await wb.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}
