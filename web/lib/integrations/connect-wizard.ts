// The unified "connect a system" setup wizard (master prompt §8, gap
// analysis G2). Pure option catalogs + a resolver that turns a
// {source, direction, dataType} selection into a hand-off into the
// surface that already does the work — Import Studio, Export Center, or
// connected workbooks. The wizard is a router, not a re-implementation:
// steps 4-9 of §8 (file / map / validate / preview / confirm / done) are
// the existing flows.
//
// Availability is honest (master prompt §5/§6): an option that cannot
// operate today is `coming_soon` and never links anywhere live. Whether
// a live option actually shows is still decided by the page from the
// per-workspace gate flags — this module only says what is *possible*.

export const CONNECT_SOURCES = [
  "file",
  "google_sheets",
  "api",
  "webhook",
] as const;
export type ConnectSource = (typeof CONNECT_SOURCES)[number];

export const CONNECT_DIRECTIONS = ["import", "export", "two_way"] as const;
export type ConnectDirection = (typeof CONNECT_DIRECTIONS)[number];

export const CONNECT_DATA_TYPES = [
  "transactions",
  "expenses",
  "income",
  "invoices",
] as const;
export type ConnectDataType = (typeof CONNECT_DATA_TYPES)[number];

/** Ordered wizard steps; the hand-off follows the last one. */
export const CONNECT_STEPS = ["source", "direction", "data-type"] as const;
export type ConnectStep = (typeof CONNECT_STEPS)[number];

export function connectStepIndex(step: ConnectStep): number {
  return CONNECT_STEPS.indexOf(step);
}

export function isConnectStep(v: string): v is ConnectStep {
  return (CONNECT_STEPS as readonly string[]).includes(v);
}
export function isConnectSource(v: string): v is ConnectSource {
  return (CONNECT_SOURCES as readonly string[]).includes(v);
}
export function isConnectDirection(v: string): v is ConnectDirection {
  return (CONNECT_DIRECTIONS as readonly string[]).includes(v);
}
export function isConnectDataType(v: string): v is ConnectDataType {
  return (CONNECT_DATA_TYPES as readonly string[]).includes(v);
}

export type OptionStatus = "available" | "coming_soon";

export type SourceOption = {
  key: ConnectSource;
  name: string;
  blurb: string;
  status: OptionStatus;
  /** where the not-yet-built version is tracked, for a coming_soon row. */
  comingSoonHref?: string;
};

export const SOURCE_OPTIONS: SourceOption[] = [
  {
    key: "file",
    name: "Spreadsheet or CSV file",
    blurb: "Upload an Excel (.xlsx) or CSV file, or download a starter template.",
    status: "available",
  },
  {
    key: "google_sheets",
    name: "Google Sheets",
    blurb: "Live two-way sync with a Google Sheet.",
    status: "coming_soon",
    comingSoonHref: "/integrations/marketplace",
  },
  {
    key: "api",
    name: "API",
    blurb: "Pull from or push to another system over a REST API.",
    status: "coming_soon",
    comingSoonHref: "/integrations/marketplace",
  },
  {
    key: "webhook",
    name: "Webhook",
    blurb: "Receive events from another system as they happen.",
    status: "coming_soon",
    comingSoonHref: "/integrations/marketplace",
  },
];

export type DirectionOption = {
  key: ConnectDirection;
  name: string;
  blurb: string;
  /** the gate flag the page must confirm before showing this as live. */
  gate: "import" | "export" | "workbooks";
};

export const DIRECTION_OPTIONS: DirectionOption[] = [
  {
    key: "import",
    name: "Bring data into OneLedger",
    blurb: "Add records from your file to your ledger, after you review them.",
    gate: "import",
  },
  {
    key: "export",
    name: "Send data out of OneLedger",
    blurb: "Download your OneLedger data as a spreadsheet or CSV.",
    gate: "export",
  },
  {
    key: "two_way",
    name: "Keep a workbook in sync",
    blurb: "A connected workbook OneLedger writes to and reads changes back from.",
    gate: "workbooks",
  },
];

export type DataTypeOption = {
  key: ConnectDataType;
  name: string;
  blurb: string;
  status: OptionStatus;
};

/** Data types offered for the *import* direction. Export uses its own picker. */
export const IMPORT_DATA_TYPE_OPTIONS: DataTypeOption[] = [
  {
    key: "transactions",
    name: "Transactions",
    blurb: "Money in and out — sales, expenses, transfers, payments.",
    status: "available",
  },
  {
    key: "expenses",
    name: "Expenses",
    blurb: "An expense register — every row is money out, with a category.",
    status: "available",
  },
  {
    key: "income",
    name: "Income",
    blurb: "An income register — every row is money in, with a category.",
    status: "available",
  },
  {
    key: "invoices",
    name: "Invoices",
    blurb: "Issued invoices and their status.",
    status: "coming_soon",
  },
];

export type ConnectSelection = {
  source?: ConnectSource;
  direction?: ConnectDirection;
  dataType?: ConnectDataType;
};

export type ConnectResolution =
  | { ok: true; href: string; label: string; summary: string }
  | { ok: false; reason: string };

/**
 * Resolve a completed selection to the surface that carries out §8
 * steps 4-9. Only combinations that can operate today succeed; a
 * not-yet-supported pick returns a plain-language reason.
 */
export function resolveConnectHandoff(
  sel: ConnectSelection,
): ConnectResolution {
  if (sel.source && sel.source !== "file") {
    return {
      ok: false,
      reason: "That connection type isn’t available yet. See the Marketplace for what’s on the way.",
    };
  }
  if (!sel.source || !sel.direction) {
    return { ok: false, reason: "Choose a source and a direction first." };
  }

  if (sel.direction === "export") {
    return {
      ok: true,
      href: "/integrations/exports",
      label: "Set up the export",
      summary:
        "You’ll pick the data, period, and format in the Export Center, then download the file.",
    };
  }

  if (sel.direction === "two_way") {
    return {
      ok: true,
      href: "/integrations/sync",
      label: "Connect a workbook",
      summary:
        "You’ll link a workbook OneLedger keeps in sync, with conflicts held for review.",
    };
  }

  // import
  if (!sel.dataType) {
    return { ok: false, reason: "Choose what kind of data you’re importing." };
  }
  if (sel.dataType === "invoices") {
    return {
      ok: false,
      reason:
        "Importing invoices from a spreadsheet is coming later — for now, add them from an uploaded document under Bills.",
    };
  }
  const target = sel.dataType === "expenses"
    ? "expense"
    : sel.dataType === "income"
    ? "income"
    : null;
  return {
    ok: true,
    href: target
      ? `/integrations/imports/new?target=${target}`
      : "/integrations/imports/new",
    label: "Choose your file",
    summary: target === "expense"
      ? "You’ll upload an expense register — every row imports as money out, and a category is required. Review before anything enters your ledger."
      : target === "income"
      ? "You’ll upload an income register — every row imports as money in, and a category is required. Review before anything enters your ledger."
      : "You’ll upload a CSV or Excel file (or start from a template), map its columns, review duplicates, and confirm before anything enters your ledger.",
  };
}
