// Pure aggregation for the Reconciliation Center (Phase 3, P3-PR1).
//
// OneLedger already has four separate "these two things disagree, a human
// must decide" queues, each with its own resolution surface:
//
//   * balance drift        -> /transactions/review (per checkpoint)
//   * payment-intent match  -> /pay/reconciliation
//   * import duplicates     -> /transactions/review
//   * connected-workbook    -> /integrations/sync/conflicts
//     sync conflicts
//
// This module takes an already-counted snapshot of each queue and produces
// one ranked model for the Center to render. It is deliberately pure - no
// Supabase, no clock, no `href` computation beyond the static map below -
// so it is unit-testable and cannot leak tenant data. The server-only
// assembler in ./queries.ts is what actually reads the four sources.

export const RECON_SECTION_KEYS = [
  "balance",
  "payments",
  "duplicates",
  "sync_conflicts",
] as const;
export type ReconSectionKey = (typeof RECON_SECTION_KEYS)[number];

export type ReconSeverity = "critical" | "attention" | "clear";

/** One queue's snapshot, as gathered by the server-only assembler. */
export type ReconSectionInput = {
  key: ReconSectionKey;
  /** Open (unresolved) items in this queue. */
  openCount: number;
  /**
   * Subset of `openCount` that is urgent - a hard mismatch or a
   * conflict-state row, as opposed to a merely provisional / "review when
   * you can" item. Defaults to 0.
   */
  criticalCount?: number;
  /** ISO timestamp of the oldest still-open item, or null if none / unknown. */
  oldestActionableAt?: string | null;
  /**
   * False when the underlying data source is not wired up yet (the balance
   * section before the P3-PR2 population job ships). An unavailable section
   * never contributes to counts or severity and renders a "coming soon"
   * note instead of an empty state.
   */
  available: boolean;
};

export type ReconSection = {
  key: ReconSectionKey;
  title: string;
  description: string;
  href: string;
  openCount: number;
  criticalCount: number;
  severity: ReconSeverity;
  oldestActionableAt: string | null;
  available: boolean;
};

export type ReconciliationSummary = {
  /** Ranked most-urgent first; see `compareSections`. */
  sections: ReconSection[];
  /** Sum of `openCount` across available sections only. */
  totalOpen: number;
  /** Sum of `criticalCount` across available sections only. */
  totalCritical: number;
  worstSeverity: ReconSeverity;
  /** True when every available section is clear. */
  allClear: boolean;
};

type SectionMeta = { title: string; description: string; href: string };

// Static, non-tenant metadata. `href` always points at the queue's
// EXISTING resolution surface - the Center never resolves anything itself.
const SECTION_META: Record<ReconSectionKey, SectionMeta> = {
  balance: {
    title: "Balance drift",
    description:
      "Checkpoints where the running ledger balance disagrees with a statement or provider-reported balance.",
    href: "/transactions/review",
  },
  payments: {
    title: "Payment matches",
    description:
      "Payments waiting to be linked to a ledger transaction, or where the observed match conflicts.",
    href: "/pay/reconciliation",
  },
  duplicates: {
    title: "Possible duplicates",
    description:
      "Transactions that share a fingerprint with an existing row and need a keep-or-merge decision.",
    href: "/transactions/review",
  },
  sync_conflicts: {
    title: "Sync conflicts",
    description:
      "Fields that differ between OneLedger and a connected workbook, pending a source-of-truth decision.",
    href: "/integrations/sync/conflicts",
  },
};

const SEVERITY_RANK: Record<ReconSeverity, number> = {
  critical: 0,
  attention: 1,
  clear: 2,
};

function severityFor(input: ReconSectionInput): ReconSeverity {
  if (!input.available) return "clear";
  if ((input.criticalCount ?? 0) > 0) return "critical";
  if (input.openCount > 0) return "attention";
  return "clear";
}

/**
 * Ranking: severity first, then the bigger backlog, then the older item,
 * then a stable key tie-break. Nulls sort last within the timestamp key.
 */
export function compareSections(a: ReconSection, b: ReconSection): number {
  const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (sev !== 0) return sev;

  if (a.openCount !== b.openCount) return b.openCount - a.openCount;

  const at = a.oldestActionableAt ?? "9999-12-31T23:59:59.999Z";
  const bt = b.oldestActionableAt ?? "9999-12-31T23:59:59.999Z";
  return at.localeCompare(bt) || a.key.localeCompare(b.key);
}

/**
 * Builds the ranked Reconciliation Center model from one snapshot per
 * queue. Missing keys are treated as an available, empty section so the
 * Center always renders all four.
 */
export function buildReconciliationSummary(
  inputs: readonly ReconSectionInput[],
): ReconciliationSummary {
  const byKey = new Map<ReconSectionKey, ReconSectionInput>();
  for (const input of inputs) byKey.set(input.key, input);

  const sections: ReconSection[] = RECON_SECTION_KEYS.map((key) => {
    const input = byKey.get(key) ??
      { key, openCount: 0, available: true };
    const criticalCount = Math.min(
      input.criticalCount ?? 0,
      input.openCount,
    );
    return {
      key,
      ...SECTION_META[key],
      openCount: input.available ? input.openCount : 0,
      criticalCount: input.available ? criticalCount : 0,
      severity: severityFor(input),
      oldestActionableAt: input.available
        ? (input.oldestActionableAt ?? null)
        : null,
      available: input.available,
    };
  }).sort(compareSections);

  const totalOpen = sections.reduce((sum, s) => sum + s.openCount, 0);
  const totalCritical = sections.reduce((sum, s) => sum + s.criticalCount, 0);
  const worstSeverity = sections.reduce<ReconSeverity>((worst, s) => {
    return SEVERITY_RANK[s.severity] < SEVERITY_RANK[worst] ? s.severity : worst;
  }, "clear");

  return {
    sections,
    totalOpen,
    totalCritical,
    worstSeverity,
    allClear: totalOpen === 0,
  };
}
