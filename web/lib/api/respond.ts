import { NextResponse } from "next/server";

// One consistent JSON shape for every /api/v1 response:
//   success -> { "data": <payload>, "meta"?: { ... } }
//   error   -> { "error": { "code": "...", "message": "..." } }
// plus a stable set of headers. Keep handlers thin - they call these.

const BASE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export function apiOk(
  data: unknown,
  opts: { meta?: Record<string, unknown>; headers?: Record<string, string> } = {},
): NextResponse {
  const body: Record<string, unknown> = { data };
  if (opts.meta) body.meta = opts.meta;
  return NextResponse.json(body, {
    headers: { ...BASE_HEADERS, ...(opts.headers ?? {}) },
  });
}

export function apiError(
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { ...BASE_HEADERS, ...headers } },
  );
}

/** Clamp a `?limit=` query param to a sane page size. */
export function parseLimit(raw: string | null, fallback = 50, max = 200): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

/**
 * Given the rows fetched for a page (fetched as limit+1) and the page
 * size, return the trimmed rows and the opaque next cursor (or null).
 * `cursorOf` derives the cursor string from the last returned row.
 */
export function paginate<T>(
  rows: T[],
  limit: number,
  cursorOf: (row: T) => string,
): { items: T[]; nextCursor: string | null } {
  if (rows.length <= limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, limit);
  return { items, nextCursor: cursorOf(items[items.length - 1]) };
}
