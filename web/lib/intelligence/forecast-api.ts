import type { CashFlowForecast } from "./cash-flow-forecast.ts";

export const FORECAST_HORIZONS = [7, 14, 30] as const;
export type ForecastHorizon = typeof FORECAST_HORIZONS[number];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WalletForecastEntry = {
  walletId: string;
  name: string;
  isDefault: boolean;
  balanceAsOf: string | null;
  forecast: CashFlowForecast;
};

export function parseForecastScope(params: URLSearchParams) {
  const rawDays = params.get("days") ?? "30";
  const days = FORECAST_HORIZONS.find((value) => String(value) === rawDays);
  const workspaceId = params.get("workspace_id");
  const accountId = params.get("account_id");
  if (
    !days || (workspaceId !== null && !UUID.test(workspaceId)) ||
    (accountId !== null && !UUID.test(accountId)) ||
    ["days", "workspace_id", "account_id"].some((key) =>
      params.getAll(key).length > 1
    )
  ) {
    return null;
  }
  return {
    days,
    workspaceId: workspaceId?.toLowerCase() ?? null,
    accountId: accountId?.toLowerCase() ?? null,
  };
}

function exactMinor(value: number): string {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError("forecast_amount_unavailable");
  }
  return String(value);
}

export function serializeWalletForecast(entry: WalletForecastEntry) {
  const f = entry.forecast;
  return {
    wallet_id: entry.walletId,
    name: entry.name,
    balance_as_of: entry.balanceAsOf,
    currency: f.currency,
    opening_minor: exactMinor(f.openingBalanceMinor),
    scheduled_end_minor: exactMinor(f.projectedEnd.knownBalanceMinor),
    estimated_end_minor: exactMinor(f.projectedEnd.estimatedBalanceMinor),
    no_income_end_minor: exactMinor(f.projectedEnd.noIncomeBalanceMinor),
    estimates_income: f.estimatedInMinor > 0,
    low: f.mayGoNegative
      ? {
        day: f.projectedLow.dayOffset,
        amount_minor: exactMinor(f.projectedLow.estimatedBalanceMinor),
      }
      : null,
    points: f.points.map((point) => ({
      day: point.dayOffset,
      label: point.label,
      scheduled_minor: exactMinor(point.knownBalanceMinor),
      estimated_minor: exactMinor(point.estimatedBalanceMinor),
    })),
    basis: f.basis,
    disclaimer: f.disclaimer,
  };
}
