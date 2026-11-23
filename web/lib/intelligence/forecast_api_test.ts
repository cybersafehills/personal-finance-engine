import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { computeCashFlowForecast } from "./cash-flow-forecast.ts";
import { parseForecastScope, serializeWalletForecast } from "./forecast-api.ts";

const account = "10000000-0000-4000-8000-000000000001";
const workspace = "10000000-0000-4000-8000-000000000002";

Deno.test("forecast input validates horizon and explicit wallet/Space IDs", () => {
  assertEquals(parseForecastScope(new URLSearchParams()), {
    days: 30,
    workspaceId: null,
    accountId: null,
  });
  assertEquals(
    parseForecastScope(
      new URLSearchParams({
        days: "7",
        workspace_id: workspace,
        account_id: account,
      }),
    ),
    {
      days: 7,
      workspaceId: workspace,
      accountId: account,
    },
  );
  for (
    const query of [
      "days=31",
      "days=7&days=14",
      "account_id=other",
      "workspace_id=",
    ]
  ) {
    assertEquals(parseForecastScope(new URLSearchParams(query)), null);
  }
});

Deno.test("mobile sends the same computed scenarios as web in exact minor units", () => {
  const forecast = computeCashFlowForecast({
    currency: "RWF",
    currentBalanceMinor: 1_000,
    horizonDays: 7,
    scheduled: [{
      label: "Bill due",
      dayOffset: 2,
      amountMinor: -600,
      kind: "bill_due",
      confidence: "high",
    }],
    estimatedDailyDiscretionaryMinor: 100,
    estimatedDailyInflowMinor: 50,
  });
  const entry = {
    walletId: account,
    name: "Cash",
    isDefault: true,
    balanceAsOf: "2026-11-19T00:00:00Z",
    forecast,
  };
  const wire = serializeWalletForecast(entry);
  assertEquals(wire.wallet_id, account);
  assertEquals(wire.opening_minor, "1000");
  assertEquals(wire.scheduled_end_minor, "400");
  assertEquals(wire.estimated_end_minor, "50");
  assertEquals(wire.no_income_end_minor, "-300");
  assertEquals(wire.points.map((point) => point.day), [0, 2, 7]);
  assertThrows(() =>
    serializeWalletForecast({
      ...entry,
      forecast: {
        ...forecast,
        openingBalanceMinor: Number.MAX_SAFE_INTEGER + 1,
      },
    })
  );
});
