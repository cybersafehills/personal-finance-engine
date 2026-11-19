/** The first sentence of a longer description: the one line worth showing before you dial. */
export function firstSentence(text: string | null): string | null {
  if (!text) return null;
  const match = text.trim().match(/^.*?[.!?](\s|$)/);
  return (match ? match[0] : text).trim();
}
