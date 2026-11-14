package me.oneledger.companion.util

/** Non-breaking space; MTN MoMo SMS bodies use it as a thousands separator. */
private const val NBSP = ' '

/**
 * Mirror of `supabase/functions/ingest-momo/parser-utils.ts` `normalizeMessage`:
 * replace non-breaking spaces with a normal space, collapse runs of whitespace
 * to one space, and trim. Used only for the on-device dedupe key — the server
 * recomputes its own `payload_hash` from the raw `message`, so this staying
 * byte-identical to the Deno version is a courtesy, not a correctness
 * requirement (ADR 0010 §4).
 */
fun normalizeMessage(input: String): String =
    input.replace(NBSP, ' ')
        .replace(Regex("\\s+"), " ")
        .trim()

/** ISO-8601 instant truncated to the minute, for the dedupe key. */
fun minuteBucket(isoInstant: String): String =
    if (isoInstant.length >= 16) isoInstant.substring(0, 16) else isoInstant
