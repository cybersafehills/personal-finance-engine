package me.oneledger.companion.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingTokenTest {

    private val token = "olp_KHJAD33DAKUFADJG3Gxyz012"

    @Test fun bare_token_passes_through() {
        assertEquals(token, extractPairingToken(token))
        assertEquals(token, extractPairingToken("  $token  "))
        assertTrue(looksLikePairingToken(token))
    }

    @Test fun deep_link_query_is_extracted() {
        assertEquals(token, extractPairingToken("oneledger://pair?c=$token"))
        assertEquals(token, extractPairingToken("oneledger://pair?c=$token&x=1"))
    }

    @Test fun https_handoff_url_with_platform_param() {
        assertEquals(token, extractPairingToken("https://www.oneledger.me/pair?c=$token&p=android"))
        assertEquals(token, extractPairingToken("https://oneledger.me/pair?p=android&c=$token"))
    }

    @Test fun url_encoded_token_is_decoded() {
        // '_' and '-' are URL-safe, but a percent-encoded value must still work.
        assertEquals(token, extractPairingToken("https://x/pair?c=${token.replace("_", "%5F")}"))
    }

    @Test fun junk_returns_null() {
        for (s in listOf(
            "",
            "   ",
            "hello world",
            "https://oneledger.me/pair",              // no c=
            "https://oneledger.me/pair?c=not-a-token", // c= present but wrong shape
            "olp_short",
            "OLP_KHJAD33DAKUFADJG3Gxyz012",           // wrong case prefix
        )) {
            assertNull("expected null for: '$s'", extractPairingToken(s))
        }
        assertFalse(looksLikePairingToken(null))
        assertFalse(looksLikePairingToken("nope"))
    }
}
