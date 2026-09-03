// Pure transaction-match scoring (master prompt §12). Deno-testable.
// Scores an approved-document's extracted identity against candidate
// outgoing transactions, with explicit reasons for and against each. It
// never links anything - a reviewer confirms.

import { normalizeSupplierName } from "../normalize.ts";

export type TxnCandidate = {
  transactionId: string;
  occurredAt: string; // ISO timestamp
  amountMinor: string; // transactions.amount_rwf - minor units of its own currency
  currency: string;
  counterpartyName: string | null;
  counterpartyReference: string | null;
};

export type BillMatchSubject = {
  totalMinor: string | null;
  currency: string | null;
  issueDate: string | null; // YYYY-MM-DD
  supplierName: string | null;
  invoiceNumber: string | null;
};

export type TransactionMatch = {
  transactionId: string;
  score: number;
  reasonsFor: string[];
  reasonsAgainst: string[];
};

const MIN_SCORE = 0.45;
const MAX = 8;

function toBig(s: string | null): bigint | null {
  if (!s || !/^-?\d+$/.test(s)) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

function dayGap(iso: string, ymd: string): number | null {
  const a = Date.parse(iso);
  const b = Date.parse(ymd + "T00:00:00Z");
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.abs(Math.round((a - b) / 86400000));
}

function norm(s: string | null): string | null {
  return s ? s.trim().toLowerCase().replace(/\s+/g, "") : null;
}

export function scoreTransactionMatches(
  subject: BillMatchSubject,
  candidates: TxnCandidate[],
  opts: { amountToleranceMinor?: bigint } = {},
): TransactionMatch[] {
  const tolerance = opts.amountToleranceMinor ?? 2n;
  const total = toBig(subject.totalMinor);
  const cur = subject.currency?.toUpperCase() ?? null;
  const supplierKey = normalizeSupplierName(subject.supplierName);
  const invNum = norm(subject.invoiceNumber);

  const out: TransactionMatch[] = [];

  for (const c of candidates) {
    const reasonsFor: string[] = [];
    const reasonsAgainst: string[] = [];
    let score = 0;

    const amt = toBig(c.amountMinor);
    if (total != null && amt != null) {
      const diff = amt > total ? amt - total : total - amt;
      if (diff <= tolerance) {
        score += 0.5;
        reasonsFor.push("exact amount");
      } else if (total > 0n && diff * 100n <= total * 2n) {
        score += 0.3;
        reasonsFor.push("amount within 2%");
      } else {
        reasonsAgainst.push("amount differs");
      }
    }

    const txnCur = c.currency?.toUpperCase() ?? null;
    if (cur && txnCur) {
      if (cur === txnCur) {
        score += 0.15;
        reasonsFor.push("currency matches");
      } else {
        score -= 0.3;
        reasonsAgainst.push(`currency mismatch (${txnCur} vs ${cur})`);
      }
    }

    if (subject.issueDate) {
      const gap = dayGap(c.occurredAt, subject.issueDate);
      if (gap != null) {
        if (gap <= 3) {
          score += 0.25;
          reasonsFor.push("paid within 3 days of the invoice");
        } else if (gap <= 14) {
          score += 0.15;
          reasonsFor.push("paid within 2 weeks of the invoice");
        } else if (gap <= 30) {
          score += 0.05;
        } else {
          reasonsAgainst.push("paid well after the invoice date");
        }
      }
    }

    const cpKey = normalizeSupplierName(c.counterpartyName);
    if (supplierKey && cpKey && (cpKey.includes(supplierKey) || supplierKey.includes(cpKey))) {
      score += 0.2;
      reasonsFor.push("recipient matches the supplier");
    }
    if (invNum && norm(c.counterpartyReference) === invNum) {
      score += 0.25;
      reasonsFor.push("payment reference matches the invoice number");
    }

    score = Math.max(0, Math.min(1, score));
    if (score >= MIN_SCORE) {
      out.push({
        transactionId: c.transactionId,
        score: Math.round(score * 10000) / 10000,
        reasonsFor,
        reasonsAgainst,
      });
    }
  }

  return out.sort((a, b) => b.score - a.score).slice(0, MAX);
}
