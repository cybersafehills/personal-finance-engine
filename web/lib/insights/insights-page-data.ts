// Server-side loader for the Insights Center. Reads through the SESSION
// client, so RLS (workspace membership + per-Space source visibility) is the
// authorization boundary; the explicit workspace filter below only narrows
// to the ACTIVE workspace, because RLS alone returns every workspace the
// caller belongs to (same reasoning as getBudgetActuals).
//
// Correctness rules (docs/oneledger-3/s6-insights-page.md):
//  - never compute from a partial read: any query error or hitting the row
//    cap returns a failure state, not smaller totals;
//  - PostgREST caps a response at 1000 rows, so both transactions AND
//    transfer links are paged with a stable order. A truncated link set
//    would silently turn own-wallet transfers into income and spending.

import "server-only";
import { getActiveWorkspaceId } from "../queries";
import { supabaseSession } from "../supabase-session-server";
import { isValidReportTimezone } from "../timezones";
import { linkedTransferIdSet } from "../transfer-exclusion";
import {
  buildEffectiveMap,
  type CounterpartyRef,
  resolveCounterparty,
} from "../counterparties/effective";
import type { InsightFact } from "./insights-math";
import {
  emptyExcluded,
  type ExcludedCounts,
  type InsightRow,
  toInsightFact,
} from "./insights-facts";
import { isInsightsCenterEnabledFor } from "./insights-flag";

const PAGE = 1000;
/** Rows in [comparison start, period end). Beyond this we refuse, not truncate. */
export const MAX_INSIGHT_ROWS = 50_000;
const MAX_LINK_ROWS = 50_000;
const MAX_COUNTERPARTY_ROWS = 50_000;
export const DEFAULT_TIMEZONE = "Africa/Kigali";

const INSIGHT_COLUMNS =
  "id, direction, transaction_type, currency, amount_rwf, fee_rwf, principal_effect_rwf, fee_effect_rwf, category, counterparty_id, counterparty_name, financial_source_id, settlement_state, occurred_at";

type Session = Awaited<ReturnType<typeof supabaseSession>>;

export type InsightsContext = {
  workspaceId: string;
  timezone: string;
};

/** Null when the feature is off for this workspace or nobody is signed in. */
export async function getInsightsContext(): Promise<InsightsContext | null> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) return null;
  if (
    !isInsightsCenterEnabledFor(
      {
        INSIGHTS_CENTER_ENABLED: process.env.INSIGHTS_CENTER_ENABLED,
        INSIGHTS_CENTER_WORKSPACE_ALLOWLIST:
          process.env.INSIGHTS_CENTER_WORKSPACE_ALLOWLIST,
      },
      workspaceId,
    )
  ) {
    return null;
  }

  const supabase = await supabaseSession();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", auth.user.id)
    .maybeSingle();
  const tz = typeof profile?.timezone === "string" ? profile.timezone : "";
  return {
    workspaceId,
    timezone: isValidReportTimezone(tz) ? tz : DEFAULT_TIMEZONE,
  };
}

/** For entry-point links on other pages (no profile read). */
export async function isInsightsCenterEnabled(): Promise<boolean> {
  return isInsightsCenterEnabledFor(
    {
      INSIGHTS_CENTER_ENABLED: process.env.INSIGHTS_CENTER_ENABLED,
      INSIGHTS_CENTER_WORKSPACE_ALLOWLIST:
        process.env.INSIGHTS_CENTER_WORKSPACE_ALLOWLIST,
    },
    // Skip the workspace lookup entirely while the feature is dark.
    process.env.INSIGHTS_CENTER_ENABLED === "true"
      ? await getActiveWorkspaceId()
      : null,
  );
}

export type InsightSource = { sourceId: string; label: string };

export type InsightsDataset = {
  facts: InsightFact[];
  linked: Set<string>;
  excluded: ExcludedCounts;
  sources: InsightSource[];
  /** Whole-workspace bounds (not just the fetched window). */
  earliestTxnAt: string | null;
  latestTxnAt: string | null;
  computedAt: string;
};

export type InsightsLoad =
  | { ok: true; data: InsightsDataset }
  | { ok: false; reason: "error" | "too_many_rows" };

async function fetchRows(
  supabase: Session,
  workspaceId: string,
  fromIso: string,
  toIso: string,
): Promise<InsightRow[] | "too_many_rows"> {
  const rows: InsightRow[] = [];
  // Advance by what was actually returned and stop only on an EMPTY page:
  // the server's own row cap (PostgREST max-rows) may be lower than PAGE,
  // and "a short page means the last page" would then truncate silently.
  for (let offset = 0;; offset = rows.length) {
    const { data, error } = await supabase
      .from("transactions")
      .select(INSIGHT_COLUMNS)
      .eq("workspace_id", workspaceId)
      // A merged duplicate is kept as evidence but never counted.
      .neq("dedupe_state", "merged")
      .gte("occurred_at", fromIso)
      .lt("occurred_at", toIso)
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`insights transactions: ${error.message}`);
    if (!data || data.length === 0) return rows;
    rows.push(...(data as InsightRow[]));
    if (rows.length > MAX_INSIGHT_ROWS) return "too_many_rows";
  }
}

async function fetchLinkedIds(
  supabase: Session,
  workspaceId: string,
): Promise<Set<string> | "too_many_rows"> {
  const links: { out_transaction_id: string; in_transaction_id: string }[] = [];
  for (let offset = 0;; offset = links.length) {
    const { data, error } = await supabase
      .from("transfer_links")
      .select("out_transaction_id, in_transaction_id")
      .eq("workspace_id", workspaceId)
      .eq("status", "linked")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`insights transfer links: ${error.message}`);
    if (!data || data.length === 0) return linkedTransferIdSet(links);
    links.push(...data);
    if (links.length > MAX_LINK_ROWS) return "too_many_rows";
  }
}

async function fetchCounterparties(
  supabase: Session,
  workspaceId: string,
): Promise<CounterpartyRef[] | "too_many_rows"> {
  const out: CounterpartyRef[] = [];
  for (let offset = 0;; offset = out.length) {
    const { data, error } = await supabase
      .from("counterparties")
      .select("id, display_name, merged_into_id")
      .eq("workspace_id", workspaceId)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`insights counterparties: ${error.message}`);
    if (!data || data.length === 0) return out;
    out.push(...(data as CounterpartyRef[]));
    if (out.length > MAX_COUNTERPARTY_ROWS) return "too_many_rows";
  }
}

async function fetchBound(
  supabase: Session,
  workspaceId: string,
  ascending: boolean,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("transactions")
    .select("occurred_at")
    .eq("workspace_id", workspaceId)
    .neq("dedupe_state", "merged")
    .order("occurred_at", { ascending })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`insights bounds: ${error.message}`);
  return data?.occurred_at ? new Date(data.occurred_at).toISOString() : null;
}

async function fetchSources(
  supabase: Session,
  workspaceId: string,
): Promise<InsightSource[]> {
  const { data, error } = await supabase
    .from("accounts")
    .select("name, financial_source_id, is_primary, created_at")
    .eq("workspace_id", workspaceId)
    .not("financial_source_id", "is", null)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(`insights accounts: ${error.message}`);
  const seen = new Set<string>();
  const out: InsightSource[] = [];
  for (const a of data ?? []) {
    const id = a.financial_source_id as string;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ sourceId: id, label: a.name });
  }
  return out;
}

/**
 * Everything the page needs for [fromIso, toIso) - pass the comparison
 * window's start as `fromIso` to load both periods in one read.
 */
export async function loadInsightsDataset(
  ctx: InsightsContext,
  fromIso: string,
  toIso: string,
  /** Excluded rows are tallied from here on (the current period's start). */
  countExcludedFromIso: string = fromIso,
): Promise<InsightsLoad> {
  try {
    const supabase = await supabaseSession();
    const [rows, linked, counterparties, sources, earliest, latest] = await Promise.all([
      fetchRows(supabase, ctx.workspaceId, fromIso, toIso),
      fetchLinkedIds(supabase, ctx.workspaceId),
      fetchCounterparties(supabase, ctx.workspaceId),
      fetchSources(supabase, ctx.workspaceId),
      fetchBound(supabase, ctx.workspaceId, true),
      fetchBound(supabase, ctx.workspaceId, false),
    ]);
    if (
      rows === "too_many_rows" || linked === "too_many_rows" ||
      counterparties === "too_many_rows"
    ) {
      return { ok: false, reason: "too_many_rows" };
    }
    // Resolve merged counterparties to their survivors so a merge changes the
    // grouping and the displayed name, exactly as in the counterparty list and
    // the mobile Insights routes.
    const effective = buildEffectiveMap(counterparties);
    const facts: InsightFact[] = [];
    const excluded = emptyExcluded();
    for (const row of rows) {
      const m = toInsightFact(row);
      if ("fact" in m) {
        facts.push({
          ...m.fact,
          ...resolveCounterparty(row.counterparty_id ?? null, m.fact.counterpartyName, effective),
        });
      }
      else if (
        new Date(row.occurred_at).toISOString() >= countExcludedFromIso
      ) {
        excluded[m.excluded]++;
      }
    }
    return {
      ok: true,
      data: {
        facts,
        linked,
        excluded,
        sources,
        earliestTxnAt: earliest,
        latestTxnAt: latest,
        computedAt: new Date().toISOString(),
      },
    };
  } catch (e) {
    // Message only - never row contents.
    console.error(
      "loadInsightsDataset failed:",
      e instanceof Error ? e.message : "unknown error",
    );
    return { ok: false, reason: "error" };
  }
}
