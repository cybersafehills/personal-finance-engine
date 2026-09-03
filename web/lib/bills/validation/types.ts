// Pure, dependency-free types for the deterministic validation engine
// (master prompt §9). No framework imports - Deno-testable.

export type Severity =
  | "info"
  | "warning"
  | "blocking"
  | "possible_duplicate"
  | "needs_specialist";

export type Finding = {
  /** Stable across runs - a reviewer / analytics can track one check. */
  ruleId: string;
  severity: Severity;
  title: string;
  /** Names the SPECIFIC inconsistency - never a vague "unusual data". */
  detail: string;
  affectedFields: string[];
  blocksApproval: boolean;
  suggestedAction: string | null;
};

export type ValidationField = {
  normalized: string | null;
  raw: string | null;
  currency: string | null;
  confidence: number | null;
  valueType: string;
};

export type ValidationLineItem = {
  lineTotalMinor: string | null;
  taxRate: string | null;
  currency: string | null;
};

export type ValidationPolicy = {
  supportedCurrencies: string[];
  /** Percent values as strings, e.g. ["18", "0"]. Empty = no expectation. */
  expectedTaxRates: string[];
  /** Logical required keys: supplier | issue_date | total | currency |
   *  subtotal | tax | document_number */
  requiredFields: string[];
  largeAmountThresholdMinor: string | null;
  largeAmountCurrency: string;
  dateToleranceDays: number;
};

export type ValidationContext = {
  docClass: string | null;
  fields: Record<string, ValidationField>;
  lineItems: ValidationLineItem[];
  policy: ValidationPolicy;
  /** ISO YYYY-MM-DD - "today" in the workspace's zone, supplied by the caller. */
  now: string;
};

export type ValidationResult = {
  status: "succeeded";
  findings: Finding[];
  blockingCount: number;
  warningCount: number;
  infoCount: number;
};

export const RULESET_VERSION = "bills-validate-v1";

/** Arithmetic tolerance in minor units - absorbs a single-unit rounding
 *  difference between the document's printed figures. */
export const ARITHMETIC_TOLERANCE_MINOR = 2n;
