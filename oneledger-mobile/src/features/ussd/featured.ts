// Codes that go first in the directory regardless of alphabetical order: the ones
// most people open the directory for. Matched by slug (a stable identifier in the
// published directory); a slug that is not in the list is simply not pinned.
export const FEATURED_SLUGS: readonly string[] = [
  // MTN eKash entry code (*182*1*2#): send money to a bank account or a Mobile Money wallet.
  "ekash-mtn-rwanda",
];

/** The same list with the featured codes first (in their listed order); everything else keeps its order. */
export function pinFeatured<T extends { slug: string }>(codes: readonly T[]): T[] {
  const rank = (slug: string) => {
    const i = FEATURED_SLUGS.indexOf(slug);
    return i === -1 ? FEATURED_SLUGS.length : i;
  };
  return codes
    .map((code, index) => ({ code, index }))
    .sort((a, b) => rank(a.code.slug) - rank(b.code.slug) || a.index - b.index)
    .map((x) => x.code);
}
