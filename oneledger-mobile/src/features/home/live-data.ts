import { fetchInsights } from "@/api/mobile-api";
import { supabase } from "@/api/supabase";
import { kigaliDateKey } from "@/lib/kigali-time";
import { formatMoney, type SupportedCurrency } from "@/lib/money";
import type { InsightsResult } from "@/features/insights/parse";
import type { CurrencyOverview } from "@/features/insights/types";
import type { Wallet } from "@/features/wallets/types";

export function greeting(hour: number) { return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"; }

export async function profileName(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;
  const { data: profile, error } = await supabase.from("profiles").select("display_name").eq("id", data.session.user.id).maybeSingle();
  if (error) throw error;
  return typeof profile?.display_name === "string" && profile.display_name.trim() ? profile.display_name.trim() : null;
}

export function homePeriods(now: Date) {
  const d = new Date(now.getTime() + 7200000), y = d.getUTCFullYear(), m = d.getUTCMonth();
  const start = (month: number) => new Date(Date.UTC(y, month, 1) - 7200000).toISOString();
  const previousDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const prevTo = d.getUTCDate() > previousDays ? start(m) : new Date(Date.UTC(y, m - 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()) - 7200000).toISOString();
  return { from: start(m), to: now.toISOString(), previousFrom: start(m - 1), previousTo: prevTo, trendFrom: start(m - 5) };
}

export async function loadHomeInsights(now: Date) {
  const p = homePeriods(now);
  const safe = async (request: ReturnType<typeof fetchInsights>): Promise<InsightsResult> => {
    try { return await request; } catch { return { ok: false, reason: "error", message: "Couldn't load this summary. Check your connection and try again." }; }
  };
  const todayFrom = new Date(Date.parse(kigaliDateKey(now.toISOString()) + "T00:00:00+02:00")).toISOString();
  const [current, previous, history, today] = await Promise.all([
    safe(fetchInsights({ from: p.from, to: p.to })),
    safe(fetchInsights({ from: p.previousFrom, to: p.previousTo })),
    safe(fetchInsights({ from: p.trendFrom, to: p.to, granularity: "month" })),
    safe(fetchInsights({ from: todayFrom, to: p.to })),
  ]);
  return { current, previous, history, today, periods: p, fetchedAt: now.toISOString() };
}
export function currencyBlock(result: InsightsResult | undefined, currency: SupportedCurrency): CurrencyOverview | null {
  return result?.ok ? result.overview.currencies.find((c) => c.currency === currency) ?? null : null;
}

export function walletTotal(wallets: Wallet[], currency: SupportedCurrency) {
  const same = wallets.filter((w) => w.currency === currency);
  const known = same.filter((w) => w.balance.amountMinor !== null);
  const dates = known.map((w) => w.balance.asOf).filter((d): d is string => !!d && Number.isFinite(Date.parse(d)));
  return {
    amount: known.length ? known.reduce((s, w) => s + w.balance.amountMinor!, 0n) : null,
    complete: known.length === same.length && same.length > 0,
    estimated: known.some((w) => w.balance.status === "estimated"),
    stale: known.some((w) => w.balance.status === "stale"),
    asOf: dates.length === known.length && dates.length ? dates.reduce((a, b) => Date.parse(a) < Date.parse(b) ? a : b) : null,
    count: same.length, otherCurrencies: new Set(wallets.filter((w) => w.currency !== currency).map((w) => w.currency)).size,
  };
}
export function changeBps(current: bigint, previous: bigint | null): number | null {
  return previous === null || previous <= 0n ? null : Number((current - previous) * 10000n / previous);
}
export function retainedPercent(income: bigint, expense: bigint): number | null {
  return income <= 0n ? null : Number((income - expense) * 10000n / income) / 100;
}
export function percentText(bps: number | null) { return bps === null ? "No comparison yet" : `${bps > 0 ? "+" : ""}${(bps / 100).toFixed(1)}%`; }
export function compactMoney(amount: bigint, currency: SupportedCurrency) {
  const decimals = currency === "RWF" ? 1n : 100n;
  const units = amount / decimals;
  const abs = units < 0n ? -units : units;
  for (const [factor, suffix] of [[1000000000n, "B"], [1000000n, "M"], [1000n, "K"]] as const) {
    if (abs >= factor) { const scaled = Number(units * 100n / factor) / 100; return `${currency} ${scaled.toFixed(2).replace(/\.?0+$/, "")}${suffix}`; }
  }
  return formatMoney(amount, currency);
}
export function fillTrend(points: NonNullable<CurrencyOverview["trend"]>, from: string, nowIso: string) {
  const start = kigaliDateKey(from).slice(0, 7), end = kigaliDateKey(nowIso).slice(0, 7);
  const [y, m] = start.split("-").map(Number);
  const result: NonNullable<CurrencyOverview["trend"]> = [];
  for (let i = 0; i < 6; i++) {
    const key = new Date(Date.UTC(y, m - 1 + i, 1)).toISOString().slice(0, 7);
    if (key > end) break;
    result.push(points.find((p) => p.bucketStart.slice(0, 7) === key) ?? { bucketStart: key + "-01", moneyInMinor: 0n, moneyOutMinor: 0n, netMinor: 0n });
  }
  return result;
}
