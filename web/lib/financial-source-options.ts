import type { FinancialSourceRow } from "./queries";

/**
 * Compact {id, label} options for a financial-source picker (Phase U PR6
 * rule scope). Label is the display name plus, when present, the masked
 * identifier - enough to tell two accounts on the same provider apart.
 */
export function financialSourceOptions(
  sources: FinancialSourceRow[],
): Array<{ id: string; label: string }> {
  return sources.map((s) => ({
    id: s.id,
    label: s.maskedIdentifier
      ? `${s.displayName} · ${s.maskedIdentifier}`
      : s.displayName,
  }));
}
