// Proposes categorization rules for transactions that have no category yet.
// PURE (no imports) so it is unit-tested with `deno test`.
//
// It only PROPOSES. Nothing is created or applied here: each proposal links to
// the normal "New rule" form (prefilled), whose own preview and apply steps are
// where the user approves it.
//
// A proposal is a counterparty with at least `minCount` uncategorized
// transactions - a rule for a one-off is noise. If the same counterparty is
// already categorized the same way elsewhere, that category is suggested (with
// the evidence); otherwise the category is left for the user to choose.

export type StarterTxn = {
  counterpartyName: string | null;
  direction: string;
  /** Positive RWF the transaction moved. */
  amountRwf: number;
  category: string | null;
};

export type StarterProposal = {
  /** Stable key (lower-cased counterparty). */
  key: string;
  /** Name as last seen, for display and as the rule's match text. */
  counterparty: string;
  direction: "in" | "out" | "mixed";
  txnCount: number;
  totalRwf: number;
  suggestedCategory: string | null;
  /** Why that category, e.g. "4 of your 5 other payments to this name are Transport". */
  suggestionBasis: string | null;
};

export type StarterResult = {
  proposals: StarterProposal[];
  /** How many names qualified before the list was cut to `max`. */
  totalProposals: number;
  totalUncategorized: number;
  /** Uncategorized transactions the proposals would cover. */
  coveredCount: number;
  /** Uncategorized with no counterparty name at all (a name rule cannot match them). */
  nameless: number;
};

const keyOf = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

export function proposeStarterRules(
  uncategorized: readonly StarterTxn[],
  categorized: readonly StarterTxn[],
  opts: { minCount?: number; max?: number } = {},
): StarterResult {
  const minCount = opts.minCount ?? 2;
  const max = opts.max ?? 25;

  // Category evidence: counterparty -> category -> count.
  const evidence = new Map<string, Map<string, number>>();
  for (const t of categorized) {
    if (!t.counterpartyName || !t.category || t.category === "Uncategorized") {
      continue;
    }
    const k = keyOf(t.counterpartyName);
    if (!k) continue;
    const m = evidence.get(k) ?? new Map<string, number>();
    m.set(t.category, (m.get(t.category) ?? 0) + 1);
    evidence.set(k, m);
  }

  type Group = {
    name: string;
    count: number;
    total: number;
    dirs: Set<string>;
  };
  const groups = new Map<string, Group>();
  let nameless = 0;
  for (const t of uncategorized) {
    const k = t.counterpartyName ? keyOf(t.counterpartyName) : "";
    if (!k) {
      nameless++;
      continue;
    }
    const g = groups.get(k) ??
      { name: t.counterpartyName!.trim(), count: 0, total: 0, dirs: new Set() };
    g.count++;
    g.total += Math.abs(t.amountRwf);
    g.dirs.add(t.direction);
    groups.set(k, g);
  }

  const proposals: StarterProposal[] = [];
  for (const [k, g] of groups) {
    if (g.count < minCount) continue;
    let suggestedCategory: string | null = null;
    let suggestionBasis: string | null = null;
    const ev = evidence.get(k);
    if (ev) {
      const total = [...ev.values()].reduce((a, b) => a + b, 0);
      const [cat, n] = [...ev.entries()].sort((a, b) =>
        b[1] - a[1] || a[0].localeCompare(b[0])
      )[0];
      // At least two examples and a clear majority, or it is not evidence.
      if (n >= 2 && n / total >= 0.7) {
        suggestedCategory = cat;
        suggestionBasis =
          `${n} of your ${total} other transactions with this name are in ${cat}.`;
      }
    }
    proposals.push({
      key: k,
      counterparty: g.name,
      direction: g.dirs.size === 1
        ? ([...g.dirs][0] === "in" ? "in" : "out")
        : "mixed",
      txnCount: g.count,
      totalRwf: g.total,
      suggestedCategory,
      suggestionBasis,
    });
  }
  proposals.sort((a, b) =>
    b.txnCount - a.txnCount || b.totalRwf - a.totalRwf ||
    a.key.localeCompare(b.key)
  );
  const top = proposals.slice(0, max);
  return {
    proposals: top,
    totalProposals: proposals.length,
    totalUncategorized: uncategorized.length,
    coveredCount: top.reduce((s, p) => s + p.txnCount, 0),
    nameless,
  };
}

/** The prefilled "New rule" link for a proposal. */
export function newRuleHref(p: StarterProposal): string {
  const q = new URLSearchParams({
    template: "learned",
    name: `${p.counterparty}`.slice(0, 60),
    pattern: p.counterparty,
  });
  if (p.suggestedCategory) q.set("category", p.suggestedCategory);
  return `/categories/rules/new?${q.toString()}`;
}
