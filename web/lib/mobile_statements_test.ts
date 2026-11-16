import { assertEquals } from "jsr:@std/assert@1";
import {
  type StatementRowInput,
  toMobileStatement,
} from "./mobile-statements.ts";

const BASE: StatementRowInput = {
  id: "11111111-1111-4111-8111-111111111111",
  statement_id: "OL-ST-2026-000001",
  statement_type: "standard",
  scope: "all_accounts",
  status: "ready",
  // 1 Nov - 30 Nov 2026 in Kigali (UTC+2)
  period_start: "2026-10-31T22:00:00Z",
  period_end: "2026-11-30T22:00:00Z",
  timezone: "Africa/Kigali",
  currency: "RWF",
  opening_balance_minor: 100000,
  closing_balance_minor: 150000,
  total_credit_minor: 80000,
  total_debit_minor: 28000,
  total_fees_minor: 2000,
  transaction_count: 12,
  per_currency: null,
  reconciles: true,
  coverage_metadata: { warnings: [{}, {}] },
  supersedes_id: null,
  generated_at: "2026-12-01T06:00:00Z",
};

Deno.test("reshapes a single-currency statement from its stored totals", () => {
  const s = toMobileStatement(BASE)!;
  assertEquals(s.periodLabel, "1 November 2026 – 30 November 2026");
  assertEquals(s.scopeLabel, "Consolidated");
  assertEquals(s.typeLabel, "Standard");
  assertEquals(s.warningCount, 2);
  assertEquals(s.isUpdatedVersion, false);
  assertEquals(s.totals, [{
    currency: "RWF",
    openingMinor: 100000,
    closingMinor: 150000,
    creditsMinor: 80000,
    debitsMinor: 28000,
    feesMinor: 2000,
    reconciles: true,
  }]);
});

Deno.test("a mixed-currency statement keeps one total per currency", () => {
  const s = toMobileStatement({
    ...BASE,
    per_currency: [
      {
        currency: "RWF",
        openingBalanceMinor: 1,
        closingBalanceMinor: 2,
        totalCreditsMinor: 3,
        totalDebitsMinor: 4,
        totalFeesMinor: 5,
        reconciles: true,
      },
      {
        currency: "USD",
        openingBalanceMinor: null,
        closingBalanceMinor: null,
        totalCreditsMinor: 600,
        totalDebitsMinor: 0,
        totalFeesMinor: 0,
        reconciles: null,
      },
    ],
  })!;
  assertEquals(s.totals.map((t) => t.currency), ["RWF", "USD"]);
  assertEquals(s.totals[1].openingMinor, null);
  assertEquals(s.totals[1].reconciles, null);
});

Deno.test("an unreconciled statement is reported, never hidden", () => {
  assertEquals(
    toMobileStatement({ ...BASE, reconciles: false })!.totals[0].reconciles,
    false,
  );
});

Deno.test("flags a superseding version and tolerates missing coverage metadata", () => {
  const s = toMobileStatement({
    ...BASE,
    supersedes_id: "x",
    coverage_metadata: null,
  })!;
  assertEquals(s.isUpdatedVersion, true);
  assertEquals(s.warningCount, 0);
});

Deno.test("the day label follows the statement's own timezone", () => {
  // The same instants read in UTC would be 31 Oct - 30 Nov.
  assertEquals(
    toMobileStatement({ ...BASE, timezone: "UTC" })!.periodLabel,
    "31 October 2026 – 30 November 2026",
  );
});

Deno.test("rows the app cannot show faithfully are dropped", () => {
  assertEquals(toMobileStatement({ ...BASE, status: "weird" }), null);
  assertEquals(toMobileStatement({ ...BASE, period_start: "nope" }), null);
  assertEquals(toMobileStatement({ ...BASE, timezone: "Not/AZone" }), null);
});

Deno.test("an unsupported currency yields no totals instead of wrong ones", () => {
  assertEquals(toMobileStatement({ ...BASE, currency: "XYZ" })!.totals, []);
});

Deno.test("unknown scope and type fall back to plain labels", () => {
  const s = toMobileStatement({
    ...BASE,
    scope: "mystery",
    statement_type: "detailed",
  })!;
  assertEquals(s.scopeLabel, "Statement");
  assertEquals(s.typeLabel, "Detailed");
});
