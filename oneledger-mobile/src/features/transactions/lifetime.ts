// "Lifetime" money through OneLedger: the two yellow chips under the
// Transactions header. Pure rules, mirroring web/lib/queries.ts
// `getLifetimeFlowTotals` and web/components/LifetimeFlowBadge.tsx.

export type LifetimeRow = {
  direction: string;
  principal_effect_rwf: number | string | null;
  fee_effect_rwf: number | string | null;
};

export type LifetimeFlow = {
  sentRwf: number;
  receivedRwf: number;
  /** Settled in/out transactions counted (neutral rows are not). */
  count: number;
};

/**
 * Sent = sum of |principal + fee| on outgoing rows; received = sum of
 * (principal + fee) on incoming rows. Neutral rows (self-transfers etc.)
 * count towards neither.
 */
export function sumLifetimeFlow(rows: readonly LifetimeRow[]): LifetimeFlow {
  let sentRwf = 0;
  let receivedRwf = 0;
  let count = 0;
  for (const row of rows) {
    const effect = Number(row.principal_effect_rwf ?? 0) + Number(row.fee_effect_rwf ?? 0);
    if (!Number.isFinite(effect)) continue;
    if (row.direction === "out") sentRwf += Math.abs(effect);
    else if (row.direction === "in") receivedRwf += effect;
    else continue;
    count += 1;
  }
  return { sentRwf, receivedRwf, count };
}

/** DD/MM/YYYY (UTC), or null when the date is missing or unusable. */
export function formatDdMmYyyy(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** The one-line explanation behind each chip's "i". */
export function lifetimeInfo(kind: "sent" | "received", createdIso: string | null): string {
  const created = formatDdMmYyyy(createdIso);
  const since = created
    ? `since your account was created on ${created}`
    : "since your account was created";
  return `Total money ${kind} through OneLedger ${since}.`;
}
