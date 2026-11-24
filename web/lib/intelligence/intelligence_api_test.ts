import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  MAX_ANOMALIES,
  MAX_RECURRING,
  serializeIntelligence,
  titleCase,
  type IntelligenceSource,
} from "./intelligence-api.ts";

const wallet = "10000000-0000-4000-8000-000000000001";

function source(over: Partial<IntelligenceSource> = {}): IntelligenceSource {
  return {
    enabled: true,
    forecast: null,
    baseline: null,
    anomalies: [],
    recurring: [],
    walletForecasts: [],
    ...over,
  };
}

Deno.test("empty insights serialize to explicit nulls and empty lists, never invented figures", () => {
  assertEquals(serializeIntelligence(source()), {
    default_wallet_id: null,
    summary: null,
    baseline: null,
    anomalies: [],
    anomalies_total: 0,
    recurring: [],
    recurring_total: 0,
  });
});

Deno.test("default wallet is the flagged one, else the first", () => {
  const walletForecasts = [
    { walletId: "a", isDefault: false },
    { walletId: "b", isDefault: true },
  ];
  assertEquals(serializeIntelligence(source({ walletForecasts })).default_wallet_id, "b");
  assertEquals(
    serializeIntelligence(source({ walletForecasts: [walletForecasts[0]] })).default_wallet_id,
    "a",
  );
});

Deno.test("baseline is sent in exact minor units and dropped when it has no percentage", () => {
  const baseline = {
    thisMonthToDateRwf: 120_000,
    baselineToSameDayRwf: 80_000,
    changePercent: 50,
    direction: "above" as const,
    monthsCompared: 3,
    basis: ["a", "b"],
  };
  assertEquals(serializeIntelligence(source({ baseline })).baseline, {
    this_month_minor: "120000",
    usual_minor: "80000",
    change_percent: 50,
    direction: "above",
    months_compared: 3,
    basis: ["a", "b"],
  });
  assertEquals(
    serializeIntelligence(source({ baseline: { ...baseline, changePercent: null } })).baseline,
    null,
  );
});

Deno.test("anomalies and recurring payments are title-cased, bigint-exact and capped with the true total", () => {
  const anomalies = Array.from({ length: MAX_ANOMALIES + 3 }, (_, i) => ({
    counterpartyKey: "mtn rwanda",
    category: "Airtime",
    amountMinor: 18_000 + i,
    typicalMinor: 2_000,
    timesTypical: 9,
    occurredAt: "2026-11-10T08:00:00Z",
  }));
  const recurring = Array.from({ length: MAX_RECURRING + 2 }, (_, i) => ({
    counterpartyKey: `landlord ${i}`,
    category: null,
    typicalAmountMinor: 9_007_199_254_740_993n,
    typicalDayOfMonth: 5,
    monthsSeen: 3,
  }));
  const out = serializeIntelligence(source({ anomalies, recurring }));
  assertEquals(out.anomalies.length, MAX_ANOMALIES);
  assertEquals(out.anomalies_total, MAX_ANOMALIES + 3);
  assertEquals(out.anomalies[0].counterparty, "Mtn Rwanda");
  assertEquals(out.anomalies[0].amount_minor, "18000");
  assertEquals(out.recurring.length, MAX_RECURRING);
  assertEquals(out.recurring_total, MAX_RECURRING + 2);
  assertEquals(out.recurring[0].typical_amount_minor, "9007199254740993");
  assertEquals(out.recurring[0].counterparty, "Landlord 0");
});

Deno.test("the summary is the same sentence the web banner uses", () => {
  const out = serializeIntelligence(
    source({
      anomalies: [{
        counterpartyKey: "mtn rwanda",
        category: null,
        amountMinor: 18_000,
        typicalMinor: 2_000,
        timesTypical: 9,
        occurredAt: "2026-11-10T08:00:00Z",
      }],
    }),
  );
  assertEquals(out.summary?.headline.startsWith("A payment to Mtn Rwanda looks unusually large"), true);
});

Deno.test("an amount that cannot be exact is refused, not rounded", () => {
  assertThrows(
    () =>
      serializeIntelligence(
        source({
          baseline: {
            thisMonthToDateRwf: Number.MAX_SAFE_INTEGER + 2,
            baselineToSameDayRwf: 1,
            changePercent: 1,
            direction: "in_line",
            monthsCompared: 2,
            basis: [],
          },
        }),
      ),
    RangeError,
  );
});

Deno.test("titleCase", () => {
  assertEquals(titleCase("kigali water"), "Kigali Water");
  assertEquals(wallet.length, 36);
});
