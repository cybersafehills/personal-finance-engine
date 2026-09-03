// Pure diff of an external "Transactions" sheet against the ledger.
// Produces conflict drafts only - never a ledger write. The sheet column
// order is the one datasetToSheetRows / TXN_HEADER emits:
//   Date | Description | Reference | Transaction ID | Direction | Amount |
//   Currency | Category | Account

export type LedgerRowForDiff = {
  id: string;
  occurredAt: string;
  description: string | null;
  reference: string | null;
  externalId: string | null;
  direction: "in" | "out" | "neutral";
  amountMinor: number;
  currency: string | null;
  category: string | null;
  accountName: string | null;
};

export type ConflictDraft = {
  kind: "field_changed" | "row_only_in_workbook";
  refType: "transaction";
  refId: string | null;
  field: string | null;
  oneledgerValue: unknown;
  externalValue: unknown;
};

export type WorkbookDiffResult = {
  conflicts: ConflictDraft[];
  matched: number;
  unmatched: number;
};

/** Fields we compare and can later apply. Kept small on purpose. */
const COMPARABLE_FIELDS: { key: "category" | "description"; col: number }[] = [
  { key: "category", col: 7 },
  { key: "description", col: 1 },
];

function num(raw: string): number {
  const n = Number(String(raw ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(Math.abs(n)) : NaN;
}

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function sameDay(a: string, b: string): boolean {
  return a.slice(0, 10) === b.slice(0, 10);
}

export function diffWorkbookAgainstLedger(
  sheetRows: string[][],
  ledger: LedgerRowForDiff[],
): WorkbookDiffResult {
  const conflicts: ConflictDraft[] = [];
  let matched = 0;
  let unmatched = 0;

  const byExternalId = new Map<string, LedgerRowForDiff>();
  for (const row of ledger) {
    if (row.externalId) byExternalId.set(norm(row.externalId), row);
  }

  // rows[0] is the header
  for (let i = 1; i < sheetRows.length; i += 1) {
    const cells = sheetRows[i];
    if (!cells || cells.every((c) => (c ?? "").trim() === "")) continue;

    const date = (cells[0] ?? "").trim();
    const extId = (cells[3] ?? "").trim();
    const amount = num(cells[5] ?? "");
    const dirRaw = norm(cells[4]);
    const direction = dirRaw.startsWith("in")
      ? "in"
      : dirRaw.startsWith("out")
      ? "out"
      : "neutral";

    let ledgerRow: LedgerRowForDiff | undefined;
    if (extId) {
      ledgerRow = byExternalId.get(norm(extId));
    }
    if (!ledgerRow) {
      ledgerRow = ledger.find((r) =>
        r.amountMinor === amount &&
        r.direction === direction &&
        date.length >= 10 &&
        sameDay(r.occurredAt, date) &&
        norm(r.description) === norm(cells[1])
      );
    }

    if (!ledgerRow) {
      unmatched += 1;
      conflicts.push({
        kind: "row_only_in_workbook",
        refType: "transaction",
        refId: null,
        field: null,
        oneledgerValue: null,
        externalValue: {
          date,
          description: cells[1] ?? "",
          amount,
          direction,
          currency: (cells[6] ?? "").trim() || null,
          category: cells[7] ?? "",
        },
      });
      continue;
    }

    matched += 1;
    for (const { key, col } of COMPARABLE_FIELDS) {
      const external = (cells[col] ?? "").trim();
      const current = key === "category"
        ? (ledgerRow.category ?? "")
        : (ledgerRow.description ?? "");
      if (norm(external) !== norm(current)) {
        conflicts.push({
          kind: "field_changed",
          refType: "transaction",
          refId: ledgerRow.id,
          field: key,
          oneledgerValue: current || null,
          externalValue: external || null,
        });
      }
    }
  }

  return { conflicts, matched, unmatched };
}
