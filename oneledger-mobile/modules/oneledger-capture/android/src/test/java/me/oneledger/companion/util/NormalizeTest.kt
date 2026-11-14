package me.oneledger.companion.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NormalizeTest {

    @Test
    fun collapses_nbsp_and_whitespace_runs_like_the_deno_version() {
        val nbsp = ' '
        val input = "Payment${nbsp}of   5,000\tRWF\n\ncompleted "
        assertEquals("Payment of 5,000 RWF completed", normalizeMessage(input))
    }

    @Test
    fun minute_bucket_truncates_iso_instant() {
        assertEquals("2026-01-02T10:15", minuteBucket("2026-01-02T10:15:03.123Z"))
        assertEquals("2026-01-02T10:15", minuteBucket("2026-01-02T10:15"))
    }

    @Test
    fun device_secret_matches_server_pattern() {
        val re = Regex("^pfe_[A-Za-z0-9_-]{20,}$")
        repeat(50) { assertTrue(re.matches(generateDeviceSecret())) }
    }

    @Test
    fun sha256_is_lowercase_hex_64() {
        val h = sha256Hex("abc")
        assertEquals(64, h.length)
        assertTrue(Regex("^[0-9a-f]{64}$").matches(h))
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", h)
    }
}
