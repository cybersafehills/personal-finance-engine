import type { Person, PersonKind } from "@/features/people/types";

// "Where your usual income comes from": the forecast counts money received as
// income, so a big sender that is really one of your own accounts inflates it.
// Same rule as the web (topSourcesOfMoneyIn): people and unknowns only, RWF
// received only, biggest first. It only SUGGESTS; nothing is marked without a tap.

export type IncomeSource = {
  id: string;
  name: string;
  kind: PersonKind;
  received: bigint;
  txnCount: number;
};

export function topIncomeSources(people: readonly Person[], max = 5): IncomeSource[] {
  const sources: IncomeSource[] = [];
  for (const p of people) {
    if (p.kind === "self" || p.kind === "merchant") continue;
    const rwf = p.currencies.find((c) => c.currency === "RWF");
    if (!rwf || rwf.receivedMinor <= 0n) continue;
    sources.push({ id: p.id, name: p.displayName, kind: p.kind, received: rwf.receivedMinor, txnCount: p.txnCount });
  }
  return sources
    .sort((a, b) => (a.received === b.received ? a.name.localeCompare(b.name) : a.received > b.received ? -1 : 1))
    .slice(0, max);
}

export const SELF_EXPLANATION =
  "Money moving between your own accounts is not income or spending. Marked this way, transactions with this name are left out of your totals, budgets and forecast.";
