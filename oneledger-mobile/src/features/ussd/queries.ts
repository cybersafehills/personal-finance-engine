import { supabase } from "@/api/supabase";
import { activeWorkspace } from "@/features/pay/payment-accounts";

import type { ParamKind } from "./capability";
import {
  DIRECTORY_CATEGORIES,
  type DirectoryCategory,
  type ServiceCodeDetail,
  type ServiceCodeListItem,
} from "./types";

// The USSD directory, read under RLS exactly as the web does
// (web/lib/ussd/queries.ts): a signed-in user only ever sees published codes in
// their effective window, so there is no manual state filtering here.

const LIST_COLUMNS =
  "id, slug, category, display_name_en, ussd_template, accepts_parameters, state, verified_at, provider:service_providers!inner(display_name)";

type ListRow = {
  id: string;
  slug: string;
  category: DirectoryCategory;
  display_name_en: string;
  ussd_template: string;
  accepts_parameters: boolean;
  state: string;
  verified_at: string | null;
  provider: { display_name: string } | { display_name: string }[];
};

export function toListItem(row: ListRow): ServiceCodeListItem {
  const provider = Array.isArray(row.provider) ? row.provider[0] : row.provider;
  return {
    id: row.id,
    slug: row.slug,
    category: row.category,
    name: row.display_name_en,
    template: row.ussd_template,
    acceptsParameters: row.accepts_parameters,
    state: row.state,
    verified: row.verified_at != null,
    provider: provider?.display_name ?? "",
  };
}

/** Characters PostgREST treats as syntax in an `or(...)` filter, removed from a search term. */
export function safeSearchTerm(term: string): string {
  return term.replace(/[%,()]/g, " ").trim();
}

export async function getServiceDirectory(filters: { query?: string; category?: string } = {}): Promise<ServiceCodeListItem[]> {
  if (!supabase) throw new Error("not connected");
  let q = supabase.from("service_codes").select(LIST_COLUMNS).order("display_name_en", { ascending: true }).limit(200);
  const safe = filters.query ? safeSearchTerm(filters.query) : "";
  if (safe) {
    q = q.or(`display_name_en.ilike.%${safe}%,description_en.ilike.%${safe}%,ussd_template.ilike.%${safe}%`);
  }
  if (filters.category && (DIRECTORY_CATEGORIES as string[]).includes(filters.category)) {
    q = q.eq("category", filters.category);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as ListRow[]).map(toListItem);
}

export async function getFavourites(): Promise<ServiceCodeListItem[]> {
  if (!supabase) throw new Error("not connected");
  const { data, error } = await supabase
    .from("service_favourites")
    .select(`created_at, service_code:service_codes!inner(${LIST_COLUMNS})`)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((r) => (r as unknown as { service_code: ListRow | null }).service_code)
    .filter((c): c is ListRow => c !== null)
    .map(toListItem);
}

export async function getFavouriteIds(): Promise<Set<string>> {
  if (!supabase) throw new Error("not connected");
  const { data, error } = await supabase.from("service_favourites").select("service_code_id");
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => (r as { service_code_id: string }).service_code_id));
}

const DETAIL_SELECT = `${LIST_COLUMNS}, description_en, official_source_url, official_source_label, risk_text, caution_text, replacement_code_id,
  parameters:service_code_parameters(key, label_en, kind, required, position, format_regex, format_hint_en, min_length, max_length),
  steps:service_code_steps(position, instruction_en)`;

export async function getServiceCodeBySlug(slug: string): Promise<ServiceCodeDetail | null> {
  if (!supabase) throw new Error("not connected");
  const { data, error } = await supabase.from("service_codes").select(DETAIL_SELECT).eq("slug", slug).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as unknown as ListRow & {
    description_en: string | null;
    official_source_url: string | null;
    official_source_label: string | null;
    risk_text: string | null;
    caution_text: string | null;
    replacement_code_id: string | null;
    parameters: {
      key: string;
      label_en: string;
      kind: ParamKind;
      required: boolean;
      position: number;
      format_regex: string | null;
      format_hint_en: string | null;
      min_length: number | null;
      max_length: number | null;
    }[];
    steps: { position: number; instruction_en: string }[];
  };

  // No self-referential embed (PostgREST can't resolve it): a second query.
  let replacementSlug: string | null = null;
  if (row.replacement_code_id) {
    const { data: r } = await supabase.from("service_codes").select("slug").eq("id", row.replacement_code_id).maybeSingle();
    replacementSlug = (r as { slug: string } | null)?.slug ?? null;
  }

  return {
    ...toListItem(row),
    description: row.description_en,
    sourceLabel: row.official_source_label,
    sourceUrl: row.official_source_url,
    riskText: row.risk_text,
    cautionText: row.caution_text,
    replacementSlug,
    parameters: (row.parameters ?? [])
      .map((p) => ({
        key: p.key,
        kind: p.kind,
        label: p.label_en,
        required: p.required,
        position: p.position,
        formatRegex: p.format_regex,
        formatHint: p.format_hint_en,
        minLength: p.min_length,
        maxLength: p.max_length,
      }))
      .sort((a, b) => a.position - b.position),
    steps: (row.steps ?? []).sort((a, b) => a.position - b.position).map((s) => s.instruction_en),
  };
}

/** Star or unstar a code. Returns the new state. Never executes a payment. */
export async function toggleFavourite(serviceCodeId: string, currentlyFavourite: boolean): Promise<boolean> {
  if (!supabase) throw new Error("not connected");
  if (currentlyFavourite) {
    const { error } = await supabase.from("service_favourites").delete().eq("service_code_id", serviceCodeId);
    if (error) throw new Error(error.message);
    return false;
  }
  const { workspaceId, userId } = await activeWorkspace();
  const { error } = await supabase
    .from("service_favourites")
    .insert({ user_id: userId, workspace_id: workspaceId, service_code_id: serviceCodeId });
  if (error) throw new Error(error.message);
  return true;
}

export const REPORT_TYPES = {
  incorrect_code: "The code is wrong",
  outdated: "The code is out of date",
  wrong_prerequisites: "The listed prerequisites are wrong",
  provider_changed: "The provider changed this service",
  other: "Something else",
} as const;
export type ReportType = keyof typeof REPORT_TYPES;

/** File a "this code is wrong" report; the database rate-limits it. Returns an error message, or null on success. */
export async function reportServiceCode(serviceCodeId: string, reportType: ReportType, details: string): Promise<string | null> {
  if (!supabase) return "This build isn't connected to OneLedger yet.";
  try {
    const { workspaceId, userId } = await activeWorkspace();
    const { error } = await supabase.from("service_code_reports").insert({
      service_code_id: serviceCodeId,
      reporter_user_id: userId,
      workspace_id: workspaceId,
      report_type: reportType,
      details: details.trim().slice(0, 2000) || null,
    });
    if (!error) return null;
    return /rate_limited/i.test(error.message)
      ? "You've sent several reports recently. Try again in a little while."
      : "Could not send your report.";
  } catch {
    return "Could not send your report.";
  }
}
