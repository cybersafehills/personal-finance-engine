import { failureForStatus, type BearerFailure } from "@/api/bearer";

import type {
  BillDetail,
  BillEvent,
  BillField,
  BillFinding,
  BillLineItem,
  BillListItem,
  BillTone,
} from "./types";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const TONES: readonly BillTone[] = ["accent", "neutral", "attention", "positive"];

/** Whether Bills is on for the active Space, from GET /api/mobile/config. Any doubt means "not offered". */
export function parseBillsEnabled(status: number, body: unknown): boolean {
  if (status !== 200 || !isRecord(body) || body.ok !== true || !isRecord(body.config)) return false;
  return body.config.bills === true;
}

function parseItem(raw: unknown): BillListItem | null {
  if (!isRecord(raw) || !str(raw.id) || !str(raw.filename) || !str(raw.status)) return null;
  if (!str(raw.statusLabel) || !str(raw.uploadedLabel)) return null;
  return {
    id: raw.id,
    filename: raw.filename,
    status: raw.status,
    statusLabel: raw.statusLabel,
    tone: TONES.includes(raw.tone as BillTone) ? (raw.tone as BillTone) : "neutral",
    uploadedLabel: raw.uploadedLabel,
    pageCount: typeof raw.pageCount === "number" && Number.isFinite(raw.pageCount) ? raw.pageCount : null,
  };
}

const parseField = (raw: unknown): BillField | null =>
  isRecord(raw) && str(raw.key) && str(raw.label) && str(raw.value)
    ? { key: raw.key, label: raw.label, value: raw.value }
    : null;

const parseLineItem = (raw: unknown): BillLineItem | null =>
  isRecord(raw) && str(raw.description) && str(raw.totalLabel)
    ? {
        description: raw.description,
        quantityLabel: str(raw.quantityLabel) ? raw.quantityLabel : null,
        totalLabel: raw.totalLabel,
      }
    : null;

const parseFinding = (raw: unknown): BillFinding | null =>
  isRecord(raw) && str(raw.id) && str(raw.severity) && str(raw.severityLabel) && str(raw.title) && str(raw.detail)
    ? {
        id: raw.id,
        severity: raw.severity,
        severityLabel: raw.severityLabel,
        title: raw.title,
        detail: raw.detail,
        suggestedAction: str(raw.suggestedAction) ? raw.suggestedAction : null,
      }
    : null;

const parseEvent = (raw: unknown): BillEvent | null =>
  isRecord(raw) && str(raw.id) && str(raw.label) && str(raw.byLabel) && str(raw.whenLabel)
    ? { id: raw.id, label: raw.label, byLabel: raw.byLabel, whenLabel: raw.whenLabel }
    : null;

const notNull = <T,>(v: T | null): v is T => v !== null;

function parseDetail(raw: unknown): BillDetail | null {
  const item = parseItem(raw);
  if (!item || !isRecord(raw) || !str(raw.typeLabel) || !str(raw.sizeLabel)) return null;
  const ex = raw.extraction;
  const ch = raw.checks;
  return {
    ...item,
    typeLabel: raw.typeLabel,
    sizeLabel: raw.sizeLabel,
    extraction: isRecord(ex)
      ? {
          fields: list(ex.fields).map(parseField).filter(notNull),
          lineItems: list(ex.lineItems).map(parseLineItem).filter(notNull),
        }
      : null,
    checks: isRecord(ch)
      ? {
          blocking: typeof ch.blocking === "number" ? ch.blocking : 0,
          outOfDate: ch.outOfDate === true,
          findings: list(ch.findings).map(parseFinding).filter(notNull),
        }
      : null,
    history: Array.isArray(raw.history) ? raw.history.map(parseEvent).filter(notNull) : null,
    // Anything but an explicit true hides the button.
    canViewOriginal: raw.canViewOriginal === true,
  };
}

export type BillsResult =
  | { ok: true; bills: BillListItem[]; hasMore: boolean }
  | ({ ok: false } & BearerFailure);

export function parseBillsResponse(status: number, body: unknown): BillsResult {
  if (status === 200 && isRecord(body) && body.ok === true && Array.isArray(body.bills)) {
    return { ok: true, bills: body.bills.map(parseItem).filter(notNull), hasMore: body.hasMore === true };
  }
  if (status === 200) return { ok: false, reason: "error", message: "The documents response wasn't understood." };
  return { ok: false, ...failureForStatus(status, "Bills") };
}

export type BillResult =
  | { ok: true; bill: BillDetail }
  | { ok: false; reason: "not_found" | "unavailable" | "unauthorized" | "mfa_required" | "error"; message: string };

export function parseBillResponse(status: number, body: unknown): BillResult {
  if (status === 200 && isRecord(body) && body.ok === true) {
    const bill = parseDetail(body.bill);
    if (bill) return { ok: true, bill };
    return { ok: false, reason: "error", message: "The document response wasn't understood." };
  }
  // 404 is "not in this Space" or Bills off; the server's `error` tells them apart
  // only by wording, so say what is true of both.
  if (status === 404) return { ok: false, reason: "not_found", message: "That document wasn't found in this Space." };
  const f = failureForStatus(status, "That document");
  return { ok: false, reason: f.reason, message: f.message };
}

export type OriginalResult =
  | { ok: true; url: string }
  | { ok: false; reason: "not_found" | "forbidden" | "unauthorized" | "mfa_required" | "unavailable" | "error"; message: string };

/** The link is only ever accepted over https, and is never stored or logged. */
export function parseOriginalResponse(status: number, body: unknown): OriginalResult {
  if (status === 200 && isRecord(body) && body.ok === true) {
    const d = body.download;
    if (isRecord(d) && str(d.url) && d.url.startsWith("https://")) return { ok: true, url: d.url };
    return { ok: false, reason: "error", message: "Couldn't prepare the original. Try again." };
  }
  if (status === 403 && isRecord(body) && body.error === "forbidden") {
    return { ok: false, reason: "forbidden", message: "You don't have permission to open the original." };
  }
  if (status === 404) return { ok: false, reason: "not_found", message: "That document wasn't found in this Space." };
  const f = failureForStatus(status, "That document");
  return { ok: false, reason: f.reason, message: f.message };
}
