import { bearerGet, failureForOutcome, failureForStatus, type BearerFailure } from "@/api/bearer";
import { minor } from "./parse";

export const FORECAST_DAYS = [7, 14, 30] as const;
export type ForecastDays = typeof FORECAST_DAYS[number];
export type ForecastScope = { workspaceId: string; accountId: string | null; days: ForecastDays };
export type ForecastPoint = { day: number; label: string; scheduled: bigint; estimated: bigint };
export type WalletForecast = {
  id: string;
  name: string;
  balanceAsOf: string | null;
  opening: bigint;
  scheduledEnd: bigint;
  estimatedEnd: bigint;
  noIncomeEnd: bigint;
  estimatesIncome: boolean;
  low: { day: number; amount: bigint } | null;
  points: ForecastPoint[];
  basis: string[];
  disclaimer: string;
};
type ForecastResult =
  | { ok: true; computedAt: string; wallets: WalletForecast[] }
  | ({ ok: false } & BearerFailure);

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function instant(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parseWallet(value: unknown, days: ForecastDays): WalletForecast | null {
  if (!object(value) || value.currency !== "RWF" || typeof value.wallet_id !== "string" ||
    typeof value.name !== "string" || typeof value.estimates_income !== "boolean" ||
    typeof value.disclaimer !== "string" || (value.balance_as_of !== null && !instant(value.balance_as_of)) ||
    !Array.isArray(value.points) || value.points.length < 2 || value.points.length > days + 1 ||
    !Array.isArray(value.basis) || !value.basis.every((item) => typeof item === "string")) return null;

  const opening = minor(value.opening_minor);
  const scheduledEnd = minor(value.scheduled_end_minor);
  const estimatedEnd = minor(value.estimated_end_minor);
  const noIncomeEnd = minor(value.no_income_end_minor);
  if (opening === null || scheduledEnd === null || estimatedEnd === null || noIncomeEnd === null) return null;

  const points: ForecastPoint[] = [];
  for (const item of value.points) {
    if (!object(item) || typeof item.day !== "number" || !Number.isInteger(item.day) ||
      item.day < 0 || item.day > days || typeof item.label !== "string") return null;
    const scheduled = minor(item.scheduled_minor);
    const estimated = minor(item.estimated_minor);
    if (scheduled === null || estimated === null || item.day <= (points.at(-1)?.day ?? -1)) return null;
    points.push({ day: item.day, label: item.label, scheduled, estimated });
  }
  if (points[0].day !== 0 || points.at(-1)?.day !== days) return null;

  let low: WalletForecast["low"] = null;
  if (value.low !== null) {
    if (!object(value.low) || typeof value.low.day !== "number" || !Number.isInteger(value.low.day) ||
      value.low.day < 0 || value.low.day > days) return null;
    const amount = minor(value.low.amount_minor);
    if (amount === null || amount >= 0n) return null;
    low = { day: value.low.day, amount };
  }
  return {
    id: value.wallet_id, name: value.name, balanceAsOf: value.balance_as_of,
    opening, scheduledEnd, estimatedEnd, noIncomeEnd, low, points,
    estimatesIncome: value.estimates_income, basis: value.basis, disclaimer: value.disclaimer,
  };
}

export function parseForecast(status: number, body: unknown, scope: ForecastScope): ForecastResult {
  if (status === 422) {
    return { ok: false, reason: "error", message: "There’s too much activity or an amount couldn’t be verified for this forecast. Try a single wallet." };
  }
  if (status !== 200) return { ok: false, ...failureForStatus(status, "Your cash-flow forecast") };
  if (!object(body) || body.ok !== true || body.workspace_id !== scope.workspaceId ||
    body.account_id !== scope.accountId || body.horizon_days !== scope.days ||
    !instant(body.computed_at) || !Array.isArray(body.forecasts)) {
    return { ok: false, reason: "error", message: "Couldn’t verify the forecast for this Space and date range." };
  }
  const wallets: WalletForecast[] = [];
  for (const raw of body.forecasts) {
    const wallet = parseWallet(raw, scope.days);
    if (!wallet || (scope.accountId && wallet.id !== scope.accountId) || wallets.some((entry) => entry.id === wallet.id)) {
      return { ok: false, reason: "error", message: "Couldn’t verify the wallet forecast." };
    }
    wallets.push(wallet);
  }
  return { ok: true, computedAt: body.computed_at, wallets };
}

export async function fetchForecast(scope: ForecastScope): Promise<ForecastResult> {
  const query = new URLSearchParams({ workspace_id: scope.workspaceId, days: String(scope.days) });
  if (scope.accountId) query.set("account_id", scope.accountId);
  const result = await bearerGet(`/api/mobile/insights/forecast?${query}`);
  return result.kind === "response"
    ? parseForecast(result.status, result.body, scope)
    : { ok: false, ...failureForOutcome(result, "Your cash-flow forecast") };
}
