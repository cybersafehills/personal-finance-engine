// PDF statement -> tabular rows (ADR 0018, Slice A). Pure text heuristics
// only: the browser runs pdf.js to get positioned text items, this module
// turns them into visual lines and then into the same `string[][]` shape
// the CSV column-mapping flow already consumes. No AI, no network.
//
// Text-layer PDFs (what banks and wallets export) work; scanned images do
// not (no OCR) - CSV stays the fallback. Imperfect rows are fine: the
// mapping UI lets the user correct columns and import_statement_transactions
// skips unreadable lines and flags ledger matches for review.

// Runtime gate (read on the server, passed to the client flow). OFF
// unless exactly "true". No AI / key needed - extraction is pure pdf.js
// text-layer parsing in the browser.
export function isPdfStatementImportEnabled(): boolean {
  return process.env.PDF_STATEMENT_IMPORT_ENABLED === "true";
}

export type PdfTextItem = { str: string; x: number; y: number };

/**
 * Group positioned text items into visual lines: same y (within
 * `yTolerance`) is one line, items ordered left-to-right, joined so that a
 * visible horizontal gap becomes at least two spaces (which the row
 * splitter below treats as a column break).
 */
export function itemsToLines(
  items: PdfTextItem[],
  yTolerance = 2,
): string[] {
  const sorted = [...items]
    .filter((it) => it.str.trim().length > 0)
    .sort((a, b) => (b.y - a.y) || (a.x - b.x));

  const lines: string[] = [];
  let current: PdfTextItem[] = [];
  let lineY: number | null = null;

  const flush = () => {
    if (current.length === 0) return;
    current.sort((a, b) => a.x - b.x);
    let text = "";
    let prevEndX: number | null = null;
    for (const it of current) {
      if (prevEndX !== null) {
        const gap = it.x - prevEndX;
        text += gap > 8 ? "   " : gap > 1.5 ? " " : "";
      }
      text += it.str;
      // Rough end-x: assume ~0.5 unit per char at this zoom. Only used to
      // detect gaps, so precision doesn't matter.
      prevEndX = it.x + it.str.length * 0.5;
    }
    lines.push(text.replace(/\s+$/g, ""));
    current = [];
  };

  for (const it of sorted) {
    if (lineY === null || Math.abs(it.y - lineY) <= yTolerance) {
      current.push(it);
      lineY = lineY === null ? it.y : lineY;
    } else {
      flush();
      current = [it];
      lineY = it.y;
    }
  }
  flush();
  return lines;
}

// A date at the start-ish of a statement line: 31/12/2026, 2026-12-31,
// 31.12.26, or "31 Dec 2026" / "Dec 31, 2026".
const DATE_RE =
  /\b(\d{1,4}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{2,4}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{2,4})\b/;

// A candidate money token: optional sign / opening paren, an integer part
// with single [ ,.] group separators, an optional 2-digit decimal, an
// optional closing paren / trailing sign. Interior runs of whitespace are
// NOT allowed, so two amounts separated by column spacing stay separate.
// `looksLikeAmount` is still the real filter.
const AMOUNT_CANDIDATE_RE =
  /[-+(]?\d{1,3}(?:[ ,.]?\d{3})*(?:[.,]\d{2})?\)?[-+]?/g;

/**
 * True only for something that reads as a money amount: it has a "."/","
 * decimal with two trailing digits, OR a thousands separator - so a bare
 * year, a plain integer id, or a date fragment is never taken for money.
 */
export function looksLikeAmount(token: string): boolean {
  const t = token
    .trim()
    .replace(/^[(]|[)]$/g, "")
    .replace(/^[-+]|[-+]$/g, "")
    .trim();
  if (!/^\d[\d .,]*\d$|^\d$/.test(t)) return false;
  const hasDecimal = /[.,]\d{2}$/.test(t);
  const hasThousands = /\d[ ,.]\d{3}(?:\D|$)/.test(t);
  return hasDecimal || hasThousands;
}

export type PdfRowsResult = { headers: string[]; rows: string[][] };

/**
 * Keep only lines that carry both a date and at least one amount, and
 * split each into [date, description, amount]. When a line has two
 * trailing amounts (amount + running balance), the FIRST is taken as the
 * transaction amount. Sign / parentheses are preserved verbatim so the
 * downstream direction strategy ("the amount's sign") can use them.
 */
export function linesToRows(lines: string[]): PdfRowsResult {
  const rows: string[][] = [];
  for (const raw of lines) {
    const line = raw.replace(/ /g, " ").trim();
    const dateMatch = DATE_RE.exec(line);
    if (!dateMatch) continue;

    const amounts: { text: string; index: number }[] = [];
    AMOUNT_CANDIDATE_RE.lastIndex = 0;
    let am: RegExpExecArray | null;
    while ((am = AMOUNT_CANDIDATE_RE.exec(line)) !== null) {
      const text = am[0].trim();
      if (!looksLikeAmount(text)) continue;
      // Ignore a token that sits inside the matched date.
      if (
        am.index >= dateMatch.index &&
        am.index < dateMatch.index + dateMatch[0].length
      ) {
        continue;
      }
      amounts.push({ text, index: am.index });
    }
    if (amounts.length === 0) continue;

    const amount = amounts[0].text;
    const descStart = dateMatch.index + dateMatch[0].length;
    const description = line
      .slice(descStart, amounts[0].index)
      .replace(/\s{2,}/g, " ")
      .trim();

    rows.push([dateMatch[0], description, amount]);
  }
  return { headers: ["Date", "Description", "Amount"], rows };
}

/** itemsToLines -> linesToRows in one call. */
export function pdfItemsToStatementRows(items: PdfTextItem[]): PdfRowsResult {
  return linesToRows(itemsToLines(items));
}
