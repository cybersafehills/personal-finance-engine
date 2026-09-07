import "server-only";
import { supabaseSession } from "./supabase-session-server";
import { supabaseServer } from "./supabase-server";
import {
  getActiveWorkspace,
  getSpaceMemberDirectory,
  type WorkspaceSummary,
} from "./queries";
import { isValidReportTimezone } from "./timezones";
import {
  reconstructStatementPeriod,
  type ResolvedStatementPeriod,
  resolveStatementPeriod,
} from "./statement-period";
import {
  computeStatementMath,
  type StatementMathResult,
} from "./statement-math";
import {
  buildStatementCoverageMetadata,
  type StatementCoverageMetadata,
  type StatementSourceDescriptor,
  type StatementSourceMetadata,
} from "./statement-coverage";
import {
  buildPendingStatementRecord,
  buildStatementFinancials,
  buildStatementRecord,
  buildStatementTransactionRows,
  hasStatementFilter,
  type LedgerTxnRow,
  MAX_STATEMENT_TRANSACTIONS,
  resolveStatementScope,
  type StatementFilters,
  type StatementScope,
  type StatementType,
  toCoverageFact,
  toMathFact,
} from "./statement-snapshot";
import type {
  DeleteOutcome,
  GenerateOutcome,
  PreviewOutcome,
  StatementErrorKind,
  StatementPreview,
  StatementPreviewRow,
  StatementRequest,
} from "./statement-types";

export type {
  DeleteOutcome,
  GenerateOutcome,
  PreviewOutcome,
  StatementErrorKind,
  StatementPreview,
  StatementRequest,
};

// Statement generation orchestrator (Financial Documents Engine, PR3).
//
// Authorization model (mirrors report-generation.ts's reasoning, inverted
// for a user-initiated action):
//   * The caller's session client (RLS) is used for every READ - the
//     active-workspace check, source authorization, the transaction facts
//     and the opening/closing balances. RLS on `transactions` /
//     `financial_sources` is the real per-row boundary, including
//     household per-source visibility, so nothing here re-implements it.
//   * The service-role client is used ONLY to write the immutable snapshot
//     (`statements` + `statement_transactions`), because those tables
//     grant the client no INSERT at all (migration 20261210000000) - a
//     finalized statement must be un-forgeable and un-editable from the
//     browser. Every service-role write is explicitly scoped to the
//     workspace id already verified through the session client above.
//   * The document artifacts + storage (PR4) and the `statement.generate`
//     capability + audit events (PR6) layer on top of this.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FACT_PAGE_SIZE = 1000;
const MAX_REQUESTED_SOURCES = 100;
const PREVIEW_SAMPLE_ROWS = 8;
const CHILD_INSERT_CHUNK = 500;

/**
 * Above this many in-period transactions, createStatement inserts a
 * `status='generating'` stub and lets the statement-jobs worker
 * (app/api/cron/run-statement-jobs) assemble + render it, instead of doing
 * that work inside the request (master prompt section 27). A request may
 * also force this with `async: true`. Configurable; default 8000.
 */
const STATEMENT_ASYNC_THRESHOLD = (() => {
  const n = Number(process.env.STATEMENT_ASYNC_THRESHOLD);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 8000;
})();
const STATEMENT_JOB_BATCH = 20;
const STATEMENT_JOB_MIN_AGE_MS = 2000;

const TXN_COLUMNS =
  "id, occurred_at, transaction_type, direction, principal_effect_rwf, fee_effect_rwf, balance_after_rwf, currency, counterparty_name, counterparty_reference, category, financial_source_id";

const MESSAGES: Record<StatementErrorKind, string> = {
  not_signed_in: "You are not signed in.",
  no_workspace: "We couldn't determine your workspace.",
  forbidden_role: "Viewers can't generate statements in this space.",
  invalid_input: "That request wasn't valid.",
  invalid_timezone: "Unrecognized timezone.",
  invalid_period: "That statement period wasn't valid.",
  no_sources: "There are no accounts to generate a statement for.",
  unauthorized_source: "One or more selected accounts aren't available.",
  no_transactions: "No transactions were found for this account and period.",
  too_large:
    "This period has too many transactions for a single statement. Choose a shorter range.",
  query_failed: "We couldn't read your transactions just now.",
  persist_failed: "We couldn't save the statement. Please try again.",
  not_found: "That statement no longer exists.",
};

function err(
  kind: StatementErrorKind,
  message?: string,
): { ok: false; kind: StatementErrorKind; message: string } {
  return { ok: false, kind, message: message ?? MESSAGES[kind] };
}

type ServiceClient = ReturnType<typeof supabaseServer>;

export type StatementAuditEvent =
  | "statement.generated"
  | "statement.regenerated"
  | "statement.downloaded"
  | "statement.deleted"
  | "statement.access_denied";

/**
 * Append one row to the protected space_audit_events trail (master prompt
 * section 41). Service-role insert - that table grants authenticated no
 * INSERT. NON-FATAL by design: an audit-write failure must never block or
 * fail the user's action. Metadata is deliberately minimal - never a
 * balance, description, counterparty or reference (section 42).
 */
export async function recordStatementAudit(
  service: ServiceClient,
  input: {
    workspaceId: string;
    actorUserId: string;
    eventType: StatementAuditEvent;
    statementUuid: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await service.from("space_audit_events").insert({
      workspace_id: input.workspaceId,
      actor_user_id: input.actorUserId,
      event_type: input.eventType,
      resource_type: "statement",
      resource_id: input.statementUuid,
      metadata: input.metadata ?? {},
    });
  } catch (e) {
    console.error("recordStatementAudit failed (non-fatal):", e);
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

type Context = {
  session: Awaited<ReturnType<typeof supabaseSession>>;
  userId: string;
  workspace: WorkspaceSummary;
};

async function resolveContext(): Promise<
  | { ok: true; ctx: Context }
  | { ok: false; kind: StatementErrorKind; message: string }
> {
  const session = await supabaseSession();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return err("not_signed_in");

  const workspace = await getActiveWorkspace();
  if (!workspace) return err("no_workspace");

  // Authorization: the `statement.generate` capability (migration
  // 20261211000000). Personal owner + household/org owner/admin/member
  // hold it by role; a viewer only via an explicit
  // space_member_capability_grants row. has_space_capability is
  // SECURITY DEFINER and composes both.
  const { data: canGenerate, error: capError } = await session.rpc(
    "has_space_capability",
    { p_workspace_id: workspace.id, p_capability: "statement.generate" },
  );
  if (capError || canGenerate !== true) {
    void recordStatementAudit(supabaseServer(), {
      workspaceId: workspace.id,
      actorUserId: user.id,
      eventType: "statement.access_denied",
      statementUuid: null,
      metadata: { reason: "missing_capability" },
    });
    return err("forbidden_role");
  }

  return { ok: true, ctx: { session, userId: user.id, workspace } };
}

// ---------------------------------------------------------------------------
// Source authorization
// ---------------------------------------------------------------------------

type SourceRow = {
  id: string;
  display_name: string;
  provider: string;
  source_type: string;
  currency: string;
  masked_identifier: string | null;
};

function toDescriptor(row: SourceRow): StatementSourceDescriptor {
  return {
    id: row.id,
    provider: row.provider,
    sourceType: row.source_type,
    displayName: row.display_name,
    maskedIdentifier: row.masked_identifier,
  };
}

/**
 * The financial sources the caller may generate a statement for in the
 * active workspace. Personal workspace: sources they own. Household /
 * organization workspace: sources actively linked into that workspace
 * (source_space_links). RLS on financial_sources still filters to what
 * the caller can see either way.
 */
async function fetchAuthorizedSources(
  ctx: Context,
): Promise<
  {
    descriptors: StatementSourceDescriptor[];
    currencyById: Map<string, string>;
  }
> {
  const cols =
    "id, display_name, provider, source_type, currency, masked_identifier";

  let rows: SourceRow[] = [];
  if (ctx.workspace.kind === "personal") {
    const { data } = await ctx.session
      .from("financial_sources")
      .select(cols)
      .eq("owner_user_id", ctx.userId);
    rows = (data ?? []) as SourceRow[];
  } else {
    const { data: links } = await ctx.session
      .from("source_space_links")
      .select("financial_source_id")
      .eq("workspace_id", ctx.workspace.id)
      .eq("status", "active");
    const ids = Array.from(
      new Set(
        ((links ?? []) as { financial_source_id: string }[]).map((l) =>
          l.financial_source_id
        ),
      ),
    );
    if (ids.length > 0) {
      const { data } = await ctx.session
        .from("financial_sources")
        .select(cols)
        .in("id", ids);
      rows = (data ?? []) as SourceRow[];
    }
  }

  const currencyById = new Map<string, string>();
  for (const r of rows) currencyById.set(r.id, r.currency);
  return { descriptors: rows.map(toDescriptor), currencyById };
}

export type StatementSourceOption = {
  id: string;
  label: string;
  currency: string;
};

export type StatementParticipantOption = { id: string; label: string };

export type StatementFormOptions =
  | {
    ok: true;
    sources: StatementSourceOption[];
    /** A curated IANA zone (isValidReportTimezone), for the generate form's default. */
    timezone: string;
    /** Household co-members, for the "attributed to" filter. Empty for personal / org spaces. */
    participants: StatementParticipantOption[];
  }
  | { ok: false; kind: StatementErrorKind; message: string };

/**
 * Everything the /reports/statements/new form needs, resolved for the
 * ACTIVE workspace: the authorized source list (same set createStatement
 * will accept) and a sane default timezone. A server component calls this.
 */
export async function getStatementFormOptions(): Promise<StatementFormOptions> {
  const ctxRes = await resolveContext();
  if (!ctxRes.ok) return ctxRes;
  const { ctx } = ctxRes;

  const { descriptors, currencyById } = await fetchAuthorizedSources(ctx);
  const sources: StatementSourceOption[] = descriptors.map((d) => ({
    id: d.id,
    label: d.maskedIdentifier
      ? `${d.displayName} · ${d.maskedIdentifier}`
      : d.displayName,
    currency: currencyById.get(d.id) ?? "RWF",
  }));

  const { data: profile } = await ctx.session
    .from("profiles")
    .select("timezone")
    .eq("id", ctx.userId)
    .maybeSingle();
  const profileTz = typeof profile?.timezone === "string"
    ? profile.timezone
    : "";
  const timezone = isValidReportTimezone(profileTz)
    ? profileTz
    : "Africa/Kigali";

  // The "attributed to" filter only makes sense in a shared household,
  // where transactions carry an attributed_user_id. Personal and org
  // spaces get an empty list and the form omits the control.
  let participants: StatementParticipantOption[] = [];
  if (ctx.workspace.kind === "household") {
    const members = await getSpaceMemberDirectory(ctx.workspace.id);
    participants = members.map((m) => ({
      id: m.userId,
      label: m.displayName?.trim() || "A household member",
    }));
  }

  return { ok: true, sources, timezone, participants };
}

// ---------------------------------------------------------------------------
// Fact + balance queries. Parameterised by client + workspaceId so the
// synchronous path (session client / RLS) and the statement-jobs worker
// (service-role client, explicit workspace scoping - already authorised at
// createStatement time) share one implementation.
// ---------------------------------------------------------------------------

// The PostgREST query/filter builder chains are hard to thread through
// helper functions with precise generics, and this module must accept
// EITHER the session client (RLS) or the service-role client. `any` here
// is deliberate and contained to the four query helpers below; every
// public entry point is fully typed.
/* eslint-disable @typescript-eslint/no-explicit-any */
type AnySupabase = { from(t: string): any };

type FactFilterOpts = {
  sourceIds: string[];
  restrictToSources: boolean;
  direction?: "in" | "out";
  category?: string;
  merchant?: string;
  participantUserId?: string;
  tag?: string;
};

function applyFactFilters(q: any, opts: FactFilterOpts): any {
  if (opts.restrictToSources) q = q.in("financial_source_id", opts.sourceIds);
  if (opts.direction) q = q.eq("direction", opts.direction);
  if (opts.category) {
    q = opts.category === "Uncategorized"
      ? q.is("category", null)
      : q.eq("category", opts.category);
  }
  if (opts.merchant) {
    const safe = opts.merchant.replace(/[%,()\\]/g, " ").trim();
    if (safe) q = q.ilike("counterparty_name", `%${safe}%`);
  }
  if (opts.participantUserId) {
    q = q.eq("attributed_user_id", opts.participantUserId);
  }
  if (opts.tag) q = q.eq("transaction_tags.tag", opts.tag);
  return q;
}

/** When a tag filter is active the select needs an inner join to transaction_tags. */
function factSelect(base: string, opts: FactFilterOpts): string {
  return opts.tag ? `${base}, transaction_tags!inner(tag)` : base;
}

function baseFactQuery(
  workspaceId: string,
  period: ResolvedStatementPeriod,
  selected: any,
): any {
  return selected
    .eq("workspace_id", workspaceId)
    .eq("settlement_state", "settled")
    .neq("dedupe_state", "merged")
    .gte("occurred_at", period.periodStartUtc.toISOString())
    .lt("occurred_at", period.periodEndUtc.toISOString());
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function fetchFactCount(
  client: AnySupabase,
  workspaceId: string,
  period: ResolvedStatementPeriod,
  opts: FactFilterOpts,
): Promise<number | null> {
  const { count, error } = await applyFactFilters(
    baseFactQuery(
      workspaceId,
      period,
      client.from("transactions").select(factSelect("id", opts), {
        count: "exact",
        head: true,
      }),
    ),
    opts,
  );
  if (error) {
    console.error("fetchFactCount failed:", error.message);
    return null;
  }
  return count ?? 0;
}

async function fetchFacts(
  client: AnySupabase,
  workspaceId: string,
  period: ResolvedStatementPeriod,
  opts: FactFilterOpts,
): Promise<
  { ok: true; rows: LedgerTxnRow[] } | { ok: false; kind: StatementErrorKind }
> {
  const rows: LedgerTxnRow[] = [];
  let offset = 0;

  while (true) {
    const q = applyFactFilters(
      baseFactQuery(
        workspaceId,
        period,
        client.from("transactions").select(factSelect(TXN_COLUMNS, opts)),
      )
        .order("occurred_at", { ascending: true })
        .order("created_at", { ascending: true })
        .range(offset, offset + FACT_PAGE_SIZE - 1),
      opts,
    );

    const { data, error } = await q;
    if (error) {
      console.error("fetchFacts failed:", error.message);
      return { ok: false, kind: "query_failed" };
    }
    const page = (data ?? []) as LedgerTxnRow[];
    rows.push(...page);
    if (page.length < FACT_PAGE_SIZE) break;
    offset += FACT_PAGE_SIZE;
    if (rows.length > MAX_STATEMENT_TRANSACTIONS) {
      return { ok: false, kind: "too_large" };
    }
  }

  return { ok: true, rows };
}

/** The provider-reported balance immediately before `instant` for one source, or null. */
async function fetchBalanceBefore(
  client: AnySupabase,
  workspaceId: string,
  instant: Date,
  sourceId: string,
): Promise<number | null> {
  const { data, error } = await client
    .from("transactions")
    .select("balance_after_rwf")
    .eq("workspace_id", workspaceId)
    .eq("settlement_state", "settled")
    .neq("dedupe_state", "merged")
    .eq("financial_source_id", sourceId)
    .not("balance_after_rwf", "is", null)
    .lt("occurred_at", instant.toISOString())
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data || data.balance_after_rwf === null) return null;
  const n = Number(data.balance_after_rwf);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Assembly (shared by preview + persist)
// ---------------------------------------------------------------------------

function normalizeFilters(
  input: StatementFilters | undefined,
): StatementFilters {
  return {
    ...(input?.direction ? { direction: input.direction } : {}),
    ...(input?.category?.trim() ? { category: input.category.trim() } : {}),
    ...(input?.merchant?.trim() ? { merchant: input.merchant.trim() } : {}),
    ...(input?.participantUserId?.trim()
      ? { participantUserId: input.participantUserId.trim() }
      : {}),
    ...(input?.tag?.trim() ? { tag: input.tag.trim() } : {}),
  };
}

type ScopeResult = {
  scope: StatementScope;
  sourceIds: string[];
  restrictToSources: boolean;
  filters: StatementFilters;
  scopedDescriptors: StatementSourceDescriptor[];
  currencyHint: string;
};

async function resolveScopeAndSources(
  ctx: Context,
  req: { sourceIds: string[]; filters?: StatementFilters },
): Promise<
  { ok: true; scope: ScopeResult } | { ok: false; kind: StatementErrorKind }
> {
  const filters = normalizeFilters(req.filters);
  const { descriptors, currencyById } = await fetchAuthorizedSources(ctx);
  const scopeRes = resolveStatementScope(
    req.sourceIds,
    descriptors.map((d) => d.id),
    filters,
  );
  if (!scopeRes.ok) return { ok: false, kind: scopeRes.kind };

  const { scope, sourceIds } = scopeRes;
  const scopedDescriptors = descriptors.filter((d) => sourceIds.includes(d.id));
  const scopedCurrencies = Array.from(
    new Set(
      sourceIds.map((id) => currencyById.get(id)).filter((c): c is string =>
        !!c
      ),
    ),
  );
  return {
    ok: true,
    scope: {
      scope,
      sourceIds,
      restrictToSources: req.sourceIds.length > 0,
      filters,
      scopedDescriptors,
      currencyHint: scopedCurrencies.length === 1 ? scopedCurrencies[0] : "RWF",
    },
  };
}

type Assembly = {
  math: StatementMathResult;
  source: StatementSourceMetadata;
  coverage: StatementCoverageMetadata;
  rowsById: Map<string, LedgerTxnRow>;
  rowCount: number;
};

/**
 * Turn already-fetched ledger rows + a resolved scope into the computed
 * math + disclosure metadata. Client-agnostic: the sync path calls it with
 * session-fetched rows, the statement-jobs worker with service-role rows.
 */
async function computeAssembly(
  client: AnySupabase,
  workspaceId: string,
  period: ResolvedStatementPeriod,
  scope: ScopeResult,
  rows: LedgerTxnRow[],
): Promise<Assembly> {
  let openingBalanceMinor: number | null = null;
  let closingBalanceMinor: number | null = null;
  if (scope.sourceIds.length === 1) {
    openingBalanceMinor = await fetchBalanceBefore(
      client,
      workspaceId,
      period.periodStartUtc,
      scope.sourceIds[0],
    );
    closingBalanceMinor = await fetchBalanceBefore(
      client,
      workspaceId,
      period.periodEndUtc,
      scope.sourceIds[0],
    );
  }

  const math = computeStatementMath(rows.map(toMathFact), {
    openingBalanceMinor,
    closingBalanceMinor,
    currency: scope.currencyHint,
  });

  const { source, coverage } = buildStatementCoverageMetadata({
    facts: rows.map(toCoverageFact),
    sources: scope.scopedDescriptors,
    filters: hasStatementFilter(scope.filters) ? scope.filters : undefined,
  });

  return {
    math,
    source,
    coverage,
    rowsById: new Map(rows.map((r) => [r.id, r])),
    rowCount: rows.length,
  };
}

type Assembled = ScopeResult & Assembly & { rows: LedgerTxnRow[] };

async function assembleStatement(
  ctx: Context,
  period: ResolvedStatementPeriod,
  req: {
    statementType: StatementType;
    sourceIds: string[];
    filters?: StatementFilters;
  },
): Promise<
  | { ok: true; assembled: Assembled }
  | { ok: false; kind: StatementErrorKind; message: string }
> {
  const scopeRes = await resolveScopeAndSources(ctx, req);
  if (!scopeRes.ok) return err(scopeRes.kind);
  const scope = scopeRes.scope;

  const factsRes = await fetchFacts(ctx.session, ctx.workspace.id, period, {
    sourceIds: scope.sourceIds,
    restrictToSources: scope.restrictToSources,
    direction: scope.filters.direction,
    category: scope.filters.category,
    merchant: scope.filters.merchant,
    participantUserId: scope.filters.participantUserId,
    tag: scope.filters.tag,
  });
  if (!factsRes.ok) return err(factsRes.kind);
  const rows = factsRes.rows;

  const assembly = await computeAssembly(
    ctx.session,
    ctx.workspace.id,
    period,
    scope,
    rows,
  );

  return {
    ok: true,
    assembled: { ...scope, ...assembly, rows },
  };
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

function validateRequestShape(
  req: StatementRequest,
): { ok: true } | { ok: false; kind: StatementErrorKind; message: string } {
  if (req.statementType !== "standard" && req.statementType !== "detailed") {
    return err("invalid_input", "Unknown statement type.");
  }
  if (!UUID_RE.test(req.clientToken)) {
    return err("invalid_input", "Missing or malformed request token.");
  }
  if (
    !Array.isArray(req.sourceIds) ||
    req.sourceIds.length > MAX_REQUESTED_SOURCES
  ) {
    return err("invalid_input", "Too many accounts selected.");
  }
  if (
    !req.sourceIds.every((id) => typeof id === "string" && UUID_RE.test(id))
  ) {
    return err("invalid_input", "An account reference was malformed.");
  }
  if (
    req.filters?.direction &&
    req.filters.direction !== "in" &&
    req.filters.direction !== "out"
  ) {
    return err("invalid_input", "Unknown filter.");
  }
  if (
    (req.filters?.category && req.filters.category.length > 80) ||
    (req.filters?.merchant && req.filters.merchant.length > 80) ||
    (req.filters?.tag && req.filters.tag.length > 80)
  ) {
    return err("invalid_input", "A filter value is too long.");
  }
  if (
    req.filters?.participantUserId &&
    !UUID_RE.test(req.filters.participantUserId)
  ) {
    return err("invalid_input", "A filter value was malformed.");
  }
  if (!isValidReportTimezone(req.timezone)) {
    return err("invalid_timezone");
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export async function previewStatement(
  req: StatementRequest,
): Promise<PreviewOutcome> {
  const shape = validateRequestShape(req);
  if (!shape.ok) return shape;

  const ctxRes = await resolveContext();
  if (!ctxRes.ok) return ctxRes;
  const { ctx } = ctxRes;

  const periodRes = resolveStatementPeriod({
    preset: req.preset,
    timezone: req.timezone,
    fromDateKey: req.fromDateKey,
    toDateKey: req.toDateKey,
    now: new Date(),
  });
  if (!periodRes.ok) return err("invalid_period", periodRes.error);
  const period = periodRes.period;

  const res = await assembleStatement(ctx, period, req);
  if (!res.ok) return res;
  const a = res.assembled;

  const childRows = buildStatementTransactionRows(a.math, a.rowsById, {
    statementUuid: "",
    statementType: req.statementType,
  });
  const sampleRows: StatementPreviewRow[] = childRows
    .slice(0, PREVIEW_SAMPLE_ROWS)
    .map((r) => ({
      occurredAt: r.occurred_at,
      displayDescription: r.display_description,
      originalDescription: r.original_description,
      reference: r.reference,
      direction: r.direction,
      principalEffectMinor: r.principal_effect_minor,
      feeEffectMinor: r.fee_effect_minor,
      runningBalanceMinor: r.running_balance_minor,
      category: r.category,
    }));

  return {
    ok: true,
    preview: {
      statementType: req.statementType,
      scope: a.scope,
      period: {
        label: period.label,
        startDateKey: period.startDateKey,
        endDateKey: period.endDateKey,
        periodStartIso: period.periodStartUtc.toISOString(),
        periodEndIso: period.periodEndUtc.toISOString(),
        timezone: period.timezone,
        adjustments: period.adjustments,
      },
      currency: a.math.currency ?? a.currencyHint,
      mixedCurrency: a.math.mixedCurrency,
      totals: a.math.totals
        ? {
          openingBalanceMinor: a.math.totals.openingBalanceMinor,
          closingBalanceMinor: a.math.totals.closingBalanceMinor,
          totalCreditsMinor: a.math.totals.totalCreditsMinor,
          totalDebitsMinor: a.math.totals.totalDebitsMinor,
          totalFeesMinor: a.math.totals.totalFeesMinor,
          netMovementMinor: a.math.totals.netMovementMinor,
          transactionCount: a.math.totals.transactionCount,
          reconciles: a.math.totals.reconciles,
        }
        : null,
      perCurrency: a.math.perCurrency,
      runningBalanceBasis: a.math.runningBalanceBasis,
      source: a.source,
      coverage: a.coverage,
      sampleRows,
      sampleTruncated: a.math.rows.length > PREVIEW_SAMPLE_ROWS,
    },
  };
}

// ---------------------------------------------------------------------------
// Persist
// ---------------------------------------------------------------------------

async function persistStatement(
  ctx: Context,
  period: ResolvedStatementPeriod,
  params: {
    statementType: StatementType;
    requestedSourceIds: string[];
    filters?: StatementFilters;
    clientToken: string;
    supersedesId: string | null;
  },
): Promise<GenerateOutcome> {
  const service = supabaseServer();

  const res = await assembleStatement(ctx, period, {
    statementType: params.statementType,
    sourceIds: params.requestedSourceIds,
    filters: params.filters,
  });
  if (!res.ok) {
    if (res.kind === "unauthorized_source") {
      void recordStatementAudit(service, {
        workspaceId: ctx.workspace.id,
        actorUserId: ctx.userId,
        eventType: "statement.access_denied",
        statementUuid: null,
        metadata: { reason: "unauthorized_source" },
      });
    }
    return res;
  }
  const a = res.assembled;

  if (a.rows.length === 0) return err("no_transactions");

  const now = new Date();

  const { generateStatementId, generateVerificationToken } = await import(
    "./statement-id"
  );

  // Insert the parent row, retrying once on the astronomically unlikely
  // public-id collision.
  let parentId = "";
  let publicId = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const candidate = generateStatementId({ now });
    const record = buildStatementRecord({
      statementPublicId: candidate,
      workspaceId: ctx.workspace.id,
      createdBy: ctx.userId,
      statementType: params.statementType,
      scope: a.scope,
      accountIds: a.sourceIds,
      filters: a.filters,
      periodStartUtc: period.periodStartUtc,
      periodEndUtc: period.periodEndUtc,
      timezone: period.timezone,
      currencyHint: a.currencyHint,
      math: a.math,
      sourceMetadata: a.source,
      coverageMetadata: a.coverage,
      supersedesId: params.supersedesId,
      clientToken: params.clientToken,
      verificationToken: generateVerificationToken(),
      now,
    });

    const { data, error } = await service
      .from("statements")
      .insert(record)
      .select("id, statement_id")
      .single();

    if (!error && data) {
      parentId = data.id;
      publicId = data.statement_id;
      break;
    }

    if (error?.code === "23505") {
      const msg = error.message.toLowerCase();
      if (msg.includes("client_token")) {
        // A concurrent request with the same idempotency token won.
        const { data: existing } = await service
          .from("statements")
          .select("id, statement_id")
          .eq("workspace_id", ctx.workspace.id)
          .eq("client_token", params.clientToken)
          .maybeSingle();
        if (existing) {
          return {
            ok: true,
            id: existing.id,
            statementId: existing.statement_id,
            deduped: true,
          };
        }
      }
      if (msg.includes("statement_id") && attempt === 0) {
        continue; // regenerate the public id and retry once
      }
    }

    console.error("persistStatement: parent insert failed:", error?.message);
    return err("persist_failed");
  }

  if (!parentId) return err("persist_failed");

  // Frozen per-row snapshot.
  const childRows = buildStatementTransactionRows(a.math, a.rowsById, {
    statementUuid: parentId,
    statementType: params.statementType,
  });

  for (let i = 0; i < childRows.length; i += CHILD_INSERT_CHUNK) {
    const chunk = childRows.slice(i, i + CHILD_INSERT_CHUNK);
    const { error } = await service.from("statement_transactions").insert(
      chunk,
    );
    if (error) {
      console.error("persistStatement: child insert failed:", error.message);
      await service.from("statements").delete().eq("id", parentId);
      return err("persist_failed");
    }
  }

  // Operational monitoring: a finalized statement whose balances don't
  // reconcile is generated (flagged, never silently), but the mismatch is
  // surfaced for review (master prompt section 43).
  if (a.math.totals?.reconciles === false) {
    console.warn("[statement.monitor] reconcile_mismatch", {
      workspaceId: ctx.workspace.id,
      statementId: publicId,
      totalCreditsMinor: a.math.totals.totalCreditsMinor,
      totalDebitsMinor: a.math.totals.totalDebitsMinor,
      totalFeesMinor: a.math.totals.totalFeesMinor,
      openingBalanceMinor: a.math.totals.openingBalanceMinor,
      closingBalanceMinor: a.math.totals.closingBalanceMinor,
    });
  }

  await recordStatementAudit(service, {
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.userId,
    eventType: params.supersedesId
      ? "statement.regenerated"
      : "statement.generated",
    statementUuid: parentId,
    metadata: {
      statementId: publicId,
      scope: a.scope,
      statementType: params.statementType,
      transactionCount: a.math.rows.length,
      periodStart: period.periodStartUtc.toISOString(),
      periodEnd: period.periodEndUtc.toISOString(),
      reconciles: a.math.totals?.reconciles ?? null,
      supersedesId: params.supersedesId,
    },
  });

  return { ok: true, id: parentId, statementId: publicId, deduped: false };
}

// ---------------------------------------------------------------------------
// Public: create / regenerate / delete
// ---------------------------------------------------------------------------

export async function createStatement(
  req: StatementRequest,
): Promise<GenerateOutcome> {
  const shape = validateRequestShape(req);
  if (!shape.ok) return shape;

  const ctxRes = await resolveContext();
  if (!ctxRes.ok) return ctxRes;
  const { ctx } = ctxRes;

  const periodRes = resolveStatementPeriod({
    preset: req.preset,
    timezone: req.timezone,
    fromDateKey: req.fromDateKey,
    toDateKey: req.toDateKey,
    now: new Date(),
  });
  if (!periodRes.ok) return err("invalid_period", periodRes.error);

  // Idempotency: a repeated submit with the same token returns the row it
  // already created rather than a second one.
  const service = supabaseServer();
  const { data: existing } = await service
    .from("statements")
    .select("id, statement_id")
    .eq("workspace_id", ctx.workspace.id)
    .eq("client_token", req.clientToken)
    .maybeSingle();
  if (existing) {
    return {
      ok: true,
      id: existing.id,
      statementId: existing.statement_id,
      deduped: true,
    };
  }

  const period = periodRes.period;

  // Size probe: resolve the scope, then count the in-period rows without
  // fetching them. A large statement (or an explicit `async`) is queued
  // for the statement-jobs worker rather than assembled in this request.
  const scopeRes = await resolveScopeAndSources(ctx, {
    sourceIds: req.sourceIds,
    filters: req.filters,
  });
  if (!scopeRes.ok) {
    if (scopeRes.kind === "unauthorized_source") {
      void recordStatementAudit(service, {
        workspaceId: ctx.workspace.id,
        actorUserId: ctx.userId,
        eventType: "statement.access_denied",
        statementUuid: null,
        metadata: { reason: "unauthorized_source" },
      });
    }
    return err(scopeRes.kind);
  }
  const scope = scopeRes.scope;

  const count = await fetchFactCount(ctx.session, ctx.workspace.id, period, {
    sourceIds: scope.sourceIds,
    restrictToSources: scope.restrictToSources,
    direction: scope.filters.direction,
    category: scope.filters.category,
    merchant: scope.filters.merchant,
    participantUserId: scope.filters.participantUserId,
    tag: scope.filters.tag,
  });
  if (count === 0) return err("no_transactions");
  if (count !== null && count > MAX_STATEMENT_TRANSACTIONS) {
    return err("too_large");
  }

  const shouldQueue = req.async === true ||
    (count !== null && count > STATEMENT_ASYNC_THRESHOLD);
  if (shouldQueue) {
    return queueStatement(ctx, service, period, scope, {
      statementType: req.statementType,
      clientToken: req.clientToken,
      supersedesId: null,
    });
  }

  return persistStatement(ctx, period, {
    statementType: req.statementType,
    requestedSourceIds: req.sourceIds,
    filters: req.filters,
    clientToken: req.clientToken,
    supersedesId: null,
  });
}

/**
 * Insert a `status='generating'` stub. The statement-jobs worker
 * (runStatementJobsTick) fetches, computes and renders it, then flips it
 * to 'ready'. Same idempotency + public-id-collision handling as the sync
 * path.
 */
async function queueStatement(
  ctx: Context,
  service: ServiceClient,
  period: ResolvedStatementPeriod,
  scope: ScopeResult,
  params: {
    statementType: StatementType;
    clientToken: string;
    supersedesId: string | null;
  },
): Promise<GenerateOutcome> {
  const { generateStatementId, generateVerificationToken } = await import(
    "./statement-id"
  );

  for (let attempt = 0; attempt < 2; attempt++) {
    const record = buildPendingStatementRecord({
      statementPublicId: generateStatementId({ now: new Date() }),
      workspaceId: ctx.workspace.id,
      createdBy: ctx.userId,
      statementType: params.statementType,
      scope: scope.scope,
      accountIds: scope.sourceIds,
      filters: scope.filters,
      periodStartUtc: period.periodStartUtc,
      periodEndUtc: period.periodEndUtc,
      timezone: period.timezone,
      currencyHint: scope.currencyHint,
      supersedesId: params.supersedesId,
      clientToken: params.clientToken,
      verificationToken: generateVerificationToken(),
    });

    const { data, error } = await service
      .from("statements")
      .insert(record)
      .select("id, statement_id")
      .single();

    if (!error && data) {
      await recordStatementAudit(service, {
        workspaceId: ctx.workspace.id,
        actorUserId: ctx.userId,
        eventType: "statement.generated",
        statementUuid: data.id,
        metadata: {
          statementId: data.statement_id,
          scope: scope.scope,
          statementType: params.statementType,
          async: true,
          status: "generating",
        },
      });
      return {
        ok: true,
        id: data.id,
        statementId: data.statement_id,
        deduped: false,
      };
    }

    if (error?.code === "23505") {
      const msg = error.message.toLowerCase();
      if (msg.includes("client_token")) {
        const { data: e } = await service
          .from("statements")
          .select("id, statement_id")
          .eq("workspace_id", ctx.workspace.id)
          .eq("client_token", params.clientToken)
          .maybeSingle();
        if (e) {
          return {
            ok: true,
            id: e.id,
            statementId: e.statement_id,
            deduped: true,
          };
        }
      }
      if (msg.includes("statement_id") && attempt === 0) continue;
    }

    console.error("queueStatement: insert failed:", error?.message);
    return err("persist_failed");
  }
  return err("persist_failed");
}

// ---------------------------------------------------------------------------
// Statement-jobs worker (service role). NOT scheduled - the cron route
// exists for a later, explicitly-approved rollout step, matching
// app/api/cron/generate-reports. Idempotent per job: children are wiped
// and the final flip is conditional on status still being 'generating'.
// ---------------------------------------------------------------------------

export type StatementJobsTickSummary = {
  picked: number;
  finalized: number;
  failed: number;
  disabled?: true;
};

type StatementJobRow = {
  id: string;
  workspace_id: string;
  created_by: string | null;
  statement_type: StatementType;
  scope: StatementScope;
  account_ids: string[] | null;
  filters: StatementFilters | null;
  period_start: string;
  period_end: string;
  timezone: string;
  notify_email: string | null;
  notified_at: string | null;
};

async function finalizeStatementJob(
  service: ServiceClient,
  job: StatementJobRow,
): Promise<boolean> {
  try {
    const period = reconstructStatementPeriod(
      new Date(job.period_start),
      new Date(job.period_end),
      job.timezone,
    );
    const filters = normalizeFilters(job.filters ?? undefined);
    const accountIds = job.account_ids ?? [];
    const restrictToSources = accountIds.length > 0;

    // Idempotency: drop any children from a previous partial run.
    await service.from("statement_transactions").delete().eq(
      "statement_id",
      job.id,
    );

    const factsRes = await fetchFacts(service, job.workspace_id, period, {
      sourceIds: accountIds,
      restrictToSources,
      direction: filters.direction,
      category: filters.category,
      merchant: filters.merchant,
    });
    if (!factsRes.ok) throw new Error(`fact fetch: ${factsRes.kind}`);
    const rows = factsRes.rows;

    if (rows.length === 0) {
      await service.from("statements").update({
        status: "failed",
        failure_reason:
          "No transactions were found for this account and period.",
      }).eq("id", job.id).eq("status", "generating");
      return false;
    }

    const { data: srcRows } = restrictToSources
      ? await service
        .from("financial_sources")
        .select(
          "id, display_name, provider, source_type, currency, masked_identifier",
        )
        .in("id", accountIds)
      : { data: [] as SourceRow[] };
    const scopedDescriptors = ((srcRows ?? []) as SourceRow[]).map(
      toDescriptor,
    );
    const currencies = Array.from(
      new Set(((srcRows ?? []) as SourceRow[]).map((s) => s.currency)),
    );
    const currencyHint = currencies.length === 1 ? currencies[0] : "RWF";

    const scope: ScopeResult = {
      scope: job.scope,
      sourceIds: accountIds,
      restrictToSources,
      filters,
      scopedDescriptors,
      currencyHint,
    };
    const assembly = await computeAssembly(
      service,
      job.workspace_id,
      period,
      scope,
      rows,
    );

    const childRows = buildStatementTransactionRows(
      assembly.math,
      assembly.rowsById,
      { statementUuid: job.id, statementType: job.statement_type },
    );
    for (let i = 0; i < childRows.length; i += CHILD_INSERT_CHUNK) {
      const { error } = await service.from("statement_transactions").insert(
        childRows.slice(i, i + CHILD_INSERT_CHUNK),
      );
      if (error) throw new Error(`child insert: ${error.message}`);
    }

    const { error: upErr } = await service.from("statements").update({
      ...buildStatementFinancials(assembly.math, currencyHint),
      source_metadata: assembly.source,
      coverage_metadata: assembly.coverage,
      status: "ready",
      generated_at: new Date().toISOString(),
    }).eq("id", job.id).eq("status", "generating");
    if (upErr) throw new Error(`finalize update: ${upErr.message}`);

    // Scheduled-statement email: a LINK only, once (master prompt s26/s30).
    if (job.notify_email && !job.notified_at) {
      try {
        const base = process.env.SITE_URL?.replace(/\/$/, "");
        const { sendScheduledStatementEmail } = await import("./emails");
        await sendScheduledStatementEmail({
          to: job.notify_email,
          periodLabel: period.label,
          statementUrl: base
            ? `${base}/reports/statements/${job.id}`
            : `/reports/statements/${job.id}`,
          workspaceId: job.workspace_id,
        });
        await service.from("statements").update({
          notified_at: new Date().toISOString(),
        }).eq("id", job.id);
      } catch (mailErr) {
        console.error("statement schedule: email failed (non-fatal)", mailErr);
      }
    }

    if (assembly.math.totals?.reconciles === false) {
      console.warn("[statement.monitor] reconcile_mismatch", {
        workspaceId: job.workspace_id,
        statementUuid: job.id,
      });
    }
    if (job.created_by) {
      await recordStatementAudit(service, {
        workspaceId: job.workspace_id,
        actorUserId: job.created_by,
        eventType: "statement.generated",
        statementUuid: job.id,
        metadata: {
          scope: job.scope,
          statementType: job.statement_type,
          transactionCount: rows.length,
          async: true,
        },
      });
    }
    return true;
  } catch (e) {
    console.error(
      "[statement.monitor] job_failed",
      { statementUuid: job.id },
      e,
    );
    try {
      await service.from("statements").update({
        status: "failed",
        failure_reason: "Generation failed. Try creating the statement again.",
      }).eq("id", job.id).eq("status", "generating");
    } catch {
      // best effort
    }
    return false;
  }
}

export async function runStatementJobsTick(): Promise<
  StatementJobsTickSummary
> {
  if (process.env.FINANCIAL_STATEMENTS_ENABLED !== "true") {
    return { picked: 0, finalized: 0, failed: 0, disabled: true };
  }
  const service = supabaseServer();
  const cutoff = new Date(Date.now() - STATEMENT_JOB_MIN_AGE_MS).toISOString();

  const { data, error } = await service
    .from("statements")
    .select(
      "id, workspace_id, created_by, statement_type, scope, account_ids, filters, period_start, period_end, timezone, notify_email, notified_at",
    )
    .eq("status", "generating")
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(STATEMENT_JOB_BATCH);

  if (error) {
    console.error("runStatementJobsTick: list failed:", error.message);
    return { picked: 0, finalized: 0, failed: 0 };
  }

  const jobs = (data ?? []) as StatementJobRow[];
  let finalized = 0;
  let failed = 0;
  for (const job of jobs) {
    if (await finalizeStatementJob(service, job)) finalized += 1;
    else failed += 1;
  }
  return { picked: jobs.length, finalized, failed };
}

type StoredStatement = {
  id: string;
  workspace_id: string;
  statement_type: StatementType;
  scope: StatementScope;
  account_ids: string[];
  filters: StatementFilters | null;
  period_start: string;
  period_end: string;
  timezone: string;
};

/**
 * Generate a fresh statement for the same account(s) and period as an
 * existing one, linked via supersedes_id. The original row is never
 * touched (master prompt section 18). The stored period is already
 * validated, so it is used directly rather than re-resolved from a preset.
 */
export async function regenerateStatement(
  statementUuid: string,
): Promise<GenerateOutcome> {
  if (!UUID_RE.test(statementUuid)) return err("invalid_input");

  const ctxRes = await resolveContext();
  if (!ctxRes.ok) return ctxRes;
  const { ctx } = ctxRes;

  const { data, error } = await ctx.session
    .from("statements")
    .select(
      "id, workspace_id, statement_type, scope, account_ids, filters, period_start, period_end, timezone",
    )
    .eq("id", statementUuid)
    .maybeSingle();

  if (error) {
    console.error("regenerateStatement: lookup failed:", error.message);
    return err("query_failed");
  }
  if (!data) return err("not_found");
  const existing = data as StoredStatement;

  // RLS already proved the caller is a member of the statement's
  // workspace, but a regeneration must run against the ACTIVE workspace -
  // assembleStatement scopes its fact query to ctx.workspace.id. Refuse
  // (generically) a statement that belongs to a different workspace than
  // the one currently selected.
  if (existing.workspace_id !== ctx.workspace.id) {
    void recordStatementAudit(supabaseServer(), {
      workspaceId: ctx.workspace.id,
      actorUserId: ctx.userId,
      eventType: "statement.access_denied",
      statementUuid: null,
      metadata: { reason: "regenerate_cross_workspace" },
    });
    return err("not_found");
  }

  const period = reconstructStatementPeriod(
    new Date(existing.period_start),
    new Date(existing.period_end),
    existing.timezone,
  );

  return persistStatement(ctx, period, {
    statementType: existing.statement_type,
    // Re-scopes to the stored account_ids. For an original "all_accounts"
    // run this now applies an explicit source filter, so a regenerated
    // statement may omit any legacy transactions that carried no
    // financial_source_id - a shrinking edge (ingestion has assigned a
    // source per transaction since the pairing auto-enroll migration).
    requestedSourceIds: existing.account_ids ?? [],
    filters: existing.filters ?? undefined,
    clientToken: crypto.randomUUID(),
    supersedesId: existing.id,
  });
}

export async function deleteStatement(
  statementUuid: string,
): Promise<DeleteOutcome> {
  if (!UUID_RE.test(statementUuid)) return err("invalid_input");

  const ctxRes = await resolveContext();
  if (!ctxRes.ok) return ctxRes;
  const { ctx } = ctxRes;

  // RLS (statements_delete_member) enforces workspace membership + the
  // 'member' minimum role; cascade removes statement_transactions.
  const { data, error } = await ctx.session
    .from("statements")
    .delete()
    .eq("id", statementUuid)
    .select("id, workspace_id, statement_id");

  if (error) {
    console.error("deleteStatement failed:", error.message);
    return err("persist_failed");
  }
  if (!data || data.length === 0) return err("not_found");

  const deleted = data[0] as {
    id: string;
    workspace_id: string;
    statement_id: string;
  };
  await recordStatementAudit(supabaseServer(), {
    workspaceId: deleted.workspace_id,
    actorUserId: ctx.userId,
    eventType: "statement.deleted",
    statementUuid: deleted.id,
    metadata: { statementId: deleted.statement_id },
  });

  return { ok: true };
}
