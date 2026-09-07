// Starter register templates for the Import Studio (master prompt §13).
//
// A business owner downloads one of these as a ready-formatted CSV / XLSX,
// fills in their rows, and uploads it back. Because each template ships
// with the column mapping that produces it, an uploaded copy auto-maps:
// `/integrations/imports/[id]` matches the file's header row against these
// signatures (same `signatureSimilarity` + threshold as saved
// `import_templates`) before falling back to `suggestMapping`.
//
// Pure and dependency-light (only the mapping primitives + the CSV-safe
// writer, both pure), so it runs in a server component, the download
// route, and a unit test without `server-only`. The XLSX builder lives in
// the sibling `register-templates-workbook.ts` (server-only, exceljs).
//
// SCOPE: every template here commits as **transactions** — the only
// object the Import Studio creates today. An Invoice Register template
// arrives with multi-domain import (gap analysis G1).

import { csvDocument } from "./export/csv-safe.ts";
import {
  headerSignature,
  type ImportColumnMapping,
  signatureSimilarity,
  TEMPLATE_AUTO_APPLY_THRESHOLD,
} from "./mapping.ts";

export const REGISTER_TEMPLATE_KEYS = [
  "daily-sales",
  "expense",
  "cashbook",
] as const;
export type RegisterTemplateKey = (typeof REGISTER_TEMPLATE_KEYS)[number];

export function isRegisterTemplateKey(v: string): v is RegisterTemplateKey {
  return (REGISTER_TEMPLATE_KEYS as readonly string[]).includes(v);
}

export type RegisterTemplateColumn = {
  header: string;
  /** One line of guidance for whoever fills the sheet in. */
  hint: string;
  /** Value placed in the example row of the downloaded file. */
  sample: string;
  /** A row missing this cannot be imported. */
  required: boolean;
};

export type RegisterTemplate = {
  key: RegisterTemplateKey;
  name: string;
  summary: string;
  /** Plain-language description of what committing its rows creates. */
  creates: string;
  columns: RegisterTemplateColumn[];
  /** The mapping that turns a filled-in copy into canonical rows. */
  mapping: ImportColumnMapping;
  /** Extra example rows after the one built from `columns[].sample`. */
  extraSamples?: string[][];
};

const DMY: ImportColumnMapping["dateOrder"] = "dmy";

export const REGISTER_TEMPLATES: RegisterTemplate[] = [
  {
    key: "daily-sales",
    name: "Daily Sales Register",
    summary:
      "One row per sale or receipt. Every row is recorded as money coming in.",
    creates: "money-in transactions on the account you choose at import",
    columns: [
      {
        header: "Date",
        hint: "Day of the sale, e.g. 02/02/2026 (day/month/year).",
        sample: "02/02/2026",
        required: true,
      },
      {
        header: "Receipt Number",
        hint: "Your receipt / invoice number. Used to spot duplicates.",
        sample: "RCPT-1042",
        required: false,
      },
      {
        header: "Customer",
        hint: "Who paid you. Optional.",
        sample: "Jane Uwase",
        required: false,
      },
      {
        header: "Description",
        hint: "What was sold.",
        sample: "3x bottled water",
        required: false,
      },
      {
        header: "Amount",
        hint: "Total received, digits only (1500, not 1,500 or RWF 1500).",
        sample: "1500",
        required: true,
      },
      {
        header: "Payment Method",
        hint: "Cash, Card, Mobile Money… Kept for your reference; not imported.",
        sample: "Cash",
        required: false,
      },
      {
        header: "Branch",
        hint: "Location or till. Kept for your reference; not imported.",
        sample: "Kigali Heights",
        required: false,
      },
      {
        header: "Currency",
        hint: "3-letter code, e.g. RWF. Leave blank to use the Space default.",
        sample: "RWF",
        required: false,
      },
    ],
    mapping: {
      columns: {
        date: 0,
        external_reference: 1,
        merchant: 2,
        description: 3,
        amount_signed: 4,
        currency: 7,
      },
      amountMode: "all_in",
      directionMode: "from_amount",
      dateOrder: DMY,
      defaultCurrency: null,
    },
  },
  {
    key: "expense",
    name: "Expense Register",
    summary:
      "One row per expense or supplier payment. Every row is recorded as money going out.",
    creates: "money-out transactions on the account you choose at import",
    columns: [
      {
        header: "Date",
        hint: "Day of the expense, e.g. 02/02/2026 (day/month/year).",
        sample: "02/02/2026",
        required: true,
      },
      {
        header: "Supplier",
        hint: "Who you paid.",
        sample: "MTN Rwanda",
        required: false,
      },
      {
        header: "Description",
        hint: "What it was for.",
        sample: "Airtime for the sales team",
        required: false,
      },
      {
        header: "Category",
        hint: "Your expense category, e.g. Communications. Optional.",
        sample: "Communications",
        required: false,
      },
      {
        header: "Amount",
        hint: "Amount paid, digits only (10000, not 10,000).",
        sample: "10000",
        required: true,
      },
      {
        header: "Payment Method",
        hint: "Cash, Bank, Mobile Money… Kept for your reference; not imported.",
        sample: "Mobile Money",
        required: false,
      },
      {
        header: "Receipt Number",
        hint: "Supplier invoice / voucher number. Used to spot duplicates.",
        sample: "EXP-0231",
        required: false,
      },
      {
        header: "Currency",
        hint: "3-letter code, e.g. RWF. Leave blank to use the Space default.",
        sample: "RWF",
        required: false,
      },
    ],
    mapping: {
      columns: {
        date: 0,
        merchant: 1,
        description: 2,
        category: 3,
        amount_signed: 4,
        external_reference: 6,
        currency: 7,
      },
      amountMode: "all_out",
      directionMode: "from_amount",
      dateOrder: DMY,
      defaultCurrency: null,
    },
  },
  {
    key: "cashbook",
    name: "Cashbook",
    summary:
      "A running cash book: a Money In and a Money Out column, with an optional balance.",
    creates:
      "money-in transactions from the Money In column and money-out from Money Out",
    columns: [
      {
        header: "Date",
        hint: "Transaction day, e.g. 02/02/2026 (day/month/year).",
        sample: "02/02/2026",
        required: true,
      },
      {
        header: "Description",
        hint: "What the entry was.",
        sample: "Cash sale",
        required: false,
      },
      {
        header: "Reference",
        hint: "Voucher / receipt number. Used to spot duplicates.",
        sample: "RCPT-1042",
        required: false,
      },
      {
        header: "Money In",
        hint: "Amount received, digits only. Leave blank for a payment.",
        sample: "1500",
        required: false,
      },
      {
        header: "Money Out",
        hint: "Amount paid, digits only. Leave blank for a receipt.",
        sample: "",
        required: false,
      },
      {
        header: "Balance",
        hint: "Running balance after this row. Optional; kept for reference.",
        sample: "251500",
        required: false,
      },
      {
        header: "Currency",
        hint: "3-letter code, e.g. RWF. Leave blank to use the Space default.",
        sample: "RWF",
        required: false,
      },
    ],
    mapping: {
      columns: {
        date: 0,
        description: 1,
        external_reference: 2,
        inflow: 3,
        outflow: 4,
        balance: 5,
        currency: 6,
      },
      amountMode: "split",
      directionMode: "from_amount",
      dateOrder: DMY,
      defaultCurrency: null,
    },
    extraSamples: [
      ["01/02/2026", "Opening balance", "", "250000", "", "250000", "RWF"],
    ],
  },
];

export function getRegisterTemplate(key: RegisterTemplateKey): RegisterTemplate {
  const t = REGISTER_TEMPLATES.find((x) => x.key === key);
  if (!t) throw new Error(`unknown register template: ${key}`);
  return t;
}

export function registerTemplateHeaders(t: RegisterTemplate): string[] {
  return t.columns.map((c) => c.header);
}

/** The example row(s) that ship inside the downloaded file. */
export function registerTemplateSampleRows(t: RegisterTemplate): string[][] {
  return [t.columns.map((c) => c.sample), ...(t.extraSamples ?? [])];
}

export type BuildCsvOptions = { withSample?: boolean };

/** A ready-to-fill CSV: header row, then the example row unless suppressed. */
export function buildRegisterTemplateCsv(
  key: RegisterTemplateKey,
  { withSample = true }: BuildCsvOptions = {},
): string {
  const t = getRegisterTemplate(key);
  const rows = withSample ? registerTemplateSampleRows(t) : [];
  return csvDocument(registerTemplateHeaders(t), rows);
}

export type RegisterTemplateMatch = {
  template: RegisterTemplate;
  score: number;
};

/**
 * Best starter template for an uploaded file's header row, or null when
 * none clears `TEMPLATE_AUTO_APPLY_THRESHOLD`. The 8/8 vs 8/8 overlap for
 * a template's own headers is 1.0; Daily Sales vs Expense (5 shared of
 * ~11 union) is ~0.45, well under the bar, so the two never collide.
 */
export function matchRegisterTemplate(
  headers: string[],
): RegisterTemplateMatch | null {
  const sig = headerSignature(headers);
  if (sig.length === 0) return null;

  let best: RegisterTemplateMatch | null = null;
  for (const template of REGISTER_TEMPLATES) {
    const score = signatureSimilarity(
      sig,
      headerSignature(registerTemplateHeaders(template)),
    );
    if (!best || score > best.score) best = { template, score };
  }
  if (!best || best.score < TEMPLATE_AUTO_APPLY_THRESHOLD) return null;
  return best;
}
