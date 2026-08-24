import { getBudgetActuals, getBudgetById } from "../../../../lib/queries";
import { isSupportedCurrency, toMajorUnits } from "../../../../lib/money";

/** Formats a plain SQL date ("2026-08-01") as "Aug 1, 2026" without any timezone shift - duplicated from components/BudgetStatusBadge.tsx rather than imported, so this route handler doesn't pull a React component tree into its server bundle for one date-formatting function. */
function formatCalendarDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

const ALLOCATION_LABELS: Record<string, string> = {
  ESSENTIALS: "Essentials",
  INVESTING: "Investing",
  EMERGENCY: "Emergency savings",
  WANTS: "Wants",
};

const STATUS_LABELS: Record<string, string> = {
  healthy: "Healthy",
  watch: "Watch",
  at_risk: "At risk",
  exceeded: "Exceeded",
  insufficient_data: "Insufficient data",
};

/** Quotes a CSV field only when it contains a comma, quote, or newline - matches RFC 4180's minimal-quoting convention. */
function csvField(value: string | number): string {
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function csvRow(fields: (string | number)[]): string {
  return fields.map(csvField).join(",") + "\r\n";
}

/**
 * Generates a CSV export of a single budget's period, targets, and
 * actuals. Values here are computed from the exact same getBudgetActuals()
 * call the budget detail page renders from, so an exported figure always
 * matches what the page displayed for it at generation time - see the
 * product spec's own "exported values must match the application's
 * displayed values" requirement.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const budget = await getBudgetById(id);

  if (!budget || !isSupportedCurrency(budget.currency)) {
    return new Response("Budget not found", { status: 404 });
  }

  const currency = budget.currency;
  const actuals = await getBudgetActuals(budget);

  let csv = "";
  csv += csvRow(["Budget", budget.name]);
  csv += csvRow(["Period", `${formatCalendarDate(budget.period_start)} - ${formatCalendarDate(budget.period_end)}`]);
  csv += csvRow(["Currency", currency]);
  csv += csvRow(["Status", budget.status]);
  csv += csvRow(["Generated", new Date().toISOString()]);
  csv += csvRow([
    "Note",
    "Month-end projections are estimates based on spending pace so far, not guarantees.",
  ]);
  csv += "\r\n";

  csv += csvRow([
    "Allocation",
    "Percentage",
    "Target",
    "Actual",
    "Remaining",
    "% Consumed",
    "Projected month-end",
    "Status",
  ]);
  for (const allocation of actuals.allocations) {
    const budgetAllocation = budget.allocations.find(
      (a) => a.allocation_type === allocation.allocationType,
    );
    csv += csvRow([
      ALLOCATION_LABELS[allocation.allocationType] ?? allocation.allocationType,
      budgetAllocation ? `${budgetAllocation.percentage}%` : "",
      toMajorUnits(BigInt(allocation.targetMinor), currency),
      toMajorUnits(BigInt(allocation.actualMinor), currency),
      toMajorUnits(BigInt(allocation.remainingMinor), currency),
      allocation.percentConsumed !== null ? `${Math.round(allocation.percentConsumed)}%` : "",
      allocation.projectedMinor !== null
        ? toMajorUnits(BigInt(allocation.projectedMinor), currency)
        : "",
      STATUS_LABELS[allocation.status] ?? allocation.status,
    ]);
  }
  csv += "\r\n";

  csv += csvRow(["Budgeted income", toMajorUnits(BigInt(budget.normalized_monthly_income_minor), currency)]);
  csv += csvRow(["Actual income", toMajorUnits(BigInt(actuals.actualIncomeMinor), currency)]);
  csv += csvRow(["Unmapped spending", toMajorUnits(BigInt(actuals.unmappedMinor), currency), `${actuals.unmappedCount} transaction(s)`]);
  csv += csvRow(["Uncategorized spending", toMajorUnits(BigInt(actuals.uncategorizedMinor), currency), `${actuals.uncategorizedCount} transaction(s)`]);

  const safeName = budget.name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="budget-${safeName || budget.id}.csv"`,
    },
  });
}
