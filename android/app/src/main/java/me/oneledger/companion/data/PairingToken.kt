package me.oneledger.companion.data

import java.net.URLDecoder

/** Matches the server's `^olp_[A-Za-z0-9]{4}[A-Za-z0-9_-]{16,}$`. */
internal val PAIRING_TOKEN_REGEX = Regex("^olp_[A-Za-z0-9]{4}[A-Za-z0-9_-]{16,}$")

fun looksLikePairingToken(raw: String?): Boolean =
    PAIRING_TOKEN_REGEX.matches(raw?.trim().orEmpty())

/**
 * Pull an `olp_…` pairing token out of whatever a scan / paste / deep link
 * produced:
 *  - a bare token
 *  - an `oneledger://pair?c=<token>` deep link
 *  - an `https://…/pair?c=<token>[&p=android]` handoff URL (any host)
 * Returns null when nothing token-shaped is present.
 */
fun extractPairingToken(raw: String?): String? {
    val s = raw?.trim().orEmpty()
    if (s.isEmpty()) return null
    if (PAIRING_TOKEN_REGEX.matches(s)) return s
    val fromQuery = Regex("[?&]c=([^&#\\s]+)").find(s)?.groupValues?.get(1)
        ?.let { runCatching { URLDecoder.decode(it, "UTF-8") }.getOrNull() }
    return fromQuery?.takeIf { PAIRING_TOKEN_REGEX.matches(it) }
}
