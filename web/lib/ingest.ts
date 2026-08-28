// The single place the MoMo ingestion endpoint URL and its request
// contract are described for UI and documentation surfaces. The Edge
// Function itself (supabase/functions/ingest-momo/) remains the source of
// truth for the *behaviour*; this module only mirrors the request shape a
// device (an iPhone Shortcut, or an equivalent SMS forwarder) has to
// send, so the Connections screen and docs/momo-ingest-contract.md can
// never drift from a hand-copied path.
//
// Deliberately env-free and free of `server-only`: it is imported by a
// client component (ConnectionDetails) and type-checked by `deno test
// web/lib`. Callers pass the Supabase URL in; they never read it here.

/** The deployed Edge Function slug. */
export const INGEST_FUNCTION_SLUG = "ingest-momo";

/**
 * `https://<project-ref>.supabase.co/functions/v1/ingest-momo`, or `null`
 * when no Supabase URL is configured (a misconfigured build/preview - the
 * caller should render a "not available" state rather than a broken URL).
 * Any single trailing slash on the base is tolerated.
 */
export function buildIngestEndpointUrl(
  supabaseUrl: string | null | undefined,
): string | null {
  const base = supabaseUrl?.trim();
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/functions/v1/${INGEST_FUNCTION_SLUG}`;
}

/**
 * The request contract, as enforced by
 * supabase/functions/ingest-momo/index.ts. `verify_jwt = false` for this
 * function (supabase/config.toml) - the ONLY credential is `authHeader`.
 */
export const INGEST_REQUEST = {
  method: "POST",
  /** Per-connection ingestion credential (`pfe_…`). No Supabase JWT. */
  authHeader: "x-ingest-key",
  contentType: "application/json",
  /** `message` is required; `received_at` is an optional ISO-8601 string. */
  bodyFields: ["message", "received_at"],
  /** `index.ts` rejects a trimmed message longer than this with 413. */
  maxMessageChars: 5000,
} as const;

/** A copy-pasteable request body, with placeholders a device fills in. */
export const INGEST_BODY_EXAMPLE = JSON.stringify(
  { message: "<the full SMS text>", received_at: "<ISO-8601 timestamp>" },
  null,
  2,
);

/**
 * Plain-language meaning of every response the function returns, keyed by
 * the machine string it puts in `error` (failures) or `status` (2xx).
 * Mirrors the branches in index.ts / the parser; also tabulated in
 * docs/momo-ingest-contract.md.
 */
export const INGEST_RESPONSE_HELP: Record<string, string> = {
  // 2xx — {ok:true, status:…}
  processed: "Recorded. The transaction appears in your ledger.",
  needs_review:
    "Received and kept, but the format wasn't recognised - it goes to your review queue, never a guessed transaction.",
  duplicate: "This exact SMS was already received. Nothing was added twice.",
  // 4xx / 5xx — {ok:false, error:…}
  unauthorized:
    "The key is missing, wrong, revoked, or paused. Rotate the credential below and update your Shortcut.",
  invalid_json: "The request body wasn't valid JSON.",
  invalid_request_body: "The request body wasn't a JSON object.",
  missing_message: "The forwarded message was empty.",
  message_too_large: `The message was over ${INGEST_REQUEST.maxMessageChars} characters.`,
  not_rwf_message:
    "That SMS didn't contain an \"RWF\" amount, so it wasn't treated as a MoMo transaction. Nothing was recorded.",
  method_not_allowed: "Only POST is accepted.",
  database_error: "A temporary problem on our side. Safe to retry.",
};
