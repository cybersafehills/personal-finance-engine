import { assertEquals } from "jsr:@std/assert@1";
import {
  parseDrilldownParams,
  parseOverviewParams,
  previousScope,
  serializeFact,
  serializeOverview,
} from "./insights-api.ts";
import {
  applyDrilldown,
  computeOverview,
  type InsightFact,
} from "./insights-math.ts";

const q = (s: string) => new URLSearchParams(s);
const U = "00000000-0000-4000-8000-000000000001";
const base = "from=2026-08-01T00:00:00Z&to=2026-09-01T00:00:00Z";

Deno.test("valid params parse; defaults and whitelisting", () => {
  const r = parseOverviewParams(
    q(`${base}&account_id=${U}&granularity=week&compare=previous&evil=1`),
  );
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.value.tz, "Africa/Kigali");
    assertEquals(r.value.scope.accountIds, [U]);
    assertEquals(r.value.granularity, "week");
    assertEquals(r.value.compare, true);
    assertEquals(Object.keys(r.value.scope).sort(), [
      "accountIds",
      "from",
      "to",
    ]);
  }
});

Deno.test("bad input is rejected with a specific code", () => {
  const err = (s: string) => {
    const r = parseOverviewParams(q(s));
    return r.ok ? "ok" : r.error;
  };
  assertEquals(err(""), "invalid_range");
  assertEquals(err("from=2026-08-01&to=2026-09-01"), "invalid_range");
  assertEquals(
    err("from=2026-09-01T00:00:00Z&to=2026-08-01T00:00:00Z"),
    "invalid_range",
  );
  assertEquals(
    err("from=2020-01-01T00:00:00Z&to=2026-09-01T00:00:00Z"),
    "range_too_large",
  );
  assertEquals(err(`${base}&account_id=nope`), "invalid_account");
  assertEquals(err(`${base}&workspace_id=x`), "invalid_workspace");
  assertEquals(err(`${base}&tz=Mars/Base`), "invalid_timezone");
  assertEquals(err(`${base}&granularity=hour`), "invalid_granularity");
  assertEquals(err(`${base}&category=`), "invalid_filter");
  assertEquals(err(`${base}&tz=America/New_York`), "ok");
});

Deno.test("previous period has the same length and ends where the current starts", () => {
  const p = previousScope({
    from: "2026-08-01T00:00:00.000Z",
    to: "2026-09-01T00:00:00.000Z",
  });
  assertEquals(p.to, "2026-08-01T00:00:00.000Z");
  assertEquals(p.from, "2026-07-01T00:00:00.000Z");
});

const fact = (o: Partial<InsightFact>): InsightFact => ({
  id: "t1",
  direction: "out",
  principalEffectRwf: -1000,
  feeEffectRwf: -100,
  category: "Food",
  transactionType: "merchant_payment",
  counterpartyName: "Shop",
  accountId: "a1",
  currency: "RWF",
  settlement: "settled",
  occurredAt: "2026-08-10T10:00:00Z",
  ...o,
});
const scope = {
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-09-01T00:00:00.000Z",
};

Deno.test("serialisation is JSON-safe: bigint -> strings, no precision loss", () => {
  const big = 9_007_199_254_740_000;
  const o = computeOverview(
    [fact({ principalEffectRwf: -big, feeEffectRwf: 0 })],
    scope,
    new Set(),
  );
  const parsed = JSON.parse(
    JSON.stringify(serializeOverview(o, "Africa/Kigali")),
  );
  assertEquals(parsed.currencies[0].money_out_minor, String(big));
  assertEquals(typeof parsed.currencies[0].net_minor, "string");
  assertEquals(parsed.currencies[0].drilldowns.money_out.kind, "money_out");
});

Deno.test("drill-down params + rows reproduce the aggregate through the API shapes", () => {
  const facts = [
    fact({ id: "a" }),
    fact({ id: "b", category: "Rent", principalEffectRwf: -5000 }),
  ];
  const o = computeOverview(facts, scope, new Set());
  const cat = o.currencies[0].byCategory.find((c) => c.category === "Rent")!;
  const params = parseDrilldownParams(
    q(`${base}&kind=category&value=Rent&currency=RWF`),
  );
  assertEquals(params.ok, true);
  if (params.ok) {
    const rows = applyDrilldown(facts, params.value.filter, new Set());
    assertEquals(rows.map((r) => r.id), ["b"]);
    assertEquals(
      rows.reduce(
        (sum, r) => sum + -(r.principalEffectRwf + r.feeEffectRwf),
        0,
      ),
      Number(cat.amountMinor),
    );
    assertEquals(serializeFact(rows[0]).amount_minor, "-5100");
  }
});

Deno.test("drill-down params validate kind, value, currency and paging", () => {
  const e = (s: string) => {
    const r = parseDrilldownParams(q(`${base}&${s}`));
    return r.ok ? "ok" : r.error;
  };
  assertEquals(e("kind=nope&currency=RWF"), "invalid_kind");
  assertEquals(e("kind=money_in"), "invalid_currency");
  assertEquals(e("kind=category&currency=RWF"), "invalid_filter");
  assertEquals(e("kind=money_in&currency=RWF&limit=500"), "invalid_page");
  assertEquals(e("kind=money_in&currency=RWF&offset=-1"), "invalid_page");
  assertEquals(e("kind=money_in&currency=RWF&limit=10&offset=20"), "ok");
});
