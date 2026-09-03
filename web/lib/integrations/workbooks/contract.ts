// Connected-workbook contract. Pure - types + the sheet-map vocabulary
// only. The registry that builds adapters (and the manual_file adapter's
// storage IO) is server-only.

import { WORKBOOK_DATASETS, type WorkbookDataset } from "../destinations/model.ts";

export const WORKBOOK_PROVIDERS = [
  "manual_file",
  "google_sheets",
  "excel_365",
] as const;
export type WorkbookProvider = (typeof WORKBOOK_PROVIDERS)[number];

export const WORKBOOK_PROVIDER_LABEL: Record<WorkbookProvider, string> = {
  manual_file: "Stored file (.xlsx)",
  google_sheets: "Google Sheets",
  excel_365: "Excel 365",
};

/** The one provider that works with no external account. */
export function isRealWorkbookProvider(p: WorkbookProvider): boolean {
  return p === "manual_file";
}

export type SheetRows = { name: string; rows: string[][] };

export type WorkbookAdapter = {
  provider: WorkbookProvider;
  /** An opaque revision/etag for change detection, or null if unsupported. */
  getRevision(externalRef: string | null): Promise<string | null>;
  /** Replace the whole workbook contents. Returns the new revision. */
  writeAllSheets(
    externalRef: string | null,
    sheets: SheetRows[],
  ): Promise<{ externalRef: string; revision: string | null }>;
  /** Read every sheet back (used for import / two-way). */
  readAllSheets(externalRef: string | null): Promise<SheetRows[]>;
};

export class WorkbookProviderNotConfiguredError extends Error {
  code = "provider_not_configured";
  constructor(public provider: string) {
    super(`Workbook provider "${provider}" is not available on this deployment.`);
    this.name = "WorkbookProviderNotConfiguredError";
  }
}

const DEFAULT_SHEET_NAMES: Record<WorkbookDataset, string> = {
  transactions: "Transactions",
  income: "Income",
  expenses: "Expenses",
  categories: "Categories",
  accounts: "Accounts",
};

export function defaultSheetMap(): Record<WorkbookDataset, string> {
  return { ...DEFAULT_SHEET_NAMES };
}

/** Keep only known datasets mapped to non-empty sheet names. */
export function normalizeSheetMap(
  input: unknown,
): Partial<Record<WorkbookDataset, string>> {
  const out: Partial<Record<WorkbookDataset, string>> = {};
  if (!input || typeof input !== "object") return defaultSheetMap();
  const rec = input as Record<string, unknown>;
  for (const dataset of WORKBOOK_DATASETS) {
    const name = rec[dataset];
    if (typeof name === "string" && name.trim() && name.trim().length <= 60) {
      out[dataset] = name.trim();
    }
  }
  return Object.keys(out).length > 0 ? out : defaultSheetMap();
}
