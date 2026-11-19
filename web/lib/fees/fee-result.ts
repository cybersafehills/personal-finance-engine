// One place that turns loaded evidence into the fee answer, used by BOTH the web
// page and GET /api/mobile/fees/estimate so the two can never disagree.
// PURE: no I/O. See fee-estimate.ts for the rules.

import {
  estimateFromHistory,
  estimatePublishedFee,
  type FeeSchedule,
  type HistoryEstimate,
  type HistorySample,
  limitWarnings,
  type LimitRow,
  type LimitWarning,
  pickSchedule,
  type PublishedEstimate,
} from "./fee-estimate.ts";

export const FEE_DISCLAIMER =
  "These are estimates, not guarantees. Fees are set by your provider and can change; check with them before you pay. OneLedger does not charge this fee, does not move money, and will not suggest splitting a payment to get around a limit.";

export type PublishedSection = {
  network: { slug: string; name: string };
  /** False when the network publishes no fee row at all. */
  hasSchedule: boolean;
  scheduleState: "yes" | "not_yet" | "expired" | null;
  schedule: FeeSchedule | null;
  estimate: PublishedEstimate | null;
  warnings: LimitWarning[];
};

export type FeeResult = {
  amountMinor: bigint;
  currency: string;
  type: string;
  history: HistoryEstimate;
  /** True when more matching payments exist than were read. */
  historyCapped: boolean;
  published: PublishedSection | null;
};

export function buildFeeResult(input: {
  amountMinor: bigint;
  currency: string;
  type: string;
  history: { samples: readonly HistorySample[]; capped: boolean };
  network: {
    slug: string;
    name: string;
    fees: readonly FeeSchedule[];
    limits: readonly LimitRow[];
  } | null;
  now: Date;
}): FeeResult {
  const { amountMinor, currency, now } = input;
  let published: PublishedSection | null = null;
  if (input.network) {
    const picked = pickSchedule(input.network.fees, now);
    published = {
      network: { slug: input.network.slug, name: input.network.name },
      hasSchedule: picked !== null,
      scheduleState: picked ? picked.state : null,
      schedule: picked ? picked.schedule : null,
      estimate: picked
        ? estimatePublishedFee(picked.schedule, amountMinor, currency, now)
        : null,
      warnings: limitWarnings(input.network.limits, amountMinor, currency, now),
    };
  }
  return {
    amountMinor,
    currency,
    type: input.type,
    history: estimateFromHistory(input.history.samples, amountMinor),
    historyCapped: input.history.capped,
    published,
  };
}

// ---------------------------- JSON for the app -----------------------------

const s = (v: bigint | null): string | null => v === null ? null : v.toString();

function publishedJson(e: PublishedEstimate | null) {
  if (!e) return null;
  switch (e.status) {
    case "exact":
      return { status: "exact", fee_minor: s(e.feeMinor) };
    case "range":
      return { status: "range", min_minor: s(e.minMinor), max_minor: s(e.maxMinor) };
    case "upper_bound":
      return { status: "upper_bound", max_minor: s(e.maxMinor) };
    case "not_computable":
      return { status: "not_computable", reason: e.reason };
    case "not_in_effect":
      return { status: "not_in_effect", reason: e.reason };
  }
}

/** All amounts as decimal strings (bigint-safe), timestamps ISO. */
export function serializeFeeResult(r: FeeResult) {
  const h = r.history;
  return {
    amount_minor: s(r.amountMinor),
    currency: r.currency,
    transaction_type: r.type,
    history: h.status === "estimate"
      ? {
        status: "estimate",
        basis: "your_past_payments",
        min_minor: s(h.minMinor),
        max_minor: s(h.maxMinor),
        typical_minor: s(h.typicalMinor),
        count: h.count,
        similar_amount_low_minor: s(h.windowLowMinor),
        similar_amount_high_minor: s(h.windowHighMinor),
        first_at: h.firstAt,
        last_at: h.lastAt,
        capped: r.historyCapped,
        recent: h.recent.map((x) => ({
          amount_minor: s(x.amountMinor),
          fee_minor: s(x.feeMinor),
          at: x.at,
        })),
      }
      : h.status === "not_enough_history"
      ? {
        status: "not_enough_history",
        similar_count: h.similarCount,
        total_count: h.totalCount,
      }
      : { status: "no_history" },
    published: r.published
      ? {
        network: r.published.network,
        has_schedule: r.published.hasSchedule,
        schedule_state: r.published.scheduleState,
        fee_type: r.published.schedule?.fee_type ?? null,
        estimate: publishedJson(r.published.estimate),
        source_label: r.published.schedule?.source_label ?? null,
        source_url: r.published.schedule?.source_url ?? null,
        effective_from: r.published.schedule?.effective_from ?? null,
        effective_to: r.published.schedule?.effective_to ?? null,
        note: r.published.schedule?.note_en ?? null,
        limit_warnings: r.published.warnings.map((w) => ({
          kind: w.kind,
          limit_minor: s(w.limitMinor),
          published_maximum: w.publishedMaximum,
        })),
      }
      : null,
    disclaimer: FEE_DISCLAIMER,
  };
}
