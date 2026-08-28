// Pure content-duplicate scoring (master prompt §10). Deno-testable.
// Exact-file duplicates never reach here - bill_documents_checksum_unique
// stops them at upload. This scores a subject document's extracted
// identity against every other non-terminal document in the workspace.
// Never auto-resolves; it only produces ranked candidates for a reviewer.

import { normalizeSupplierName } from "../normalize";

export type Fingerprint = {
  billDocumentId: string;
  status: string;
  supplierName: string | null;
  invoiceNumber: string | null;
  receiptNumber: string | null;
  issueDate: string | null; // YYYY-MM-DD
  currency: string | null;
  totalMinor: string | null;
};

export type DuplicateRelation =
  | "exact"
  | "probable"
  | "similar"
  | "recurring"
  | "multi_file";

export type DuplicateCandidate = {
  candidateDocumentId: string;
  relation: DuplicateRelation;
  score: number;
  signals: string[];
  detail: Record<string, unknown>;
};

const MIN_SCORE = 0.5;
const MAX_CANDIDATES = 10;

function docNumber(fp: Fingerprint): string | null {
  const n = fp.invoiceNumber ?? fp.receiptNumber;
  return n ? n.trim().toLowerCase().replace(/\s+/g, "") : null;
}

function totalMinor(fp: Fingerprint): bigint | null {
  if (!fp.totalMinor || !/^-?\d+$/.test(fp.totalMinor)) return null;
  try {
    return BigInt(fp.totalMinor);
  } catch {
    return null;
  }
}

function daysApart(a: string, b: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  const da = Date.parse(a + "T00:00:00Z");
  const db = Date.parse(b + "T00:00:00Z");
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.abs(Math.round((da - db) / 86400000));
}

export function scoreDuplicates(
  subject: Fingerprint,
  priors: Fingerprint[],
  opts: { amountToleranceMinor?: bigint } = {},
): DuplicateCandidate[] {
  const tolerance = opts.amountToleranceMinor ?? 0n;
  const sKey = normalizeSupplierName(subject.supplierName);
  const sNum = docNumber(subject);
  const sTotal = totalMinor(subject);
  const sCur = subject.currency?.toUpperCase() ?? null;
  const sDate = subject.issueDate;

  const out: DuplicateCandidate[] = [];

  for (const prior of priors) {
    if (prior.billDocumentId === subject.billDocumentId) continue;
    const pKey = normalizeSupplierName(prior.supplierName);
    const pNum = docNumber(prior);
    const pTotal = totalMinor(prior);
    const pCur = prior.currency?.toUpperCase() ?? null;
    const pDate = prior.issueDate;

    const signals: string[] = [];
    const supplierMatch = !!(sKey && pKey && sKey === pKey);
    const numberMatch = !!(sNum && pNum && sNum === pNum);
    const currencyMatch = !!(sCur && pCur && sCur === pCur);
    const dateMatch = !!(sDate && pDate && sDate === pDate);
    const amountMatch =
      sTotal != null && pTotal != null &&
      (sTotal - pTotal <= tolerance && pTotal - sTotal <= tolerance);

    if (numberMatch) signals.push("document_number");
    if (supplierMatch) signals.push("supplier_name");
    if (amountMatch) signals.push("total");
    if (currencyMatch) signals.push("currency");
    if (dateMatch) signals.push("issue_date");

    let score = 0;
    let relation: DuplicateRelation = "similar";

    if (numberMatch && (supplierMatch || (!sKey && !pKey))) {
      score = supplierMatch ? 0.96 : 0.82;
      relation = "probable";
    } else if (supplierMatch && amountMatch && currencyMatch && dateMatch) {
      score = numberMatch ? 0.98 : 0.9;
      relation = numberMatch ? "probable" : "multi_file";
    } else if (supplierMatch && amountMatch && currencyMatch && !dateMatch) {
      const gap = sDate && pDate ? daysApart(sDate, pDate) : null;
      if (gap != null && gap <= 45) {
        score = 0.55;
        relation = "recurring";
      } else {
        score = 0.5;
        relation = "similar";
      }
    } else if (supplierMatch && (amountMatch || dateMatch)) {
      score = 0.45;
      relation = "similar";
    }

    if (score >= MIN_SCORE && signals.length > 0) {
      out.push({
        candidateDocumentId: prior.billDocumentId,
        relation,
        score: Math.round(score * 10000) / 10000,
        signals,
        detail: {
          prior_status: prior.status,
          matched: signals,
          subject_total_minor: subject.totalMinor,
          prior_total_minor: prior.totalMinor,
        },
      });
    }
  }

  return out.sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES);
}
