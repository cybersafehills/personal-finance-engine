export type Currency = "RWF" | "EUR" | "USD";

export type StatementTotals = {
  currency: Currency;
  openingMinor: number | null;
  closingMinor: number | null;
  creditsMinor: number;
  debitsMinor: number;
  feesMinor: number;
  /** false = stored opening + movement does not reach the closing balance. */
  reconciles: boolean | null;
};

export type Statement = {
  id: string;
  reference: string;
  periodLabel: string;
  scopeLabel: string;
  typeLabel: string;
  status: "preparing" | "generating" | "ready" | "failed";
  transactionCount: number;
  generatedAt: string | null;
  isUpdatedVersion: boolean;
  warningCount: number;
  totals: StatementTotals[];
};

export type DownloadFormat = "pdf" | "csv";
