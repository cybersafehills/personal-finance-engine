// The integration marketplace catalogue — a single static, typed list of
// every integration OneLedger has, real or dark. It is the source of truth
// for /integrations/marketplace and replaces the ad-hoc "Available later"
// array that used to live inline in /integrations/page.tsx.
//
// Pure and dependency-free (deno-tested from web/lib). It carries no gate
// logic and no live state: `status` is the *product* maturity, not whether
// this Space has it switched on. A `coming_soon` entry never has a
// `configHref` — the master-prompt rule that a non-functional integration
// must never look reachable is enforced here and asserted in the test.

export type MarketplaceCategory =
  | "import"
  | "export"
  | "destinations"
  | "workbooks"
  | "reconciliation"
  | "accounting"
  | "developer"
  | "connectors";

export type MarketplaceStatus = "available" | "beta" | "coming_soon";

export type MarketplaceEntry = {
  /** Stable slug, unique across the catalogue. */
  key: string;
  name: string;
  summary: string;
  category: MarketplaceCategory;
  status: MarketplaceStatus;
  /** Repo-relative docs path. Always present. */
  docHref: string;
  /** In-app surface that configures this, or null when there is nothing to open. */
  configHref: string | null;
};

export const MARKETPLACE_CATEGORY_META: Record<
  MarketplaceCategory,
  { label: string; order: number }
> = {
  import: { label: "Import", order: 1 },
  export: { label: "Export", order: 2 },
  destinations: { label: "Destinations", order: 3 },
  workbooks: { label: "Connected workbooks", order: 4 },
  reconciliation: { label: "Reconciliation & handoff", order: 5 },
  accounting: { label: "Accounting", order: 6 },
  developer: { label: "Developer platform", order: 7 },
  connectors: { label: "Inbound connectors", order: 8 },
};

export const MARKETPLACE_STATUS_META: Record<
  MarketplaceStatus,
  { label: string }
> = {
  available: { label: "Available" },
  beta: { label: "Beta" },
  coming_soon: { label: "Coming soon" },
};

export const MARKETPLACE_CATALOG: readonly MarketplaceEntry[] = [
  {
    key: "import-studio",
    name: "Import Studio",
    summary:
      "Upload a CSV or Excel statement, map its columns, review duplicates, and import into the ledger.",
    category: "import",
    status: "available",
    docHref: "docs/integrations-import-export-lifecycle.md",
    configHref: "/integrations/imports",
  },
  {
    key: "export-center",
    name: "Export Center",
    summary:
      "Export transactions, income, and expenses as a structured multi-sheet Excel workbook or CSV.",
    category: "export",
    status: "available",
    docHref: "docs/integrations-import-export-lifecycle.md",
    configHref: "/integrations/exports",
  },
  {
    key: "webhook-destination",
    name: "Webhook delivery",
    summary:
      "Deliver a signed JSON summary plus a short-lived download link to an https endpoint when an export completes.",
    category: "destinations",
    status: "available",
    docHref: "docs/integrations-destinations.md",
    configHref: "/integrations/sync",
  },
  {
    key: "cloud-storage-destination",
    name: "Cloud storage",
    summary:
      "Drop scheduled exports into a Google Drive, OneDrive, or Dropbox folder.",
    category: "destinations",
    status: "coming_soon",
    docHref: "docs/integrations-destinations.md",
    configHref: null,
  },
  {
    key: "connected-workbook",
    name: "Connected workbooks",
    summary:
      "Keep a Google Sheets or Excel-365 workbook in step with the ledger, with conflict review on the way back in.",
    category: "workbooks",
    status: "coming_soon",
    docHref: "docs/integrations-connected-workbooks.md",
    configHref: null,
  },
  {
    key: "manual-file-workbook",
    name: "Manual-file workbook",
    summary:
      "A downloadable workbook you re-upload — the real, no-OAuth path for the connected-workbook flow.",
    category: "workbooks",
    status: "beta",
    docHref: "docs/integrations-connected-workbooks.md",
    configHref: "/integrations/sync",
  },
  {
    key: "reconciliation-center",
    name: "Reconciliation Center",
    summary:
      "Balance drift, unmatched payments, possible duplicates, and sync conflicts in one hub.",
    category: "reconciliation",
    status: "available",
    docHref: "docs/integrations-reconciliation-center.md",
    configHref: "/integrations/reconciliation",
  },
  {
    key: "accountant-package",
    name: "Accountant package",
    summary:
      "A period-scoped ZIP — ledger export, reconciliation summary, and a PDF cover — ready to hand to an accountant.",
    category: "reconciliation",
    status: "available",
    docHref: "docs/integrations-accountant-package.md",
    configHref: "/integrations/accountant",
  },
  {
    key: "accounting-connectors",
    name: "QuickBooks · Xero · Zoho Books · Odoo",
    summary:
      "Push period ledger entries into an accounting system without re-keying. Export direction only.",
    category: "accounting",
    status: "coming_soon",
    docHref: "docs/integrations-accounting-connectors.md",
    configHref: null,
  },
  {
    key: "developer-api",
    name: "Developer REST API",
    summary:
      "Scoped, rate-limited, read-only /api/v1 access with reveal-once API keys.",
    category: "developer",
    status: "beta",
    docHref: "docs/integrations-developer-api.md",
    configHref: "/integrations/developer",
  },
  {
    key: "developer-webhooks",
    name: "Outbound webhooks",
    summary:
      "Subscribe an endpoint to export, accountant-package, and ledger-sync events with HMAC-signed delivery.",
    category: "developer",
    status: "beta",
    docHref: "docs/integrations-webhooks.md",
    configHref: "/integrations/developer",
  },
  {
    key: "momo-sms-connector",
    name: "MTN MoMo SMS",
    summary:
      "Forward mobile-money SMS from a paired device; each message becomes a reviewed ledger transaction.",
    category: "connectors",
    status: "available",
    docHref: "docs/integrations-connector-howto.md",
    configHref: "/integrations/connections",
  },
  {
    key: "connector-sdk",
    name: "Inbound connector SDK",
    summary:
      "The documented ConnectorAdapter contract plus a deno-tested reference adapter to copy.",
    category: "connectors",
    status: "beta",
    docHref: "docs/integrations-connector-sdk.md",
    configHref: null,
  },
];

export type MarketplaceGroup = {
  category: MarketplaceCategory;
  label: string;
  entries: MarketplaceEntry[];
};

/**
 * The catalogue grouped by category in display order. Categories with no
 * entries are omitted; entries keep catalogue order within a group.
 */
export function marketplaceByCategory(
  catalog: readonly MarketplaceEntry[] = MARKETPLACE_CATALOG,
): MarketplaceGroup[] {
  const groups = new Map<MarketplaceCategory, MarketplaceEntry[]>();
  for (const entry of catalog) {
    const bucket = groups.get(entry.category) ?? [];
    bucket.push(entry);
    groups.set(entry.category, bucket);
  }
  return [...groups.entries()]
    .map(([category, entries]) => ({
      category,
      label: MARKETPLACE_CATEGORY_META[category].label,
      entries,
    }))
    .sort(
      (a, b) =>
        MARKETPLACE_CATEGORY_META[a.category].order -
        MARKETPLACE_CATEGORY_META[b.category].order,
    );
}

/** Count of entries at each status, for a summary strip. */
export function marketplaceStatusCounts(
  catalog: readonly MarketplaceEntry[] = MARKETPLACE_CATALOG,
): Record<MarketplaceStatus, number> {
  const counts: Record<MarketplaceStatus, number> = {
    available: 0,
    beta: 0,
    coming_soon: 0,
  };
  for (const entry of catalog) counts[entry.status] += 1;
  return counts;
}
