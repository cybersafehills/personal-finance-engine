import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { computeStatementMath } from "./statement-math.ts";
import {
  buildStatementRecord,
  buildStatementTransactionRows,
  humanizeTransactionType,
  type LedgerTxnRow,
  resolveStatementScope,
  toCoverageFact,
  toDisplayFields,
  toMathFact,
} from "./statement-snapshot.ts";

function row(over: Partial<LedgerTxnRow> & { id: string }): LedgerTxnRow {
  return {
    occurred_at: "2026-08-01T00:00:00.000Z",
    transaction_type: "merchant_payment",
    direction: "out",
    principal_effect_rwf: -1_000,
    fee_effect_rwf: 0,
    balance_after_rwf: null,
    currency: "RWF",
    counterparty_name: null,
    counterparty_reference: null,
    category: null,
    financial_source_id: "src-1",
    ...over,
  };
}

Deno.test("humanizeTransactionType maps known types and falls back", () => {
  assertEquals(humanizeTransactionType("send_money"), "Money sent");
  assertEquals(humanizeTransactionType("cash_withdrawal"), "Cash withdrawal");
  assertEquals(humanizeTransactionType("mystery"), "Transaction");
});

Deno.test("toMathFact coerces string bigints and preserves a null balance", () => {
  const f = toMathFact(row({
    id: "a",
    principal_effect_rwf: "-2500",
    fee_effect_rwf: "-100",
    balance_after_rwf: null,
    direction: "out",
  }));
  assertEquals(f.principalEffectMinor, -2500);
  assertEquals(f.feeEffectMinor, -100);
  assertEquals(f.balanceAfterMinor, null);
  assertEquals(f.currency, "RWF");
});

Deno.test("toCoverageFact carries a provider balance through", () => {
  const f = toCoverageFact(row({ id: "a", balance_after_rwf: 4200 }));
  assertEquals(f.balanceAfterMinor, 4200);
});

Deno.test("toDisplayFields: friendly name wins, provider reference kept alongside", () => {
  const d = toDisplayFields(
    row({
      id: "a",
      counterparty_name: "Transfer to Butera Egide",
      counterparty_reference: "RNDPS eKash/XF2E442/0785653857",
    }),
    "standard",
  );
  assertEquals(d.displayDescription, "Transfer to Butera Egide");
  assertEquals(d.reference, "RNDPS eKash/XF2E442/0785653857");
  assertEquals(d.originalDescription, "RNDPS eKash/XF2E442/0785653857");
});

Deno.test("toDisplayFields: no name -> humanized type; no duplicate original", () => {
  const d = toDisplayFields(
    row({ id: "a", transaction_type: "airtime", counterparty_name: "  " }),
    "standard",
  );
  assertEquals(d.displayDescription, "Airtime purchase");
  assertEquals(d.originalDescription, null);
});

Deno.test("toDisplayFields: original omitted when it equals the display text", () => {
  const d = toDisplayFields(
    row({ id: "a", counterparty_name: "MTN", counterparty_reference: "MTN" }),
    "standard",
  );
  assertEquals(d.originalDescription, null);
});

Deno.test("toDisplayFields: category only for the detailed type", () => {
  const base = row({ id: "a", category: "Groceries" });
  assertEquals(toDisplayFields(base, "standard").category, null);
  assertEquals(toDisplayFields(base, "detailed").category, "Groceries");
});

Deno.test("resolveStatementScope: empty request means every authorized account", () => {
  const r = resolveStatementScope([], ["a", "b"], undefined);
  assert(r.ok);
  assertEquals(r.scope, "all_accounts");
  assertEquals(r.sourceIds.sort(), ["a", "b"]);
});

Deno.test("resolveStatementScope: nothing authorized is rejected", () => {
  const r = resolveStatementScope([], [], undefined);
  assert(!r.ok);
  assertEquals(r.kind, "no_sources");
});

Deno.test("resolveStatementScope: one authorized source -> single_account", () => {
  const r = resolveStatementScope(["a"], ["a", "b"], undefined);
  assert(r.ok);
  assertEquals(r.scope, "single_account");
  assertEquals(r.sourceIds, ["a"]);
});

Deno.test("resolveStatementScope: several sources -> all_accounts", () => {
  const r = resolveStatementScope(["a", "b"], ["a", "b", "c"], undefined);
  assert(r.ok);
  assertEquals(r.scope, "all_accounts");
});

Deno.test("resolveStatementScope: an unauthorized source is rejected generically", () => {
  const r = resolveStatementScope(["z"], ["a", "b"], undefined);
  assert(!r.ok);
  assertEquals(r.kind, "unauthorized_source");
});

Deno.test("resolveStatementScope: a filter forces the 'filtered' scope", () => {
  const r = resolveStatementScope(["a"], ["a"], { direction: "out" });
  assert(r.ok);
  assertEquals(r.scope, "filtered");
});

Deno.test("resolveStatementScope: duplicate requested ids are collapsed", () => {
  const r = resolveStatementScope(["a", "a"], ["a"], undefined);
  assert(r.ok);
  assertEquals(r.sourceIds, ["a"]);
  assertEquals(r.scope, "single_account");
});

Deno.test("buildStatementTransactionRows: chronological, indexed, frozen", () => {
  const rows: LedgerTxnRow[] = [
    row({
      id: "t2",
      occurred_at: "2026-08-03T00:00:00.000Z",
      direction: "out",
      principal_effect_rwf: -3_000,
      fee_effect_rwf: -100,
      balance_after_rwf: 11_900,
      counterparty_name: "Shop",
      counterparty_reference: "REF-2",
      category: "Groceries",
    }),
    row({
      id: "t1",
      occurred_at: "2026-08-02T00:00:00.000Z",
      direction: "in",
      principal_effect_rwf: 10_000,
      fee_effect_rwf: 0,
      balance_after_rwf: 15_000,
      counterparty_name: "Employer",
      counterparty_reference: "REF-1",
    }),
  ];
  const math = computeStatementMath(rows.map(toMathFact), {
    currency: "RWF",
    openingBalanceMinor: 5_000,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = buildStatementTransactionRows(math, byId, {
    statementUuid: "stmt-uuid",
    statementType: "detailed",
  });

  assertEquals(out.map((r) => r.transaction_id), ["t1", "t2"]);
  assertEquals(out.map((r) => r.sort_index), [0, 1]);
  assertEquals(out.every((r) => r.statement_id === "stmt-uuid"), true);
  assertEquals(out[0].running_balance_minor, 15_000);
  assertEquals(out[1].running_balance_minor, 11_900);
  assertEquals(out[1].display_description, "Shop");
  assertEquals(out[1].reference, "REF-2");
  assertEquals(out[1].category, "Groceries"); // detailed
});

Deno.test("buildStatementTransactionRows: standard type drops categories", () => {
  const rows = [row({ id: "t1", category: "Rent" })];
  const math = computeStatementMath(rows.map(toMathFact), { currency: "RWF" });
  const out = buildStatementTransactionRows(
    math,
    new Map(rows.map((r) => [r.id, r])),
    { statementUuid: "s", statementType: "standard" },
  );
  assertEquals(out[0].category, null);
});

Deno.test("buildStatementTransactionRows throws if a ledger row is missing", () => {
  const rows = [row({ id: "t1" })];
  const math = computeStatementMath(rows.map(toMathFact), { currency: "RWF" });
  assertThrows(() =>
    buildStatementTransactionRows(math, new Map(), {
      statementUuid: "s",
      statementType: "standard",
    })
  );
});

Deno.test("buildStatementRecord: single currency -> totals set, per_currency null", () => {
  const rows = [
    row({ id: "a", direction: "in", principal_effect_rwf: 10_000 }),
    row({
      id: "b",
      direction: "out",
      principal_effect_rwf: -4_000,
      fee_effect_rwf: -50,
    }),
  ];
  const math = computeStatementMath(rows.map(toMathFact), {
    currency: "RWF",
    openingBalanceMinor: 1_000,
    closingBalanceMinor: 6_950,
  });
  const rec = buildStatementRecord({
    statementPublicId: "OL-ST-20260907-ABCDEF",
    workspaceId: "ws-1",
    createdBy: "user-1",
    statementType: "standard",
    scope: "single_account",
    accountIds: ["src-1"],
    filters: {},
    periodStartUtc: new Date("2026-08-01T00:00:00.000Z"),
    periodEndUtc: new Date("2026-09-01T00:00:00.000Z"),
    timezone: "Africa/Kigali",
    currencyHint: "RWF",
    math,
    sourceMetadata: { summaryLabel: "x", sources: [] },
    coverageMetadata: { complete: true, warnings: [] },
    supersedesId: null,
    clientToken: "tok-1",
    now: new Date("2026-09-07T09:00:00.000Z"),
  });

  assertEquals(rec.currency, "RWF");
  assertEquals(rec.opening_balance_minor, 1_000);
  assertEquals(rec.closing_balance_minor, 6_950);
  assertEquals(rec.total_credit_minor, 10_000);
  assertEquals(rec.total_debit_minor, 4_000);
  assertEquals(rec.total_fees_minor, 50);
  assertEquals(rec.transaction_count, 2);
  assertEquals(rec.per_currency, null);
  assertEquals(rec.reconciles, true); // 1000 + 10000 - 4000 - 50 = 6950
  assertEquals(rec.status, "ready");
  assertEquals(rec.period_start, "2026-08-01T00:00:00.000Z");
  assertEquals(rec.generated_at, "2026-09-07T09:00:00.000Z");
});

Deno.test("buildStatementRecord: mixed currency -> zero top-line totals, per_currency populated", () => {
  const rows = [
    row({
      id: "a",
      currency: "RWF",
      direction: "in",
      principal_effect_rwf: 10_000,
    }),
    row({
      id: "b",
      currency: "USD",
      direction: "out",
      principal_effect_rwf: -50,
    }),
  ];
  const math = computeStatementMath(rows.map(toMathFact), {});
  const rec = buildStatementRecord({
    statementPublicId: "OL-ST-20260907-ABCDEF",
    workspaceId: "ws-1",
    createdBy: "user-1",
    statementType: "standard",
    scope: "all_accounts",
    accountIds: ["src-1", "src-2"],
    filters: {},
    periodStartUtc: new Date("2026-08-01T00:00:00.000Z"),
    periodEndUtc: new Date("2026-09-01T00:00:00.000Z"),
    timezone: "Africa/Kigali",
    currencyHint: "RWF",
    math,
    sourceMetadata: {},
    coverageMetadata: {},
    supersedesId: null,
    clientToken: "tok-2",
    now: new Date("2026-09-07T09:00:00.000Z"),
  });

  assertEquals(rec.currency, "RWF"); // hint, since math.currency is null
  assertEquals(rec.total_credit_minor, 0);
  assertEquals(rec.total_debit_minor, 0);
  assertEquals(rec.opening_balance_minor, null);
  assert(Array.isArray(rec.per_currency));
  assertEquals(rec.per_currency?.map((c) => c.currency), ["RWF", "USD"]);
  assertEquals(rec.reconciles, null);
});
