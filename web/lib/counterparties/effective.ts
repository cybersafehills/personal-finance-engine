// A merged counterparty is a soft pointer (merged_into_id), so anything that
// groups transactions by counterparty must first resolve each id to its
// EFFECTIVE (surviving) counterparty and show that one's name - otherwise a
// merge would not change the totals. Pure; no I/O.

export type CounterpartyRef = {
  id: string;
  display_name: string;
  merged_into_id: string | null;
};

export type EffectiveCounterparty = { id: string; displayName: string };

/** id -> its surviving counterparty (itself when not merged). The merge RPC keeps chains one hop deep; a longer chain is still followed (bounded) so a data quirk can't loop. */
export function buildEffectiveMap(
  rows: readonly CounterpartyRef[],
): Map<string, EffectiveCounterparty> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<string, EffectiveCounterparty>();
  for (const r of rows) {
    let cur = r;
    for (let hops = 0; hops < 8 && cur.merged_into_id; hops++) {
      const next = byId.get(cur.merged_into_id);
      if (!next) break;
      cur = next;
    }
    out.set(r.id, { id: cur.id, displayName: cur.display_name });
  }
  return out;
}

/** Applies the map to a transaction's counterparty fields; unresolved ids keep the raw label. */
export function resolveCounterparty(
  counterpartyId: string | null,
  rawName: string | null,
  map: ReadonlyMap<string, EffectiveCounterparty>,
): { counterpartyId: string | null; counterpartyName: string | null } {
  if (!counterpartyId) return { counterpartyId: null, counterpartyName: rawName };
  const eff = map.get(counterpartyId);
  return eff
    ? { counterpartyId: eff.id, counterpartyName: eff.displayName }
    : { counterpartyId, counterpartyName: rawName };
}
