import { createClient } from "npm:@supabase/supabase-js@2";
import {
  extractInboundToken,
  extractRows,
  parseInboundPayload,
  readConfig,
  readSvixHeaders,
  summarize,
  timestampWithinTolerance,
  verifySvixSignature,
} from "./lib.ts";

// inbound-email (ADR 0018 Slice B): the Resend Inbound webhook. Mail sent
// to a source's private address (`u+<token>@<domain>`) is verified,
// resolved to a financial_source, parsed (CSV attachments + plain-text
// body), and imported through the same path as a manual upload
// (import_statement_rows_for_source -> _import_statement_rows).
//
// Dark unless EMAIL_STATEMENT_INGEST_ENABLED === "true" AND
// INBOUND_EMAIL_WEBHOOK_SECRET is set - a missing config is a clean no-op
// (HTTP 200, nothing imported), never an error, so a misconfigured
// webhook doesn't wedge the provider's retry queue.
//
// This endpoint is unauthenticated by nature; every real guard is here:
//   - verify the Svix provider signature (never trust the body otherwise)
//   - reject a stale timestamp (replay window 5 min)
//   - the `From:` address is never trusted - only the opaque token in the
//     recipient, and only if it resolves to a live source
//   - attachments are size-capped and only CSV/TSV/txt are parsed
//   - the import RPC re-validates and de-dupes every row

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function logEvent(event: string, extra: Record<string, unknown> = {}): void {
  // No token, no source id, no sender - just shape/counts.
  console.log(JSON.stringify({ fn: "inbound-email", event, ...extra }));
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const config = readConfig((k) => Deno.env.get(k) ?? undefined);
  if (!config.enabled) {
    logEvent("skipped", { reason: config.reason });
    // 200 so Resend doesn't retry a deliberately-dark endpoint.
    return json(summarize({ status: "skipped", reason: config.reason }));
  }

  const svix = readSvixHeaders(request.headers);
  if (!svix) {
    logEvent("rejected", { reason: "missing_signature_headers" });
    return json({ ok: false, error: "missing_signature" }, 401);
  }

  const body = await request.text();

  const signatureOk = await verifySvixSignature({
    secret: config.secret,
    id: svix.id,
    timestamp: svix.timestamp,
    signature: svix.signature,
    body,
  });
  if (!signatureOk) {
    logEvent("rejected", { reason: "bad_signature" });
    return json({ ok: false, error: "bad_signature" }, 401);
  }

  if (
    !timestampWithinTolerance(svix.timestamp, Math.floor(Date.now() / 1000))
  ) {
    logEvent("rejected", { reason: "stale_timestamp" });
    return json({ ok: false, error: "stale_timestamp" }, 401);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(body);
  } catch {
    logEvent("rejected", { reason: "bad_json" });
    return json({ ok: false, error: "bad_json" }, 400);
  }

  const email = parseInboundPayload(parsedJson);
  if (!email) {
    logEvent("ignored", { reason: "not_an_inbound_email" });
    return json(summarize({ status: "no_source" }));
  }

  const token = extractInboundToken(email.recipients, config.domain);
  if (!token) {
    logEvent("ignored", { reason: "no_matching_recipient" });
    return json(summarize({ status: "no_source" }));
  }

  const { data: sourceId, error: resolveError } = await supabase.rpc(
    "resolve_ingest_email_source",
    { p_token: token },
  );
  if (resolveError) {
    logEvent("error", { stage: "resolve", code: resolveError.code ?? null });
    return json({ ok: false, error: "resolve_failed" }, 500);
  }
  if (!sourceId) {
    logEvent("ignored", { reason: "unknown_token" });
    // 200: a stale / revoked address isn't an error worth retrying.
    return json(summarize({ status: "no_source" }));
  }

  const { rows, skipped, sources } = extractRows(email);
  if (rows.length === 0) {
    logEvent("no_rows", { skipped, hasText: email.text.trim().length > 0 });
    return json(summarize({ status: "no_rows" }));
  }

  const { data, error } = await supabase.rpc(
    "import_statement_rows_for_source",
    {
      p_financial_source_id: sourceId,
      p_rows: rows,
      p_actor_user_id: null,
    },
  );
  if (error) {
    logEvent("error", { stage: "import", code: error.code ?? null });
    return json({ ok: false, error: "import_failed" }, 500);
  }

  const result = (data ?? {}) as Record<string, unknown>;
  const created = Number(result.created ?? 0);
  const flaggedPossibleDuplicate = Number(
    result.flagged_possible_duplicate ?? 0,
  );
  const rpcSkipped = Number(result.skipped ?? 0);

  logEvent("imported", {
    created,
    flagged: flaggedPossibleDuplicate,
    skipped: rpcSkipped + skipped,
    parts: sources.length,
  });

  return json(
    summarize({
      status: "imported",
      created,
      flaggedPossibleDuplicate,
      skipped: rpcSkipped + skipped,
      sources,
    }),
  );
});
