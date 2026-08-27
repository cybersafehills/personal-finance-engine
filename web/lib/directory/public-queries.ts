import "server-only";
import { supabaseSession } from "../supabase-session-server";
import {
  FLOW_LABELS,
  type NetworkOverview,
  type PublicFee,
  type PublicLimit,
  type RouteCardData,
  type RouteFinderOptions,
  type RouteMenuStep,
  type RouteResult,
} from "./public-types";

// RLS-scoped public reads for the payment-network directory (P3). Every
// query goes through the session client, so a non-admin only ever sees
// state='published' rows in their effective window (Phase P RLS policies)
// - no manual state filtering here, matching lib/ussd/queries.ts.
//
// Types + FLOW_LABELS live in ./public-types (client-safe); re-exported
// here so existing server imports keep working.
export { FLOW_LABELS };
export type {
  NetworkOverview,
  PublicFee,
  PublicLimit,
  RouteCardData,
  RouteFinderOptions,
  RouteMenuStep,
  RouteResult,
};

export async function getPublicNetworkBySlug(slug: string): Promise<NetworkOverview | null> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("payment_networks")
    .select(
      `id, slug, canonical_name, display_name_en, description_en, entity_type,
       full_interoperability_effective_date, separate_registration_required, separate_app_required,
       access_channel_summary_en, custody_note_en, official_source_url, official_source_label, verified_at,
       regulatory_authority:regulatory_authorities(name, website_url)`,
    )
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) return null;

  const network = data as Record<string, unknown>;
  const id = network.id as string;

  const [operatorsRes, feesRes, limitsRes, aliasesRes] = await Promise.all([
    supabase
      .from("payment_network_operators")
      .select("operator_role, is_current, service_operator:service_operators(name)")
      .eq("payment_network_id", id)
      .eq("is_current", true),
    supabase.from("route_fees").select("*").eq("scope", "network").eq("payment_network_id", id),
    supabase.from("route_limits").select("*").eq("scope", "network").eq("payment_network_id", id),
    supabase
      .from("directory_aliases")
      .select("alias, is_primary")
      .eq("subject_type", "payment_network")
      .eq("subject_id", id),
  ]);

  return {
    ...(network as unknown as NetworkOverview),
    regulatory_authority:
      (network.regulatory_authority as NetworkOverview["regulatory_authority"]) ?? null,
    operators: ((operatorsRes.data ?? []) as unknown as {
      operator_role: string;
      service_operator: { name: string } | null;
    }[]).map((o) => ({ operator_role: o.operator_role, name: o.service_operator?.name ?? "?" })),
    fees: (feesRes.data ?? []) as unknown as PublicFee[],
    limits: (limitsRes.data ?? []) as unknown as PublicLimit[],
    aliases: ((aliasesRes.data ?? []) as { alias: string; is_primary: boolean }[])
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
      .map((a) => a.alias),
  };
}

export async function getPublishedNetworks(): Promise<
  { slug: string; canonical_name: string; display_name_en: string; entity_type: string }[]
> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("payment_networks")
    .select("slug, canonical_name, display_name_en, entity_type")
    .order("canonical_name");
  if (error) return [];
  return (data ?? []) as {
    slug: string;
    canonical_name: string;
    display_name_en: string;
    entity_type: string;
  }[];
}

export async function searchPaymentNetworks(
  query: string | undefined,
): Promise<{ slug: string; canonical_name: string; display_name_en: string }[]> {
  const term = query?.trim();
  if (!term) return [];
  const supabase = await supabaseSession();

  // Match on the network's own name OR any of its published aliases,
  // normalised the same way the alias trigger normalises them.
  const normalized = term.toLowerCase().replace(/[^a-z0-9]/g, "");
  const safe = term.replace(/[%,()]/g, " ").trim();

  const [byName, byAlias] = await Promise.all([
    safe
      ? supabase
          .from("payment_networks")
          .select("slug, canonical_name, display_name_en")
          .or(`canonical_name.ilike.%${safe}%,display_name_en.ilike.%${safe}%`)
          .limit(10)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    normalized
      ? supabase
          .from("directory_aliases")
          .select("subject_id, subject_type, network:payment_networks(slug, canonical_name, display_name_en)")
          .eq("subject_type", "payment_network")
          .ilike("normalized_alias", `%${normalized}%`)
          .limit(10)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const out = new Map<string, { slug: string; canonical_name: string; display_name_en: string }>();
  for (const n of (byName.data ?? []) as {
    slug: string;
    canonical_name: string;
    display_name_en: string;
  }[]) {
    out.set(n.slug, n);
  }
  for (const row of (byAlias.data ?? []) as {
    network: { slug: string; canonical_name: string; display_name_en: string } | null;
  }[]) {
    if (row.network) out.set(row.network.slug, row.network);
  }
  return [...out.values()];
}

// --- route finder ---------------------------------------------------

export async function getRouteFinderOptions(networkSlug: string): Promise<RouteFinderOptions> {
  const supabase = await supabaseSession();
  const { data: network } = await supabase
    .from("payment_networks")
    .select("id")
    .eq("slug", networkSlug)
    .maybeSingle();
  const networkId = (network as { id: string } | null)?.id ?? null;

  const sources: RouteFinderOptions["sources"] = [];
  if (networkId) {
    const { data } = await supabase
      .from("access_routes")
      .select("provider_id, provider:service_providers(display_name)")
      .eq("payment_network_id", networkId);
    const seen = new Set<string>();
    for (const r of (data ?? []) as unknown as {
      provider_id: string;
      provider: { display_name: string } | null;
    }[]) {
      if (seen.has(r.provider_id)) continue;
      seen.add(r.provider_id);
      sources.push({ provider_id: r.provider_id, display_name: r.provider?.display_name ?? "?" });
    }
  }

  return {
    sources: sources.sort((a, b) => a.display_name.localeCompare(b.display_name)),
    destinationTypes: Object.entries(FLOW_LABELS).map(([value, label]) => ({ value, label })),
  };
}


export async function findRoutes(params: {
  networkSlug: string;
  sourceProviderId?: string;
  flowType?: string;
  channel?: string;
}): Promise<RouteCardData[]> {
  const supabase = await supabaseSession();
  const { data: network } = await supabase
    .from("payment_networks")
    .select("id")
    .eq("slug", params.networkSlug)
    .maybeSingle();
  const networkId = (network as { id: string } | null)?.id;
  if (!networkId) return [];

  let q = supabase
    .from("access_routes")
    .select(
      "id, slug, display_name_en, channel, verified_at, provider:service_providers(display_name), flows:route_supported_flows(flow_type)",
    )
    .eq("payment_network_id", networkId)
    .order("display_name_en");

  if (params.sourceProviderId) q = q.eq("provider_id", params.sourceProviderId);
  if (params.channel) q = q.eq("channel", params.channel);

  const { data, error } = await q;
  if (error) {
    console.error("findRoutes failed:", error.message);
    return [];
  }

  let rows = ((data ?? []) as unknown as {
    id: string;
    slug: string;
    display_name_en: string;
    channel: string;
    verified_at: string | null;
    provider: { display_name: string } | null;
    flows: { flow_type: string }[];
  }[]).map((r) => ({
    id: r.id,
    slug: r.slug,
    display_name_en: r.display_name_en,
    channel: r.channel,
    verified_at: r.verified_at,
    provider_name: r.provider?.display_name ?? "?",
    flow_types: (r.flows ?? []).map((f) => f.flow_type),
  }));

  if (params.flowType) {
    rows = rows.filter((r) => r.flow_types.includes(params.flowType!));
  }
  return rows;
}

// --- route result -------------------------------------------------

export async function getRouteResult(
  networkSlug: string,
  routeId: string,
): Promise<RouteResult | null> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("access_routes")
    .select(
      `id, slug, display_name_en, description_en, channel, internet_required, device_compat,
       approved_entry_point_en, risk_text, caution_text, verified_at, official_source_url, official_source_label,
       provider:service_providers(display_name),
       network:payment_networks(slug, canonical_name),
       service_code:service_codes(slug, ussd_template, accepts_parameters),
       flows:route_supported_flows(flow_type),
       menu_steps:route_menu_steps(position, action_label_en, instruction_en, expected_menu_label_en, expected_option_number, caution_en)`,
    )
    .eq("id", routeId)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as Record<string, unknown>;
  const network = row.network as { slug: string } | null;
  if (network && network.slug !== networkSlug) return null;

  const [feesRes, limitsRes, evidenceRes] = await Promise.all([
    supabase.from("route_fees").select("*").eq("scope", "institution").eq("access_route_id", routeId),
    supabase
      .from("route_limits")
      .select("*")
      .eq("scope", "institution")
      .eq("access_route_id", routeId),
    supabase
      .from("directory_evidence")
      .select(
        "verification_date, is_public, source:directory_sources(organization, title, source_url, is_public)",
      )
      .eq("subject_type", "access_route")
      .eq("subject_id", routeId)
      .order("verification_date", { ascending: false }),
  ]);

  const evidence = (evidenceRes.data ?? []) as unknown as {
    verification_date: string | null;
    is_public: boolean;
    source: { organization: string; title: string | null; source_url: string | null; is_public: boolean } | null;
  }[];
  const publicEv = evidence.find((e) => e.source?.is_public);

  const menuSteps = ((row.menu_steps as RouteMenuStep[]) ?? []).sort(
    (a, b) => a.position - b.position,
  );

  return {
    ...(row as unknown as RouteResult),
    provider_name: (row.provider as { display_name: string } | null)?.display_name ?? "?",
    network: (row.network as RouteResult["network"]) ?? null,
    service_code: (row.service_code as RouteResult["service_code"]) ?? null,
    flow_types: ((row.flows as { flow_type: string }[]) ?? []).map((f) => f.flow_type),
    menu_steps: menuSteps,
    fees: (feesRes.data ?? []) as unknown as PublicFee[],
    limits: (limitsRes.data ?? []) as unknown as PublicLimit[],
    last_verified_evidence_date: publicEv?.verification_date ?? null,
    public_source: publicEv?.source
      ? {
          organization: publicEv.source.organization,
          title: publicEv.source.title,
          source_url: publicEv.source.source_url,
        }
      : null,
  };
}

export async function getRouteFavouriteIds(): Promise<Set<string>> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("service_favourites")
    .select("access_route_id")
    .not("access_route_id", "is", null);
  if (error) return new Set();
  return new Set(
    (data ?? [])
      .map((r) => (r as { access_route_id: string | null }).access_route_id)
      .filter((x): x is string => x != null),
  );
}
