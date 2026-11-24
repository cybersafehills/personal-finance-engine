import { createChunkedStorage } from "@/lib/chunked-storage";
import { deviceStore } from "@/lib/device-store";
import { kigaliDateKey } from "@/lib/kigali-time";
import type { InsightsResult } from "@/features/insights/parse";
import type { loadHomeInsights } from "./live-data";

export type HomeInsights = Awaited<ReturnType<typeof loadHomeInsights>>;

// Home remembers the last good summary per user and Space so Cash flow opens with real
// numbers instead of a blank, then swaps in the fresh ones. Amounts are bigint, so they
// travel as tagged strings. Chunked: one keychain entry cannot hold a whole summary.
const store = createChunkedStorage(deviceStore);
const BIG = "$big";
const MAX_BYTES = 60_000;

export const insightsCacheKey = (userId: string, spaceId: string) => `ol.home.insights.v1.${userId}.${spaceId}`;
export const serializeInsights = (value: HomeInsights) => JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? { [BIG]: v.toString() } : v));
export function reviveInsights(text: string): HomeInsights | null {
  try {
    const value = JSON.parse(text, (_k, v) => (v && typeof v === "object" && typeof (v as Record<string, unknown>)[BIG] === "string" ? BigInt((v as Record<string, string>)[BIG]) : v)) as Partial<HomeInsights> | null;
    return value && value.current && value.previous && value.today && value.periods && typeof value.fetchedAt === "string" ? (value as HomeInsights) : null;
  } catch { return null; }
}
export async function readCachedInsights(key: string): Promise<HomeInsights | null> {
  try { const text = await store.getItem(key); return text ? reviveInsights(text) : null; } catch { return null; }
}
/** Only a good month summary is worth remembering, and never an oversized one. */
export async function writeCachedInsights(key: string, value: HomeInsights): Promise<void> {
  if (!value.current.ok) return;
  const text = serializeInsights(value);
  if (text.length > MAX_BYTES) return;
  try { await store.setItem(key, text); } catch { /* A missing cache only means a slower first paint. */ }
}

/**
 * Merge a fresh load over the remembered one, block by block: fresh wins when it succeeded,
 * a remembered block fills in where the fresh one failed or has not arrived, and a remembered
 * "today" is only ever used on the same Kigali day it was taken.
 */
export function mergeInsights(fresh: HomeInsights | null, cached: HomeInsights | null, now: Date) {
  const sameDay = !!cached && kigaliDateKey(cached.fetchedAt) === kigaliDateKey(now.toISOString());
  const pick = (a: InsightsResult | undefined, b: InsightsResult | undefined, allowed: boolean): InsightsResult | undefined => (a?.ok ? a : b?.ok && allowed ? b : a);
  const current = pick(fresh?.current, cached?.current, true);
  const previous = pick(fresh?.previous, cached?.previous, true);
  const today = pick(fresh?.today, cached?.today, sameDay);
  const base = fresh ?? cached;
  return {
    data: base ? { ...base, current: current ?? base.current, previous: previous ?? base.previous, today: today ?? base.today } : null,
    /** True while "today" is neither fresh nor a same-day remembered value, so it is still on its way. */
    todayPending: !fresh?.today.ok && !(sameDay && cached?.today.ok),
    usingRemembered: !fresh && !!cached,
  };
}
