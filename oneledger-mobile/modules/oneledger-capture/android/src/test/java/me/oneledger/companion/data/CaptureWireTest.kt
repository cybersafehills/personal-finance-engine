package me.oneledger.companion.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Guards the wire shape against the server contract (docs/device-pairing.md):
 * exact key sets (unknown top-level keys are rejected server-side), absent
 * values as JSON null, and an empty metadata object.
 */
@RunWith(RobolectricTestRunner::class)
class CaptureWireTest {

    private fun keys(json: JSONObject): Set<String> = json.keys().asSequence().toSet()

    @Test fun `pair request carries exactly the documented fields`() {
        val json = JSONObject(pairRequestJson("olp_abcd1234567890123456", "pfe_secret", "1.2.3", "Pixel 8"))
        assertEquals(
            setOf("op", "pairing_token", "device_secret", "client_version", "platform", "device_label"),
            keys(json),
        )
        assertEquals("pair", json.getString("op"))
        assertEquals("android", json.getString("platform"))
        assertEquals("Pixel 8", json.getString("device_label"))
        assertEquals("1.2.3", json.getString("client_version"))
    }

    @Test fun `a missing device label is sent as JSON null, not dropped`() {
        val json = JSONObject(pairRequestJson("olp_x", "pfe_x", "1.0.0", null))
        assertTrue(json.has("device_label"))
        assertTrue(json.isNull("device_label"))
    }

    @Test fun `capture envelope carries exactly the documented fields`() {
        val json = JSONObject(captureEnvelopeJson("capture", "You have received 5,000 RWF", "2026-11-14T10:00:00Z", "1.2.3"))
        assertEquals(setOf("op", "message", "received_at", "client_version", "metadata"), keys(json))
        assertEquals("capture", json.getString("op"))
        assertEquals("You have received 5,000 RWF", json.getString("message"))
        assertEquals("2026-11-14T10:00:00Z", json.getString("received_at"))
        assertEquals(0, json.getJSONObject("metadata").length())
    }

    @Test fun `a test envelope sends message as JSON null`() {
        val json = JSONObject(captureEnvelopeJson("test", null, "2026-11-14T10:00:00Z", "1.2.3"))
        assertTrue(json.has("message"))
        assertTrue(json.isNull("message"))
    }

    @Test fun `message text survives JSON escaping`() {
        val message = "Line1\nLine2 \"quoted\" \\ y'ello *182#"
        val json = JSONObject(captureEnvelopeJson("capture", message, "2026-11-14T10:00:00Z", "1.0.0"))
        assertEquals(message, json.getString("message"))
    }

    @Test fun `parses a successful pair response`() {
        val parsed = parsePairResponse("""{"ok":true,"device_id":"d-1","capture_url":"https://x/capture"}""")!!
        assertTrue(parsed.ok)
        assertEquals("d-1", parsed.deviceId)
        assertEquals("https://x/capture", parsed.captureUrl)
        assertNull(parsed.error)
    }

    @Test fun `parses a rejected pair response and ignores unknown keys`() {
        val parsed = parsePairResponse("""{"ok":false,"error":"PAIRING_EXPIRED","extra":1}""")!!
        assertEquals(false, parsed.ok)
        assertEquals("PAIRING_EXPIRED", parsed.error)
        assertNull(parsed.deviceId)
    }

    @Test fun `treats JSON null fields as absent`() {
        val parsed = parsePairResponse("""{"ok":true,"device_id":null,"capture_url":null}""")!!
        assertNull(parsed.deviceId)
        assertNull(parsed.captureUrl)
    }

    @Test fun `a non-JSON body yields null rather than throwing`() {
        assertNull(parsePairResponse("<html>502</html>"))
        assertNull(parseErrorCode(""))
        assertEquals("UNKNOWN_PROVIDER", parseErrorCode("""{"ok":false,"error":"UNKNOWN_PROVIDER"}"""))
    }
}
