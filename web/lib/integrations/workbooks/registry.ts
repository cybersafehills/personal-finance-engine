import "server-only";

import ExcelJS from "exceljs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseXlsx } from "../../xlsx-read.ts";
import { neutralizeFormula } from "../export/csv-safe.ts";
import {
  type SheetRows,
  type WorkbookAdapter,
  type WorkbookProvider,
  WorkbookProviderNotConfiguredError,
} from "./contract.ts";

const BUCKET = "integration-workbooks";
const SIGNED_URL_TTL = 600;

export function workbookStoragePath(
  workspaceId: string,
  workbookId: string,
): string {
  return `${workspaceId}/${workbookId}.xlsx`;
}

async function writeSheetsXlsx(sheets: SheetRows[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "OneLedger";
  wb.created = new Date();
  for (const sheet of sheets.length > 0 ? sheets : [{ name: "Sheet1", rows: [] }]) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31) || "Sheet");
    for (const row of sheet.rows) {
      ws.addRow(row.map((v) => neutralizeFormula(String(v ?? ""))));
    }
    if (sheet.rows.length > 0) {
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: "frozen", ySplit: 1 }];
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

function manualFileAdapter(
  admin: SupabaseClient,
  workspaceId: string,
  workbookId: string,
): WorkbookAdapter {
  const path = workbookStoragePath(workspaceId, workbookId);
  return {
    provider: "manual_file",
    async getRevision() {
      return null;
    },
    async writeAllSheets(_externalRef, sheets) {
      const bytes = await writeSheetsXlsx(sheets);
      const { error } = await admin.storage
        .from(BUCKET)
        .upload(path, bytes, {
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          upsert: true,
        });
      if (error) throw new Error(error.message);
      return { externalRef: path, revision: new Date().toISOString() };
    },
    async readAllSheets(externalRef) {
      const { data, error } = await admin.storage
        .from(BUCKET)
        .download(externalRef ?? path);
      if (error || !data) throw new Error(error?.message ?? "workbook not found");
      const parsed = await parseXlsx(new Uint8Array(await data.arrayBuffer()));
      return parsed.sheets.map((s) => ({
        name: s.name,
        rows: [s.headers, ...s.rows],
      }));
    },
  };
}

function stubAdapter(provider: WorkbookProvider): WorkbookAdapter {
  const fail = (): never => {
    throw new WorkbookProviderNotConfiguredError(provider);
  };
  return {
    provider,
    getRevision: fail,
    writeAllSheets: fail,
    readAllSheets: fail,
  };
}

export function getWorkbookAdapter(
  admin: SupabaseClient,
  params: {
    provider: WorkbookProvider;
    workspaceId: string;
    workbookId: string;
  },
): WorkbookAdapter {
  if (params.provider === "manual_file") {
    return manualFileAdapter(admin, params.workspaceId, params.workbookId);
  }
  return stubAdapter(params.provider);
}

export async function signWorkbookDownload(
  admin: SupabaseClient,
  storagePath: string,
): Promise<string | null> {
  const { data } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL);
  return data?.signedUrl ?? null;
}
