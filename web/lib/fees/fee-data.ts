import "server-only";
import type { supabaseSession } from "../supabase-session-server";
import { isValidReportTimezone } from "../timezones";
import type {
  FeeSchedule,
  HistorySample,
  LimitRow,
  ProviderTariff,
} from "./fee-estimate";

// Server loaders for the fee calculator. Both read through the caller's
// SESSION client, so RLS is the authorization boundary:
//  - the network schedule is public reference data (payment_networks /
//    route_fees / route_limits are readable by signed-in users);
//  - the history is the caller's own ledger, narrowed to the ACTIVE workspace
//    (RLS alone would return every workspace they belong to) and, in a
//    household, to the sources they may see.
// Every loader throws on a query error: a fee page must never show an estimate
// computed from a partial read.

type Session = Awaited<ReturnType<typeof supabaseSession>>;

export type NetworkFees = {
  slug: string;
  name: string;
  fees: FeeSchedule[];
  limits: LimitRow[];
};

/** Network-scope fees and limits. Institution-level overrides are not included. */
export async function loadNetworkFees(
  supabase: Session,
  slug: string,
): Promise<NetworkFees | null> {
  const { data: net, error } = await supabase
    .from("payment_networks")
    .select("id, slug, canonical_name, display_name_en")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error("fee network query failed");
  if (!net) return null;

  const [fees, limits] = await Promise.all([
    supabase
      .from("route_fees")
      .select(
        "fee_type, fixed_fee_minor, percentage_bps, min_fee_minor, max_fee_minor, currency, effective_from, effective_to, source_url, source_label, note_en",
      )
      .eq("scope", "network")
      .eq("payment_network_id", net.id),
    supabase
      .from("route_limits")
      .select(
        "min_txn_minor, max_txn_minor, daily_limit_minor, currency, is_published_maximum, effective_from, effective_to, source_label",
      )
      .eq("scope", "network")
      .eq("payment_network_id", net.id),
  ]);
  if (fees.error || limits.error) throw new Error("fee schedule query failed");

  return {
    slug: net.slug as string,
    name: (net.display_name_en as string) || (net.canonical_name as string),
    fees: (fees.data ?? []) as FeeSchedule[],
    limits: (limits.data ?? []) as LimitRow[],
  };
}

/** Rows read for history. Beyond this only the newest are used (and the page says so). */
export const HISTORY_ROW_CAP = 1000;

export type FeeHistory = {
  samples: HistorySample[];
  /** True when more than HISTORY_ROW_CAP matching payments exist. */
  capped: boolean;
};

/**
 * Settled outgoing payments of one type and currency, newest first, with the
 * principal and the fee the provider actually charged. Failed, pending,
 * reversed and merged-duplicate rows never count. No counterparty is read.
 */
export async function loadFeeHistory(
  supabase: Session,
  workspaceId: string,
  type: string,
  currency: string,
): Promise<FeeHistory> {
  const { data, error } = await supabase
    .from("transactions")
    .select("amount_rwf, fee_rwf, occurred_at")
    .eq("workspace_id", workspaceId)
    .eq("transaction_type", type)
    .eq("direction", "out")
    .eq("status", "success")
    .eq("settlement_state", "settled")
    .eq("currency", currency)
    .neq("dedupe_state", "merged")
    .order("occurred_at", { ascending: false })
    .limit(HISTORY_ROW_CAP + 1);
  if (error) throw new Error("fee history query failed");

  const rows = data ?? [];
  const capped = rows.length > HISTORY_ROW_CAP;
  const samples: HistorySample[] = [];
  for (const r of capped ? rows.slice(0, HISTORY_ROW_CAP) : rows) {
    const amount = Number(r.amount_rwf);
    const fee = Number(r.fee_rwf);
    // A row without a whole, non-negative amount and fee is not evidence.
    if (
      !Number.isSafeInteger(amount) || !Number.isSafeInteger(fee) ||
      amount <= 0 || fee < 0
    ) continue;
    samples.push({
      amountMinor: BigInt(amount),
      feeMinor: BigInt(fee),
      at: new Date(r.occurred_at as string).toISOString(),
    });
  }
  return { samples, capped };
}

/** The viewer's reporting timezone (profile), falling back to Kigali. */
export async function loadViewerTimezone(
  supabase: Session,
  userId: string,
): Promise<string> {
  const { data } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", userId)
    .maybeSingle();
  const tz = typeof data?.timezone === "string" ? data.timezone : "";
  return isValidReportTimezone(tz) ? tz : "Africa/Kigali";
}

export type TariffProvider = { slug: string; name: string };

/**
 * Providers that have at least one VERIFIED tariff. Clients can only read
 * verified rows (RLS), so an unverified draft never appears here. Empty until
 * the first tariff is loaded - the page then simply has no provider choice.
 */
export async function loadTariffProviders(supabase: Session): Promise<TariffProvider[]> {
  const { data, error } = await supabase
    .from("provider_tariffs")
    .select("service_provider:service_providers(slug, display_name)");
  if (error) throw new Error("tariff providers query failed");
  const seen = new Map<string, TariffProvider>();
  for (const row of (data ?? []) as unknown as {
    service_provider: { slug: string; display_name: string } | null;
  }[]) {
    const p = row.service_provider;
    if (p && !seen.has(p.slug)) seen.set(p.slug, { slug: p.slug, name: p.display_name });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The provider's verified tariffs for one payment type, each with its tiers. */
export async function loadProviderTariffs(
  supabase: Session,
  providerSlug: string,
  type: string,
): Promise<{ slug: string; name: string; tariffs: ProviderTariff[] } | null> {
  const { data: provider, error: pErr } = await supabase
    .from("service_providers")
    .select("id, slug, display_name")
    .eq("slug", providerSlug)
    .maybeSingle();
  if (pErr) throw new Error("tariff provider query failed");
  if (!provider) return null;

  const { data, error } = await supabase
    .from("provider_tariffs")
    .select(
      "transaction_type, recipient_scope, currency, effective_from, effective_to, source_label, source_url, note_en, verified_at, tiers:provider_tariff_tiers(min_amount_minor, max_amount_minor, fee_type, fixed_fee_minor, percentage_bps, min_fee_minor, max_fee_minor)",
    )
    .eq("service_provider_id", provider.id)
    .eq("transaction_type", type);
  if (error) throw new Error("provider tariffs query failed");

  return {
    slug: provider.slug as string,
    name: provider.display_name as string,
    tariffs: (data ?? []) as unknown as ProviderTariff[],
  };
}
