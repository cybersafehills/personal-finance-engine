package me.oneledger.companion.detection

/**
 * On-device provider detection — a direct port of
 * `supabase/functions/_shared/providers.ts` (ADR 0009 §3, ADR 0010 §2).
 *
 * The listener runs this against every notification BEFORE anything leaves the
 * device. A message that matches no provider is discarded: never parsed, never
 * queued, never sent, never logged. `detect` is deliberately permissive
 * ("plausibly this provider's financial SMS") — a genuine-but-unparseable
 * message still becomes preserved server-side evidence; the server's
 * provider-specific parser makes the final "parseable vs review" call.
 *
 * Keep this in lockstep with the Deno version. `ProviderMatchersTest` carries
 * the same accept/reject cases as `_shared/tests` — it is the cross-language
 * guard.
 */

data class DetectedProvider(
    /** Canonical provider identifier, e.g. `mtn_momo`. */
    val providerKey: String,
    /** The connector adapter contract key, e.g. `mtn_momo_sms_v1`. */
    val connectorKey: String,
    val channel: String = "sms",
)

private data class ProviderMatcher(
    val provider: DetectedProvider,
    val detect: (String) -> Boolean,
)

// MTN Rwanda Mobile Money SMS. Markers seen across every real fixture in
// ingest-momo/tests/fixtures.ts: an RWF amount plus at least one MTN-specific
// token or a Mobile Money transaction verb.
private val MTN_MARKERS: List<Regex> = listOf(
    Regex("y['’]ello", RegexOption.IGNORE_CASE),
    Regex("mobile\\s?money", RegexOption.IGNORE_CASE),
    Regex("\\bTxId:", RegexOption.IGNORE_CASE),
    Regex("\\bFT\\s?Id:", RegexOption.IGNORE_CASE),
    Regex("\\bET\\s?Id:", RegexOption.IGNORE_CASE),
    Regex("\\*(?:RW|EN)#\\s*$", RegexOption.IGNORE_CASE),
    Regex("\\bDial\\s+\\*\\d", RegexOption.IGNORE_CASE),
)

private val MTN_VERBS: List<Regex> = listOf(
    Regex("payment of\\s+[\\d,]+\\s+RWF", RegexOption.IGNORE_CASE),
    Regex("[\\d,]+\\s+RWF\\s+transferred to\\b", RegexOption.IGNORE_CASE),
    Regex("you have received\\s+[\\d,]+\\s+RWF", RegexOption.IGNORE_CASE),
    Regex("a transaction of\\s+[\\d,]+\\s+RWF", RegexOption.IGNORE_CASE),
    Regex("transaction with amount\\s+[\\d,]+\\s+RWF", RegexOption.IGNORE_CASE),
)

private fun looksLikeMtnMomo(message: String): Boolean {
    if (!Regex("\\bRWF\\b", RegexOption.IGNORE_CASE).containsMatchIn(message)) return false
    return MTN_MARKERS.any { it.containsMatchIn(message) } ||
        MTN_VERBS.any { it.containsMatchIn(message) }
}

private val PROVIDER_MATCHERS: List<ProviderMatcher> = listOf(
    ProviderMatcher(
        provider = DetectedProvider(
            providerKey = "mtn_momo",
            connectorKey = "mtn_momo_sms_v1",
            channel = "sms",
        ),
        detect = ::looksLikeMtnMomo,
    ),
)

/**
 * Notifications from these packages are never a provider's financial message —
 * skip them before running any regex. This is a *denylist*, deliberately:
 * a real MoMo/bank SMS surfaces in whatever app renders it (Google Messages,
 * Samsung Messages, Xiaomi's, a carrier app, the MoMo app…), and an allowlist
 * of guessed package names silently drops transactions on any phone we didn't
 * predict. The text matcher (`detectProvider`, ADR 0009 §3) is the real gate.
 */
val IGNORED_NOTIFICATION_PACKAGES: Set<String> = setOf(
    "android",
    "com.android.systemui",
    "com.android.shell",
    "com.google.android.gms", // Play services housekeeping
    "me.oneledger.companion",
    "me.oneledger.companion.debug",
)

/** First matcher whose `detect` accepts the message, or `null` (unknown). */
fun detectProvider(message: String?): DetectedProvider? {
    val trimmed = message?.trim().orEmpty()
    if (trimmed.isEmpty()) return null
    return PROVIDER_MATCHERS.firstOrNull { it.detect(trimmed) }?.provider
}
