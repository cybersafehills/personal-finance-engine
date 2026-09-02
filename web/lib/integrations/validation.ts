// Pure per-row validation for staged import records. Runs on the server
// as the authoritative gate before commit; the same function can drive a
// client-side preview count. Classifies every issue as blocking (row
// cannot be imported), warning (import but flag for review), or info.

import type { NormalizedImportRow } from "./mapping";
import type { ImportRecordStatus } from "./model";

export type IssueSeverity = "blocking" | "warning" | "info";

export type ValidationIssue = {
  severity: IssueSeverity;
  code: string;
  message: string;
};

export type RowValidation = {
  issues: ValidationIssue[];
  status: Extract<
    ImportRecordStatus,
    "ready" | "needs_review" | "invalid"
  >;
};

export type ValidationContext = {
  supportedCurrencies: string[];
  /** external_transaction_ids already seen earlier in the same batch. */
  seenExternalIds: Set<string>;
  now: Date;
};

const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000; // a day of clock skew
const OLD_YEARS = 6;

export function defaultValidationContext(
  overrides: Partial<ValidationContext> = {},
): ValidationContext {
  return {
    supportedCurrencies: ["RWF", "USD", "EUR", "GBP", "KES", "UGX", "TZS"],
    seenExternalIds: new Set(),
    now: new Date(),
    ...overrides,
  };
}

/**
 * Validate one already-normalized row. Mutates ctx.seenExternalIds so a
 * later duplicate id in the same batch is caught - call rows in order.
 */
export function validateNormalizedRow(
  row: NormalizedImportRow,
  ctx: ValidationContext,
): RowValidation {
  const issues: ValidationIssue[] = [];

  const occurred = Date.parse(row.occurred_at);
  if (Number.isNaN(occurred)) {
    issues.push({
      severity: "blocking",
      code: "date_invalid",
      message: "The date could not be read.",
    });
  } else {
    if (occurred > ctx.now.getTime() + FUTURE_TOLERANCE_MS) {
      issues.push({
        severity: "warning",
        code: "date_future",
        message: "This transaction is dated in the future.",
      });
    }
    const oldest = new Date(ctx.now);
    oldest.setFullYear(oldest.getFullYear() - OLD_YEARS);
    if (occurred < oldest.getTime()) {
      issues.push({
        severity: "info",
        code: "date_old",
        message: `This transaction is more than ${OLD_YEARS} years old.`,
      });
    }
  }

  if (!Number.isFinite(row.amount_minor) || row.amount_minor < 0) {
    issues.push({
      severity: "blocking",
      code: "amount_invalid",
      message: "The amount could not be read.",
    });
  } else if (row.amount_minor === 0) {
    issues.push({
      severity: "blocking",
      code: "amount_zero",
      message: "The amount is zero.",
    });
  }

  if (!["in", "out", "neutral"].includes(row.direction)) {
    issues.push({
      severity: "blocking",
      code: "direction_invalid",
      message: "The direction could not be determined.",
    });
  }

  if (row.currency && !ctx.supportedCurrencies.includes(row.currency)) {
    issues.push({
      severity: "warning",
      code: "currency_unsupported",
      message: `Currency "${row.currency}" is not one of the supported currencies.`,
    });
  }
  if (!row.currency) {
    issues.push({
      severity: "warning",
      code: "currency_missing",
      message: "No currency for this row; the Space default will be assumed.",
    });
  }

  const externalId = row.external_transaction_id?.trim();
  if (externalId) {
    if (ctx.seenExternalIds.has(externalId)) {
      issues.push({
        severity: "warning",
        code: "external_id_duplicate",
        message: "Another row in this file has the same transaction id.",
      });
    } else {
      ctx.seenExternalIds.add(externalId);
    }
  }

  if (!row.description && !row.merchant) {
    issues.push({
      severity: "info",
      code: "description_missing",
      message: "This row has no description or merchant.",
    });
  }

  let status: RowValidation["status"] = "ready";
  if (issues.some((i) => i.severity === "blocking")) status = "invalid";
  else if (issues.some((i) => i.severity === "warning")) status = "needs_review";

  return { issues, status };
}

export type BatchValidationCounts = {
  ready: number;
  needsReview: number;
  invalid: number;
};

export function tallyValidation(
  statuses: RowValidation["status"][],
): BatchValidationCounts {
  return {
    ready: statuses.filter((s) => s === "ready").length,
    needsReview: statuses.filter((s) => s === "needs_review").length,
    invalid: statuses.filter((s) => s === "invalid").length,
  };
}
