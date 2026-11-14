package me.oneledger.companion.util

import java.security.SecureRandom
import java.security.MessageDigest

/** Lowercase hex SHA-256, matching the server's `^[0-9a-f]{64}$` columns. */
fun sha256Hex(input: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
    return digest.joinToString("") { "%02x".format(it) }
}

private const val URL_SAFE_ALPHABET =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

/**
 * Generates the device's own long-lived secret: `pfe_` + [bodyLength] url-safe
 * chars, so it satisfies the server's `^pfe_[A-Za-z0-9_-]{20,}$` pattern and
 * shares the `pfe_` credential family used across the codebase (ADR 0008 §1).
 * The caller stores this once and never renders it.
 */
fun generateDeviceSecret(bodyLength: Int = 24): String {
    require(bodyLength >= 20) { "device secret body must be at least 20 chars" }
    val rng = SecureRandom()
    val sb = StringBuilder("pfe_")
    repeat(bodyLength) {
        sb.append(URL_SAFE_ALPHABET[rng.nextInt(URL_SAFE_ALPHABET.length)])
    }
    return sb.toString()
}
