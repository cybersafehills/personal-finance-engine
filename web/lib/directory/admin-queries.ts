import "server-only";
import { supabaseSession } from "../supabase-session-server";
import { assertDirectoryAdmin } from "../pay/directory-perms";

// Admin reads for the Phase P payment-network directory. The Phase P RLS
// policies already let a directory.view_admin holder SELECT every state,
// so these use the ordinary RLS-scoped session client; assertDirectoryAdmin()
// is called first only to fail fast for someone who reaches a page without
// any directory grant.

const LIFECYCLE_STATES = [
  "draft",
  "pending_review",
  "published",
  "temporarily_unavailable",
  "deprecated",
  "archived",
] as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export type NetworkRow = {
  id: string;
  slug: string;
  canonical_name: string;
  display_name_en: string;
  entity_type: string;
  state: string;
  verified_at: string | null;
  review_due_at: string | null;
  version: number;
  updated_at: string;
};

export type ParticipationRow = {
  id: string;
  participant_role: string;
  state: string;
  verified_at: string | null;
  review_due_at: string | null;
  version: number;
  provider: { slug: string; display_name: string } | null;
  network: { slug: string; canonical_name: string } | null;
};

export type RouteRow = {
  id: string;
  slug: string;
  channel: string;
  display_name_en: string;
  state: string;
  verified_at: string | null;
  review_due_at: string | null;
  version: number;
  provider: { slug: string; display_name: string } | null;
  network: { slug: string; canonical_name: string } | null;
};

export type AuditRow = {
  id: string;
  action: string;
  subject_type: string | null;
  subject_id: string | null;
  reason: string | null;
  created_at: string;
};

const NETWORK_COLS =
  "id, slug, canonical_name, display_name_en, entity_type, state, verified_at, review_due_at, version, updated_at";
const PARTICIPATION_COLS =
  "id, participant_role, state, verified_at, review_due_at, version, provider:service_providers(slug, display_name), network:payment_networks(slug, canonical_name)";
const ROUTE_COLS =
  "id, slug, channel, display_name_en, state, verified_at, review_due_at, version, provider:service_providers(slug, display_name), network:payment_networks(slug, canonical_name)";

function isReviewDue(state: string, reviewDueAt: string | null, nowMs: number): boolean {
  return (
    state === "published" &&
    reviewDueAt != null &&
    new Date(reviewDueAt).getTime() <= nowMs
  );
}

export type DirectoryDashboard = {
  networks: NetworkRow[];
  participation: ParticipationRow[];
  routes: RouteRow[];
  recentAudit: AuditRow[];
  counts: {
    networksPublished: number;
    drafts: number;
    pendingReview: number;
    reviewDue: number;
    unverifiedPublished: number;
    withoutEvidence: number;
  };
};

export async function getDirectoryDashboard(): Promise<DirectoryDashboard> {
  await assertDirectoryAdmin();
  const supabase = await supabaseSession();

  const [networksRes, participationRes, routesRes, auditRes, evidenceRes] = await Promise.all([
    supabase.from("payment_networks").select(NETWORK_COLS).order("updated_at", { ascending: false }),
    supabase
      .from("institution_network_participation")
      .select(PARTICIPATION_COLS)
      .order("updated_at", { ascending: false }),
    supabase.from("access_routes").select(ROUTE_COLS).order("updated_at", { ascending: false }),
    supabase
      .from("service_directory_audit_events")
      .select("id, action, subject_type, subject_id, reason, created_at")
      .not("subject_type", "is", null)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("directory_evidence").select("subject_type, subject_id"),
  ]);

  const networks = (networksRes.data ?? []) as unknown as NetworkRow[];
  const participation = (participationRes.data ?? []) as unknown as ParticipationRow[];
  const routes = (routesRes.data ?? []) as unknown as RouteRow[];
  const nowMs = Date.now();

  const evidenceKeys = new Set(
    ((evidenceRes.data ?? []) as { subject_type: string; subject_id: string }[]).map(
      (e) => `${e.subject_type}:${e.subject_id}`,
    ),
  );
  const lifecycled: { type: string; id: string; state: string }[] = [
    ...networks.map((n) => ({ type: "payment_network", id: n.id, state: n.state })),
    ...participation.map((p) => ({ type: "institution_participation", id: p.id, state: p.state })),
    ...routes.map((r) => ({ type: "access_route", id: r.id, state: r.state })),
  ];

  const all = [...networks, ...participation, ...routes];

  return {
    networks,
    participation,
    routes,
    recentAudit: (auditRes.data ?? []) as AuditRow[],
    counts: {
      networksPublished: networks.filter((n) => n.state === "published").length,
      drafts: all.filter((x) => x.state === "draft").length,
      pendingReview: all.filter((x) => x.state === "pending_review").length,
      reviewDue: all.filter((x) => isReviewDue(x.state, x.review_due_at, nowMs)).length,
      unverifiedPublished: all.filter((x) => x.state === "published" && x.verified_at == null)
        .length,
      withoutEvidence: lifecycled.filter(
        (x) =>
          x.state !== "draft" &&
          x.state !== "archived" &&
          !evidenceKeys.has(`${x.type}:${x.id}`),
      ).length,
    },
  };
}

// --- payment networks --------------------------------------------------

export async function listPaymentNetworks(): Promise<NetworkRow[]> {
  await assertDirectoryAdmin();
  const supabase = await supabaseSession();
  const { data } = await supabase
    .from("payment_networks")
    .select(NETWORK_COLS)
    .order("state")
    .order("canonical_name");
  return (data ?? []) as unknown as NetworkRow[];
}

export type NetworkDetail = Record<string, unknown> & {
  id: string;
  slug: string;
  state: string;
  canonical_name: string;
  operators: Record<string, unknown>[];
  aliases: { id: string; alias: string; is_primary: boolean }[];
  fees: Record<string, unknown>[];
  limits: Record<string, unknown>[];
  evidence: EvidenceRow[];
  versions: VersionRow[];
};

export async function getPaymentNetworkForEdit(id: string): Promise<NetworkDetail | null> {
  await assertDirectoryAdmin();
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("payment_networks")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;

  const [operatorsRes, aliasesRes, feesRes, limitsRes, evidenceRes, versionsRes] =
    await Promise.all([
      supabase
        .from("payment_network_operators")
        .select(
          "id, operator_role, is_current, effective_from, effective_to, verified_at, service_operator:service_operators(slug, name)",
        )
        .eq("payment_network_id", id)
        .order("effective_from", { ascending: false }),
      supabase
        .from("directory_aliases")
        .select("id, alias, is_primary")
        .eq("subject_type", "payment_network")
        .eq("subject_id", id)
        .order("alias"),
      supabase.from("route_fees").select("*").eq("scope", "network").eq("payment_network_id", id),
      supabase.from("route_limits").select("*").eq("scope", "network").eq("payment_network_id", id),
      getEvidence("payment_network", id),
      getVersions("payment_network", id),
    ]);

  return {
    ...(data as Record<string, unknown>),
    id: (data as { id: string }).id,
    slug: (data as { slug: string }).slug,
    state: (data as { state: string }).state,
    canonical_name: (data as { canonical_name: string }).canonical_name,
    operators: (operatorsRes.data ?? []) as Record<string, unknown>[],
    aliases: (aliasesRes.data ?? []) as { id: string; alias: string; is_primary: boolean }[],
    fees: (feesRes.data ?? []) as Record<string, unknown>[],
    limits: (limitsRes.data ?? []) as Record<string, unknown>[],
    evidence: evidenceRes,
    versions: versionsRes,
  };
}

// --- institutions & participation ------------------------------------

export type InstitutionRow = {
  id: string;
  slug: string;
  display_name: string;
  kind: string;
  emoney_issuer: boolean;
  participation: { id: string; state: string; network_slug: string }[];
};

export async function listInstitutions(): Promise<InstitutionRow[]> {
  await assertDirectoryAdmin();
  const supabase = await supabaseSession();
  const [providersRes, participationRes] = await Promise.all([
    supabase
      .from("service_providers")
      .select("id, slug, display_name, kind, emoney_issuer")
      .order("display_name"),
    supabase
      .from("institution_network_participation")
      .select("id, state, provider_id, network:payment_networks(slug)"),
  ]);

  const byProvider = new Map<string, { id: string; state: string; network_slug: string }[]>();
  for (const p of (participationRes.data ?? []) as unknown as {
    id: string;
    state: string;
    provider_id: string;
    network: { slug: string } | null;
  }[]) {
    const list = byProvider.get(p.provider_id) ?? [];
    list.push({ id: p.id, state: p.state, network_slug: p.network?.slug ?? "?" });
    byProvider.set(p.provider_id, list);
  }

  return ((providersRes.data ?? []) as Omit<InstitutionRow, "participation">[]).map((row) => ({
    ...row,
    participation: byProvider.get(row.id) ?? [],
  }));
}

export async function getParticipationForEdit(
  id: string,
): Promise<
  | (Record<string, unknown> & { id: string; evidence: EvidenceRow[]; versions: VersionRow[] })
  | null
> {
  await assertDirectoryAdmin();
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("institution_network_participation")
    .select(
      "*, provider:service_providers(id, slug, display_name), network:payment_networks(id, slug, canonical_name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const [evidence, versions] = await Promise.all([
    getEvidence("institution_participation", id),
    getVersions("institution_participation", id),
  ]);
  return { ...(data as Record<string, unknown>), id, evidence, versions };
}

// --- access routes --------------------------------------------------

export async function listAccessRoutes(): Promise<RouteRow[]> {
  await assertDirectoryAdmin();
  const supabase = await supabaseSession();
  const { data } = await supabase
    .from("access_routes")
    .select(ROUTE_COLS)
    .order("state")
    .order("display_name_en");
  return (data ?? []) as unknown as RouteRow[];
}

export async function getAccessRouteForEdit(
  id: string,
): Promise<
  | (Record<string, unknown> & {
      id: string;
      supported_flows: Record<string, unknown>[];
      menu_steps: Record<string, unknown>[];
      fees: Record<string, unknown>[];
      limits: Record<string, unknown>[];
      evidence: EvidenceRow[];
      versions: VersionRow[];
    })
  | null
> {
  await assertDirectoryAdmin();
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("access_routes")
    .select(
      "*, provider:service_providers(id, slug, display_name), network:payment_networks(id, slug, canonical_name), service_code:service_codes(id, slug, display_name_en)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;

  const [flowsRes, stepsRes, feesRes, limitsRes, evidence, versions] = await Promise.all([
    supabase.from("route_supported_flows").select("*").eq("access_route_id", id).order("flow_type"),
    supabase.from("route_menu_steps").select("*").eq("access_route_id", id).order("position"),
    supabase.from("route_fees").select("*").eq("scope", "institution").eq("access_route_id", id),
    supabase.from("route_limits").select("*").eq("scope", "institution").eq("access_route_id", id),
    getEvidence("access_route", id),
    getVersions("access_route", id),
  ]);

  return {
    ...(data as Record<string, unknown>),
    id,
    supported_flows: (flowsRes.data ?? []) as Record<string, unknown>[],
    menu_steps: (stepsRes.data ?? []) as Record<string, unknown>[],
    fees: (feesRes.data ?? []) as Record<string, unknown>[],
    limits: (limitsRes.data ?? []) as Record<string, unknown>[],
    evidence,
    versions,
  };
}

// --- shared: reference data, evidence, versions --------------------

export async function listReferenceEntities(): Promise<{
  providers: { id: string; slug: string; display_name: string }[];
  networks: { id: string; slug: string; canonical_name: string }[];
  authorities: { id: string; slug: string; name: string }[];
  operators: { id: string; slug: string; name: string }[];
  serviceCodes: { id: string; slug: string; display_name_en: string }[];
  sources: { id: string; organization: string; title: string | null; classification: string }[];
}> {
  await assertDirectoryAdmin();
  const supabase = await supabaseSession();
  const [p, n, a, o, c, s] = await Promise.all([
    supabase.from("service_providers").select("id, slug, display_name").order("display_name"),
    supabase.from("payment_networks").select("id, slug, canonical_name").order("canonical_name"),
    supabase.from("regulatory_authorities").select("id, slug, name").order("name"),
    supabase.from("service_operators").select("id, slug, name").order("name"),
    supabase.from("service_codes").select("id, slug, display_name_en").order("display_name_en"),
    supabase
      .from("directory_sources")
      .select("id, organization, title, classification")
      .order("organization"),
  ]);
  return {
    providers: (p.data ?? []) as { id: string; slug: string; display_name: string }[],
    networks: (n.data ?? []) as { id: string; slug: string; canonical_name: string }[],
    authorities: (a.data ?? []) as { id: string; slug: string; name: string }[],
    operators: (o.data ?? []) as { id: string; slug: string; name: string }[],
    serviceCodes: (c.data ?? []) as { id: string; slug: string; display_name_en: string }[],
    sources: (s.data ?? []) as {
      id: string;
      organization: string;
      title: string | null;
      classification: string;
    }[],
  };
}

export type EvidenceRow = {
  id: string;
  subject_type: string;
  subject_id: string;
  storage_path: string | null;
  mime_type: string | null;
  is_public: boolean;
  internal_note: string | null;
  public_caveat_en: string | null;
  verification_date: string | null;
  next_review_date: string | null;
  created_at: string;
  source: { organization: string; title: string | null; classification: string } | null;
};

async function getEvidence(subjectType: string, subjectId: string): Promise<EvidenceRow[]> {
  const supabase = await supabaseSession();
  const { data } = await supabase
    .from("directory_evidence")
    .select(
      "id, subject_type, subject_id, storage_path, mime_type, is_public, internal_note, public_caveat_en, verification_date, next_review_date, created_at, source:directory_sources(organization, title, classification)",
    )
    .eq("subject_type", subjectType)
    .eq("subject_id", subjectId)
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as EvidenceRow[];
}

export type VersionRow = {
  version: number;
  change_reason: string | null;
  created_at: string;
};

async function getVersions(subjectType: string, subjectId: string): Promise<VersionRow[]> {
  const supabase = await supabaseSession();
  const { data } = await supabase
    .from("directory_versions")
    .select("version, change_reason, created_at")
    .eq("subject_type", subjectType)
    .eq("subject_id", subjectId)
    .order("version", { ascending: false });
  return (data ?? []) as VersionRow[];
}

export { LIFECYCLE_STATES };
