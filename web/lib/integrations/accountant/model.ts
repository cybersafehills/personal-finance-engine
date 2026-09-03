// Pure types + vocabularies for the "Ready for Accountant" package
// (Integrations Phase 3, migration 20261118000000). No server-only import -
// reusable on the client and unit-testable.

export const ACCOUNTANT_PACKAGE_STATUSES = [
  "queued",
  "building",
  "ready",
  "failed",
] as const;
export type AccountantPackageStatus =
  (typeof ACCOUNTANT_PACKAGE_STATUSES)[number];

/** The file kinds a package ZIP can carry. */
export const ACCOUNTANT_PACKAGE_FORMATS = ["csv", "xlsx", "pdf"] as const;
export type AccountantPackageFormat =
  (typeof ACCOUNTANT_PACKAGE_FORMATS)[number];

/**
 * Redacted rollup stored on the row and shown in the UI. Never carries raw
 * financial text, counterparties, or ids - only counts and labels.
 */
export type AccountantPackageManifest = {
  periodLabel?: string;
  transactionCount?: number;
  sections?: string[];
  reconciliation?: {
    openItems?: number;
    balanceMismatches?: number;
  };
  generatedAt?: string;
};

export type AccountantPackage = {
  id: string;
  workspaceId: string;
  createdBy: string | null;
  periodStart: string;
  periodEnd: string;
  status: AccountantPackageStatus;
  formats: AccountantPackageFormat[];
  storagePath: string | null;
  manifest: AccountantPackageManifest;
  rowCount: number | null;
  byteSize: number | null;
  error: Record<string, unknown> | null;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** True once a package build has reached a terminal state. */
export function isAccountantPackageFinished(
  status: AccountantPackageStatus,
): boolean {
  return status === "ready" || status === "failed";
}

/** True when the package has a downloadable artifact. */
export function isAccountantPackageDownloadable(
  pkg: Pick<AccountantPackage, "status" | "storagePath">,
): boolean {
  return pkg.status === "ready" && pkg.storagePath !== null;
}
