// Pure helpers for the counterparties mobile API: query parsing and the
// reshaping of counterparty_summaries_v rows (one per counterparty x currency)
// into one object per counterparty. No I/O. bigint columns arrive from
// PostgREST as numbers or strings; they leave as decimal strings.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ListParams = {
  q: string | null;
  kind: "person" | "merchant" | "unknown" | "self" | null;
  limit: number;
  offset: number;
  workspaceId: string | null;
};

export function parsePageParams(
  sp: URLSearchParams,
): { ok: true; value: { limit: number; offset: number } } | {
  ok: false;
  error: "invalid_page";
} {
  const limit = Number(sp.get("limit") ?? 50);
  const offset = Number(sp.get("offset") ?? 0);
  if (
    !Number.isInteger(limit) || limit < 1 || limit > 100 ||
    !Number.isInteger(offset) || offset < 0
  ) {
    return { ok: false, error: "invalid_page" };
  }
  return { ok: true, value: { limit, offset } };
}

export function parseCounterpartyListParams(
  sp: URLSearchParams,
): { ok: true; value: ListParams } | {
  ok: false;
  error:
    | "invalid_page"
    | "invalid_kind"
    | "invalid_query"
    | "invalid_workspace";
} {
  const page = parsePageParams(sp);
  if (!page.ok) return page;
  const kind = sp.get("kind");
  if (
    kind !== null && kind !== "person" && kind !== "merchant" &&
    kind !== "unknown" && !(kind === "self" && sp.get("contract") === "2")
  ) {
    return { ok: false, error: "invalid_kind" };
  }
  // Search text goes into an ILIKE pattern: strip the wildcard characters so a
  // caller can't turn "contains" into a pattern scan, and bound the length.
  const raw = sp.get("q");
  const q = raw === null ? null : raw.replace(/[%_\\,()*]/g, " ").trim();
  if (raw !== null && (raw.length > 80 || q === "")) {
    return { ok: false, error: "invalid_query" };
  }
  const ws = sp.get("workspace_id");
  if (ws !== null && !UUID.test(ws)) {
    return { ok: false, error: "invalid_workspace" };
  }
  return {
    ok: true,
    value: {
      q,
      kind: kind as ListParams["kind"],
      limit: page.value.limit,
      offset: page.value.offset,
      workspaceId: ws,
    },
  };
}

export type SummaryRow = {
  counterparty_id: string;
  display_name: string;
  kind: string;
  confidence: string;
  currency: string;
  sent_minor: number | string | bigint;
  received_minor: number | string | bigint;
  txn_count: number | string | bigint;
  first_at: string | null;
  last_at: string | null;
};

export type MobileCounterparty = {
  id: string;
  display_name: string;
  kind: string;
  confidence: string;
  txn_count: number;
  first_at: string | null;
  last_at: string | null;
  currencies: {
    currency: string;
    sent_minor: string;
    received_minor: string;
    net_minor: string;
    txn_count: number;
  }[];
};

const big = (
  v: number | string | bigint,
): bigint => (typeof v === "bigint" ? v : BigInt(v));

/** Groups rows per counterparty; sorted by total volume (sent+received, summed per currency) then name. */
export function groupCounterpartyRows(
  rows: readonly SummaryRow[],
): MobileCounterparty[] {
  const map = new Map<string, MobileCounterparty & { volume: bigint }>();
  for (const r of rows) {
    const sent = big(r.sent_minor),
      recv = big(r.received_minor),
      n = Number(big(r.txn_count));
    const cur = map.get(r.counterparty_id) ?? {
      id: r.counterparty_id,
      display_name: r.display_name,
      kind: r.kind,
      confidence: r.confidence,
      txn_count: 0,
      first_at: null,
      last_at: null,
      currencies: [],
      volume: 0n,
    };
    cur.currencies.push({
      currency: r.currency,
      sent_minor: sent.toString(),
      received_minor: recv.toString(),
      net_minor: (recv - sent).toString(),
      txn_count: n,
    });
    cur.txn_count += n;
    cur.volume += sent + recv;
    if (r.first_at && (!cur.first_at || r.first_at < cur.first_at)) {
      cur.first_at = r.first_at;
    }
    if (r.last_at && (!cur.last_at || r.last_at > cur.last_at)) {
      cur.last_at = r.last_at;
    }
    map.set(r.counterparty_id, cur);
  }
  return [...map.values()]
    .sort((
      a,
      b,
    ) => (a.volume === b.volume
      ? a.display_name.localeCompare(b.display_name)
      : a.volume > b.volume
      ? -1
      : 1)
    )
    .map((c) => ({
      id: c.id,
      display_name: c.display_name,
      kind: c.kind,
      confidence: c.confidence,
      txn_count: c.txn_count,
      first_at: c.first_at,
      last_at: c.last_at,
      currencies: c.currencies.sort((x, y) =>
        x.currency.localeCompare(y.currency)
      ),
    }));
}
