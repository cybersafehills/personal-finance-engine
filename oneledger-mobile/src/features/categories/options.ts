// Pure helpers for the category picker. Category names are free text on
// transactions (like the web's datalist), so the picker offers suggestions
// and also lets the user type a new name.

export const MAX_CATEGORY_LENGTH = 60;

/** Trim, collapse inner whitespace, cap the length. Empty string if unusable. */
export function normalizeCategoryName(input: string): string {
  return input.replace(/\s+/g, " ").trim().slice(0, MAX_CATEGORY_LENGTH).trim();
}

const key = (name: string) => name.toLocaleLowerCase();

/**
 * Suggestions in the order the web uses: the workspace's own category list
 * first (alphabetical), then names already used on transactions (most used
 * first). Case-insensitive de-duplication keeps the first spelling seen;
 * "Uncategorized" is never a choice.
 */
export function mergeCategoryOptions(
  vocabulary: readonly string[],
  usedOnTransactions: readonly (string | null)[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (raw: string | null) => {
    if (raw === null) return;
    const name = normalizeCategoryName(raw);
    if (!name || key(name) === "uncategorized" || seen.has(key(name))) return;
    seen.add(key(name));
    out.push(name);
  };

  [...vocabulary].sort((a, b) => a.localeCompare(b)).forEach(add);

  const counts = new Map<string, { name: string; n: number }>();
  for (const raw of usedOnTransactions) {
    if (raw === null) continue;
    const name = normalizeCategoryName(raw);
    if (!name) continue;
    const entry = counts.get(key(name));
    if (entry) entry.n += 1;
    else counts.set(key(name), { name, n: 1 });
  }
  [...counts.values()]
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
    .forEach((c) => add(c.name));

  return out;
}

export function filterCategoryOptions(options: readonly string[], query: string): string[] {
  const q = key(normalizeCategoryName(query));
  if (!q) return [...options];
  return options.filter((o) => key(o).includes(q));
}

/** The text to offer as "Create …", or null when it already exists / is empty. */
export function newCategoryCandidate(options: readonly string[], query: string): string | null {
  const name = normalizeCategoryName(query);
  if (!name || key(name) === "uncategorized") return null;
  return options.some((o) => key(o) === key(name)) ? null : name;
}
