import { failureForStatus, type BearerFailure } from "@/api/bearer";

import type { CategoriesData, CategoryTotal } from "./types";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parseCategory(raw: unknown): CategoryTotal | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.category !== "string" || raw.category.length === 0) return null;
  if (!num(raw.totalRwf) || !num(raw.transactionCount)) return null;
  return {
    category: raw.category,
    totalRwf: raw.totalRwf,
    transactionCount: raw.transactionCount > 0 ? Math.floor(raw.transactionCount) : 0,
  };
}

export type CategoriesResult = ({ ok: true } & CategoriesData) | ({ ok: false } & BearerFailure);

/** Maps the endpoint's HTTP status and JSON to a typed result. */
export function parseCategoriesResponse(status: number, body: unknown): CategoriesResult {
  if (status === 200 && isRecord(body) && body.ok === true && Array.isArray(body.categories)) {
    return {
      ok: true,
      categories: body.categories.map(parseCategory).filter((c): c is CategoryTotal => c !== null),
      truncated: body.truncated === true,
    };
  }
  if (status === 200) {
    return { ok: false, reason: "error", message: "The categories response wasn't understood." };
  }
  return { ok: false, ...failureForStatus(status, "Your categories") };
}
