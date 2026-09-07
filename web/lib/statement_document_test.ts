import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  buildStatementCsv,
  formatStatementAmount,
  formatStatementSignedAmount,
  type StatementDocData,
  type StatementDocLine,
  statementDateKey,
} from "./statement-document.ts";

function line(over: Partial<StatementDocLine> = {}): StatementDocLine {
  return {
    occurredAt: "2026-08-15T10:00:00.000Z",
    displayDescription: "Corner Shop",
    originalDescription: null,
    reference: "REF-1",
    direction: "out",
    principalEffectMinor: -1_500,
    feeEffectMinor: -50,
    runningBalanceMinor: 8_450,
    category: "Groceries",
    ...over,
  };
}

function data(over: Partial<StatementDocData> = {}): StatementDocData {
  return {
    statementId: "OL-ST-20260907-ABCDEF",
    statementType: "standard",
    scope: "single_account",
    accountHolderName: "Alex Doe",
    periodLabel: "1 August 2026 – 31 August 2026",
    periodStartIso: "2026-07-31T22:00:00.000Z",
    periodEndIso: "2026-08-31T22:00:00.000Z",
    timezone: "Africa/Kigali",
    currency: "RWF",
    generatedAtIso: "2026-09-07T09:00:00.000Z",
    openingBalanceMinor: 10_000,
    closingBalanceMinor: 8_450,
    totalCreditsMinor: 0,
    totalDebitsMinor: 1_500,
    totalFeesMinor: 50,
    netMovementMinor: -1_550,
    transactionCount: 1,
    reconciles: true,
    perCurrency: null,
    runningBalanceAvailable: true,
    // Not read by the CSV writer.
    source: {} as StatementDocData["source"],
    coverage: {} as StatementDocData["coverage"],
    lines: [line()],
    ...over,
  };
}

Deno.test("formatStatementAmount: RWF is zero-decimal with a code suffix", () => {
  assertEquals(formatStatementAmount(1_234_567, "RWF"), "1,234,567 RWF");
  assertEquals(formatStatementAmount(-500, "RWF"), "500 RWF"); // magnitude only
  assertEquals(formatStatementAmount(1234, "USD"), "12.34 USD");
});

Deno.test("formatStatementSignedAmount keeps the sign", () => {
  assertEquals(formatStatementSignedAmount(-1_550, "RWF"), "-1,550 RWF");
  assertEquals(formatStatementSignedAmount(1_550, "RWF"), "1,550 RWF");
});

Deno.test("statementDateKey resolves the local calendar date in the statement timezone", () => {
  assertEquals(
    statementDateKey("2026-08-15T23:30:00.000Z", "Africa/Kigali"),
    "2026-08-16",
  );
  assertEquals(
    statementDateKey("2026-08-15T10:00:00.000Z", "Africa/Kigali"),
    "2026-08-15",
  );
});

Deno.test("buildStatementCsv: standard header + a money-out row", () => {
  const csv = buildStatementCsv(data());
  const rows = csv.replace(/^﻿/, "").split("\r\n");
  assertEquals(
    rows[0],
    '"Date","Description","Reference","Money In","Money Out","Fees","Balance"',
  );
  assertEquals(
    rows[1],
    '"2026-08-15","Corner Shop","REF-1","","1500","50","8450"',
  );
});

Deno.test("buildStatementCsv: detailed header carries the extra columns", () => {
  const csv = buildStatementCsv(
    data({ statementType: "detailed", lines: [line({ direction: "in", principalEffectMinor: 20_000, feeEffectMinor: 0, runningBalanceMinor: null })] }),
  );
  const rows = csv.replace(/^﻿/, "").split("\r\n");
  assertEquals(
    rows[0],
    '"Date","Description","Original Description","Reference","Category","Direction","Money In","Money Out","Fees","Balance","Currency"',
  );
  assertEquals(
    rows[1],
    '"2026-08-15","Corner Shop","","REF-1","Groceries","in","20000","","0","","RWF"',
  );
});

Deno.test("buildStatementCsv: starts with a UTF-8 BOM", () => {
  assert(buildStatementCsv(data()).startsWith("﻿"));
});

Deno.test("buildStatementCsv: a formula-like description is neutralised", () => {
  const csv = buildStatementCsv(
    data({ lines: [line({ displayDescription: "=SUM(A1:A9)" })] }),
  );
  assertStringIncludes(csv, `"'=SUM(A1:A9)"`);
});

Deno.test("buildStatementCsv: commas and quotes in a field are RFC-4180 escaped", () => {
  const csv = buildStatementCsv(
    data({ lines: [line({ reference: 'a,b "c"' })] }),
  );
  assertStringIncludes(csv, `"a,b ""c"""`);
});

Deno.test("buildStatementCsv: a null running balance renders as an empty cell", () => {
  const csv = buildStatementCsv(
    data({ lines: [line({ runningBalanceMinor: null })] }),
  );
  const cells = csv.replace(/^﻿/, "").split("\r\n")[1].split(",");
  assertEquals(cells[cells.length - 1], '""');
});

Deno.test("buildStatementCsv: line endings are CRLF", () => {
  const csv = buildStatementCsv(
    data({ lines: [line(), line({ occurredAt: "2026-08-16T10:00:00.000Z" })] }),
  );
  assertEquals((csv.match(/\r\n/g) ?? []).length, 2); // header->row1, row1->row2
});
