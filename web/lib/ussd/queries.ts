import "server-only";
import { supabaseSession } from "../supabase-session-server";
import type { ParamSpec } from "./capability";
import { DIRECTORY_CATEGORIES, type DirectoryCategory } from "./categories";

// RLS-scoped reads for the USSD directory. Every query goes through the
// session client, so a non-admin only ever sees state='published' rows
// in their effective window (enforced by the Phase M RLS policies) - no
// manual state filtering here, deliberately (same rationale as
// lib/queries.ts's own header comment).

export {
  DIRECTORY_CATEGORIES,
  CATEGORY_LABELS,
  type DirectoryCategory,
} from "./categories";

export type ProviderRow = {
  id: string;
  slug: string;
  display_name: string;
  kind: string;
};

export type ServiceCodeListItem = {
  id: string;
  slug: string;
  category: DirectoryCategory;
  intent: string | null;
  display_name_en: string;
  display_name_rw: string | null;
  ussd_template: string;
  accepts_parameters: boolean;
  supported_networks: string[];
  state: string;
  verified_at: string | null;
  provider: ProviderRow;
};

export type ServiceCodeParameterRow = {
  key: string;
  label_en: string;
  label_rw: string | null;
  kind: ParamSpec["kind"];
  required: boolean;
  position: number;
  format_regex: string | null;
  format_hint_en: string | null;
  format_hint_rw: string | null;
  min_length: number | null;
  max_length: number | null;
};

export type ServiceCodeStepRow = {
  position: number;
  instruction_en: string;
  instruction_rw: string | null;
};

export type ServiceCodeDetail = ServiceCodeListItem & {
  description_en: string | null;
  description_rw: string | null;
  official_source_url: string | null;
  official_source_label: string | null;
  review_due_at: string | null;
  effective_to: string | null;
  risk_text: string | null;
  caution_text: string | null;
  replacement_code_id: string | null;
  replacement_slug: string | null;
  version: number;
  parameters: ServiceCodeParameterRow[];
  steps: ServiceCodeStepRow[];
};

const LIST_COLUMNS =
  "id, slug, category, intent, display_name_en, display_name_rw, ussd_template, accepts_parameters, supported_networks, state, verified_at, provider:service_providers!inner(id, slug, display_name, kind)";

export type DirectoryFilters = {
  query?: string;
  category?: string;
  providerSlug?: string;
};

export async function getServiceDirectory(
  filters: DirectoryFilters = {},
): Promise<ServiceCodeListItem[]> {
  const supabase = await supabaseSession();
  let q = supabase
    .from("service_codes")
    .select(LIST_COLUMNS)
    .order("display_name_en", { ascending: true })
    .limit(200);

  const term = filters.query?.trim();
  if (term) {
    const safe = term.replace(/[%,()]/g, " ").trim();
    if (safe) {
      q = q.or(
        `display_name_en.ilike.%${safe}%,description_en.ilike.%${safe}%,ussd_template.ilike.%${safe}%`,
      );
    }
  }
  if (filters.category && (DIRECTORY_CATEGORIES as readonly string[]).includes(filters.category)) {
    q = q.eq("category", filters.category);
  }
  if (filters.providerSlug) {
    q = q.eq("provider.slug", filters.providerSlug);
  }

  const { data, error } = await q;
  if (error) {
    console.error("getServiceDirectory failed:", error.message);
    return [];
  }
  return (data ?? []) as unknown as ServiceCodeListItem[];
}

export async function getServiceCodeBySlug(
  slug: string,
): Promise<ServiceCodeDetail | null> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("service_codes")
    .select(
      `${LIST_COLUMNS}, description_en, description_rw, official_source_url, official_source_label, review_due_at, effective_to, risk_text, caution_text, replacement_code_id, version,
       replacement:service_codes!service_codes_replacement_code_id_fkey(slug),
       parameters:service_code_parameters(key, label_en, label_rw, kind, required, position, format_regex, format_hint_en, format_hint_rw, min_length, max_length),
       steps:service_code_steps(position, instruction_en, instruction_rw)`,
    )
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.error("getServiceCodeBySlug failed:", error.message);
    return null;
  }
  if (!data) return null;

  const row = data as Record<string, unknown>;
  const replacement = row.replacement as { slug: string } | null;
  const parameters = ((row.parameters as ServiceCodeParameterRow[]) ?? []).sort(
    (a, b) => a.position - b.position,
  );
  const steps = ((row.steps as ServiceCodeStepRow[]) ?? []).sort(
    (a, b) => a.position - b.position,
  );

  return {
    ...(row as unknown as ServiceCodeDetail),
    replacement_slug: replacement?.slug ?? null,
    parameters,
    steps,
  };
}

export type FavouriteListItem = ServiceCodeListItem & { favourited_at: string };

export async function getFavourites(): Promise<FavouriteListItem[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("service_favourites")
    .select(
      `created_at, service_code:service_codes!inner(${LIST_COLUMNS})`,
    )
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("getFavourites failed:", error.message);
    return [];
  }
  return (data ?? [])
    .map((r) => {
      const row = r as Record<string, unknown>;
      const code = row.service_code as ServiceCodeListItem | null;
      if (!code) return null;
      return { ...code, favourited_at: row.created_at as string };
    })
    .filter((x): x is FavouriteListItem => x !== null);
}

export async function getFavouriteCodeIds(): Promise<Set<string>> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("service_favourites")
    .select("service_code_id");
  if (error) return new Set();
  return new Set((data ?? []).map((r) => (r as { service_code_id: string }).service_code_id));
}

export type RecentListItem = ServiceCodeListItem & {
  last_action: string;
  last_used_at: string;
};

export async function getRecentServices(limit = 6): Promise<RecentListItem[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("service_recent_usage")
    .select(`action, occurred_at, service_code:service_codes!inner(${LIST_COLUMNS})`)
    .order("occurred_at", { ascending: false })
    .limit(60);

  if (error) {
    console.error("getRecentServices failed:", error.message);
    return [];
  }

  const seen = new Set<string>();
  const out: RecentListItem[] = [];
  for (const r of data ?? []) {
    const row = r as Record<string, unknown>;
    const code = row.service_code as ServiceCodeListItem | null;
    if (!code || seen.has(code.id)) continue;
    seen.add(code.id);
    out.push({
      ...code,
      last_action: row.action as string,
      last_used_at: row.occurred_at as string,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export async function getActiveProviders(): Promise<ProviderRow[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("service_providers")
    .select("id, slug, display_name, kind")
    .order("display_name", { ascending: true });
  if (error) {
    console.error("getActiveProviders failed:", error.message);
    return [];
  }
  return (data ?? []) as ProviderRow[];
}
