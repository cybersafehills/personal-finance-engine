import "server-only";
import { supabaseSession } from "../supabase-session-server";
import { assertPlatformAdmin } from "../pay/admin";
import type { ServiceCodeDetail } from "./queries";

// Admin reads for the USSD directory. The Phase M RLS policies already
// let a platform admin SELECT every state (published or not), so these
// use the ordinary session client; assertPlatformAdmin() is called first
// only to fail fast with a clean error for a non-admin who somehow
// reaches a page.

export type AdminServiceCodeRow = {
  id: string;
  slug: string;
  display_name_en: string;
  category: string;
  state: string;
  verified_at: string | null;
  review_due_at: string | null;
  version: number;
  updated_at: string;
  provider: { slug: string; display_name: string };
};

export type AdminReportRow = {
  id: string;
  service_code_id: string;
  report_type: string;
  details: string | null;
  status: string;
  created_at: string;
  service_code: { slug: string; display_name_en: string } | null;
};

export type AdminQueue = {
  drafts: AdminServiceCodeRow[];
  pendingReview: AdminServiceCodeRow[];
  reviewDue: AdminServiceCodeRow[];
  openReports: AdminReportRow[];
  publishedCount: number;
};

const ADMIN_LIST_COLUMNS =
  "id, slug, display_name_en, category, state, verified_at, review_due_at, version, updated_at, provider:service_providers(slug, display_name)";

export async function getAdminQueue(): Promise<AdminQueue> {
  await assertPlatformAdmin();
  const supabase = await supabaseSession();

  const [codesRes, reportsRes, publishedRes] = await Promise.all([
    supabase
      .from("service_codes")
      .select(ADMIN_LIST_COLUMNS)
      .order("updated_at", { ascending: false }),
    supabase
      .from("service_code_reports")
      .select(
        "id, service_code_id, report_type, details, status, created_at, service_code:service_codes(slug, display_name_en)",
      )
      .in("status", ["open", "reviewing"])
      .order("created_at", { ascending: false }),
    supabase
      .from("service_codes")
      .select("id", { count: "exact", head: true })
      .eq("state", "published"),
  ]);

  const codes = ((codesRes.data ?? []) as unknown as AdminServiceCodeRow[]) ?? [];
  const nowMs = Date.now();

  return {
    drafts: codes.filter((c) => c.state === "draft"),
    pendingReview: codes.filter((c) => c.state === "pending_review"),
    reviewDue: codes.filter(
      (c) =>
        c.state === "published" &&
        c.review_due_at != null &&
        new Date(c.review_due_at).getTime() <= nowMs,
    ),
    openReports: (reportsRes.data ?? []) as unknown as AdminReportRow[],
    publishedCount: publishedRes.count ?? 0,
  };
}

export async function getAllServiceCodesForAdmin(): Promise<AdminServiceCodeRow[]> {
  await assertPlatformAdmin();
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("service_codes")
    .select(ADMIN_LIST_COLUMNS)
    .order("state", { ascending: true })
    .order("display_name_en", { ascending: true });
  if (error) {
    console.error("getAllServiceCodesForAdmin failed:", error.message);
    return [];
  }
  return (data ?? []) as unknown as AdminServiceCodeRow[];
}

export async function getServiceCodeForEdit(
  id: string,
): Promise<ServiceCodeDetail | null> {
  await assertPlatformAdmin();
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("service_codes")
    .select(
      `id, slug, category, intent, display_name_en, display_name_rw, description_en, description_rw,
       ussd_template, accepts_parameters, supported_networks, state, verified_at, review_due_at, effective_to,
       official_source_url, official_source_label, risk_text, caution_text, replacement_code_id, version,
       provider:service_providers!inner(id, slug, display_name, kind),
       parameters:service_code_parameters(key, label_en, label_rw, kind, required, position, format_regex, format_hint_en, format_hint_rw, min_length, max_length),
       steps:service_code_steps(position, instruction_en, instruction_rw)`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("getServiceCodeForEdit failed:", error.message);
    return null;
  }
  const row = data as Record<string, unknown>;
  const parameters = ((row.parameters as ServiceCodeDetail["parameters"]) ?? []).sort(
    (a, b) => a.position - b.position,
  );
  const steps = ((row.steps as ServiceCodeDetail["steps"]) ?? []).sort(
    (a, b) => a.position - b.position,
  );
  return {
    ...(row as unknown as ServiceCodeDetail),
    replacement_slug: null,
    parameters,
    steps,
  };
}

export type VersionRow = {
  version: number;
  change_reason: string | null;
  created_at: string;
  snapshot: unknown;
};

export async function getVersionHistory(id: string): Promise<VersionRow[]> {
  await assertPlatformAdmin();
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("service_code_versions")
    .select("version, change_reason, created_at, snapshot")
    .eq("service_code_id", id)
    .order("version", { ascending: false });
  if (error) {
    console.error("getVersionHistory failed:", error.message);
    return [];
  }
  return (data ?? []) as VersionRow[];
}

export async function getProvidersForAdmin(): Promise<
  { id: string; slug: string; display_name: string }[]
> {
  await assertPlatformAdmin();
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("service_providers")
    .select("id, slug, display_name")
    .order("display_name", { ascending: true });
  if (error) return [];
  return data ?? [];
}
