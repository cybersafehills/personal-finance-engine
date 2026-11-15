// Confirmed self-transfers (transfer_links.status = 'linked') move money
// between a user's own accounts: they are never income or spending. Budgets
// already honour this (getBudgetActuals); this pure helper gives every other
// summary surface (Home totals, category totals, reports, emails) the same
// rule so figures agree across surfaces. See
// docs/oneledger-3/transfer-exclusion-finding.md. Zero imports (deno-testable).

export type TransferLinkIds = {
  out_transaction_id: string;
  in_transaction_id: string;
};

/** Ids of both legs of every confirmed link. Pass only status='linked' rows. */
export function linkedTransferIdSet(
  links: readonly TransferLinkIds[],
): Set<string> {
  const ids = new Set<string>();
  for (const l of links) {
    ids.add(l.out_transaction_id);
    ids.add(l.in_transaction_id);
  }
  return ids;
}

export function excludeLinkedTransfers<T extends { id: string }>(
  rows: readonly T[],
  linked: ReadonlySet<string>,
): T[] {
  return linked.size === 0 ? [...rows] : rows.filter((r) => !linked.has(r.id));
}
