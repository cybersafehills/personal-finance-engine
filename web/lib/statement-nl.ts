// Deterministic natural-language -> structured statement request (master
// prompt section 31). AI may LATER translate a phrase into these fields,
// but the fields are always deterministic and the financial calculation
// never depends on language parsing. Zero imports, `deno test`.
//
// "Give me my detailed MTN MoMo statement for August, money out only"
//   -> { preset: "custom", fromDateKey: "2026-08-01", toDateKey: "2026-08-31",
//        statementType: "detailed", sourceHint: "mtn",
//        filters: { direction: "out" }, understood: [...] }

import type { StatementPeriodPreset } from "./statement-period.ts";

export type ParsedStatementRequest = {
  preset?: StatementPeriodPreset;
  fromDateKey?: string;
  toDateKey?: string;
  statementType?: "standard" | "detailed";
  /** A lowercase hint to match against an account label ("mtn", "airtel", "bank", or free text). */
  sourceHint?: string;
  filters?: { direction?: "in" | "out" };
  /** Human phrases the parser recognised, for a "we understood: …" confirmation. */
  understood: string[];
  /** True when nothing usable was found. */
  empty: boolean;
};

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const ISO_DATE = /(\d{4})-(\d{2})-(\d{2})/;

export function parseStatementQuery(
  text: string,
  now: Date = new Date(),
): ParsedStatementRequest {
  const q = ` ${text.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const out: ParsedStatementRequest = { understood: [], empty: true };
  const nowY = now.getUTCFullYear();
  const nowM = now.getUTCMonth() + 1;

  // --- statement type ---
  if (/\bdetailed\b/.test(q)) {
    out.statementType = "detailed";
    out.understood.push("detailed statement");
  } else if (/\bstandard\b/.test(q)) {
    out.statementType = "standard";
  }

  // --- source hint ---
  if (/\ball accounts\b|\bconsolidated\b|\bevery account\b/.test(q)) {
    out.sourceHint = "";
    out.understood.push("all accounts");
  } else if (/\bmtn\b|\bmomo\b|mobile money/.test(q)) {
    out.sourceHint = "mtn";
    out.understood.push("MTN Mobile Money");
  } else if (/\bairtel\b/.test(q)) {
    out.sourceHint = "airtel";
    out.understood.push("Airtel Money");
  } else if (/\bbank\b/.test(q)) {
    out.sourceHint = "bank";
    out.understood.push("bank account");
  } else {
    const m = q.match(/(?:for|from|of) (?:my |the )?"([^"]+)"/) ??
      q.match(
        /(?:for|from|of) (?:my |the )?([a-z0-9 ]{2,30}?) (?:account|statement|wallet)\b/,
      );
    if (m) {
      out.sourceHint = m[1].trim();
      out.understood.push(`account "${m[1].trim()}"`);
    }
  }

  // --- filters ---
  if (/money in\b|incoming\b|credits only\b|inflows?\b|received\b/.test(q)) {
    out.filters = { direction: "in" };
    out.understood.push("money in only");
  } else if (
    /money out\b|outgoing\b|debits only\b|outflows?\b|spending\b|expenses only\b/
      .test(q)
  ) {
    out.filters = { direction: "out" };
    out.understood.push("money out only");
  }

  // --- period ---
  const from = q.match(
    new RegExp(
      `from ${ISO_DATE.source} (?:to|until|through|-) ${ISO_DATE.source}`,
    ),
  );
  const between = q.match(
    new RegExp(`between ${ISO_DATE.source} and ${ISO_DATE.source}`),
  );
  const range = from ?? between;
  if (range) {
    out.preset = "custom";
    out.fromDateKey = `${range[1]}-${range[2]}-${range[3]}`;
    out.toDateKey = `${range[4]}-${range[5]}-${range[6]}`;
    out.understood.push(`${out.fromDateKey} to ${out.toDateKey}`);
  } else if (/\bthis month\b/.test(q)) {
    out.preset = "this_month";
    out.understood.push("this month");
  } else if (/\blast month\b|\bprevious month\b|\bpast month\b/.test(q)) {
    out.preset = "last_month";
    out.understood.push("last month");
  } else if (
    /\blast (?:3 months|three months|quarter)\b|\bpast 3 months\b/.test(q)
  ) {
    out.preset = "last_3_months";
    out.understood.push("last 3 months");
  } else if (/\blast 6 months\b|\bpast 6 months\b|\blast half year\b/.test(q)) {
    out.preset = "last_6_months";
    out.understood.push("last 6 months");
  } else if (
    /\blast (?:12 months|year)\b|\bpast (?:12 months|year)\b/.test(q)
  ) {
    out.preset = "last_12_months";
    out.understood.push("last 12 months");
  } else if (/\byear to date\b|\bytd\b/.test(q)) {
    out.preset = "custom";
    out.fromDateKey = `${nowY}-01-01`;
    out.toDateKey = `${nowY}-${pad2(nowM)}-${pad2(now.getUTCDate())}`;
    out.understood.push("year to date");
  } else {
    // "for August" / "in August 2026"
    const monthMatch = q.match(
      /\b(?:for|in|during|of) ([a-z]{3,9})(?: (\d{4}))?\b/,
    );
    if (monthMatch && MONTHS[monthMatch[1]]) {
      const month = MONTHS[monthMatch[1]];
      let year = monthMatch[2] ? Number(monthMatch[2]) : nowY;
      if (!monthMatch[2] && month > nowM) year = nowY - 1; // most recent past
      out.preset = "custom";
      out.fromDateKey = `${year}-${pad2(month)}-01`;
      out.toDateKey = `${year}-${pad2(month)}-${
        pad2(lastDayOfMonth(year, month))
      }`;
      out.understood.push(`${monthMatch[1]} ${year}`);
    }
  }

  out.empty = out.understood.length === 0;
  return out;
}
