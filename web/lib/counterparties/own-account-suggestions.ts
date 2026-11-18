// Finding the counterparties that are probably YOU. PURE (no imports) so it is
// unit-tested with `deno test`.
//
// It only SUGGESTS: nothing is marked until the person taps "This is me". Two sources:
//  1. Name match: a counterparty whose name words are the same as, or inside, your
//     profile name's words (>= 2 words in common), e.g. "ANNA KAMANZI" and the doubled
//     "ANNA KAMANZI ANNA KAMANZI" that some banks print for own-account transfers.
//  2. Biggest senders: the largest sources of money in, which is where an own-account
//     top-up would distort "your usual income". Shown with the amount so you can judge.

export type OwnAccountCandidate = {
  id: string;
  name: string;
  kind: string;
  /** Total received from this counterparty, whole RWF. */
  receivedRwf: number;
  sentRwf: number;
  txnCount: number;
};

export type OwnAccountSuggestion = {
  id: string;
  name: string;
  reason: string;
  receivedRwf: number;
  sentRwf: number;
  txnCount: number;
};

const words = (s: string): string[] =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z]+/).filter(
    (w) => w.length > 0,
  );

/** Words in common, ignoring repeats ("anna kamanzi anna kamanzi" -> 2 words). */
function sharedWordCount(a: readonly string[], b: readonly string[]): number {
  const bs = new Set(b);
  return new Set(a.filter((w) => bs.has(w))).size;
}

export function suggestByName(
  candidates: readonly OwnAccountCandidate[],
  profileName: string | null,
  max = 5,
): OwnAccountSuggestion[] {
  const mine = profileName ? words(profileName) : [];
  if (new Set(mine).size < 2) return [];
  const out: OwnAccountSuggestion[] = [];
  for (const c of candidates) {
    if (c.kind === "self" || c.kind === "merchant") continue;
    const theirs = words(c.name);
    const shared = sharedWordCount(theirs, mine);
    // Every one of their words is one of mine, and at least two of mine appear.
    if (shared >= 2 && new Set(theirs).size === shared) {
      out.push({
        id: c.id,
        name: c.name,
        reason: "Matches your name",
        receivedRwf: c.receivedRwf,
        sentRwf: c.sentRwf,
        txnCount: c.txnCount,
      });
    }
  }
  return out.sort((a, b) =>
    b.txnCount - a.txnCount || a.name.localeCompare(b.name)
  ).slice(0, max);
}

/** The largest sources of money in (people and unknowns only), biggest first. */
export function topSourcesOfMoneyIn(
  candidates: readonly OwnAccountCandidate[],
  max = 5,
): OwnAccountSuggestion[] {
  return candidates
    .filter((c) =>
      c.kind !== "self" && c.kind !== "merchant" && c.receivedRwf > 0
    )
    .sort((a, b) =>
      b.receivedRwf - a.receivedRwf || a.name.localeCompare(b.name)
    )
    .slice(0, max)
    .map((c) => ({
      id: c.id,
      name: c.name,
      reason: "A large source of money in",
      receivedRwf: c.receivedRwf,
      sentRwf: c.sentRwf,
      txnCount: c.txnCount,
    }));
}
