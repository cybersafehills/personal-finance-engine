package me.oneledger.companion.data

import androidx.test.core.app.ApplicationProvider
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The HTTP contract with `/capture` (docs/device-pairing.md), against a local
 * mock server: what is sent, and how each status maps to a queue decision.
 */
@RunWith(RobolectricTestRunner::class)
class CaptureClientTest {

    private lateinit var server: MockWebServer
    private lateinit var store: FakeDeviceStore
    private lateinit var client: CaptureClient

    /** In-memory stand-in: the real store needs the Android Keystore. */
    private class FakeDeviceStore(
        override var deviceSecret: String? = null,
        override var captureUrl: String? = null,
    ) : DeviceCredentials

    @Before fun setUp() {
        server = MockWebServer().apply { start() }
        store = FakeDeviceStore(
            deviceSecret = "pfe_test_secret_0123456789ab",
            captureUrl = server.url("/capture").toString(),
        )
        client = CaptureClient(deviceStore = store, clientVersion = "1.2.3")
        // Touch the application so Robolectric is fully initialised.
        ApplicationProvider.getApplicationContext<android.content.Context>()
    }

    @After fun tearDown() = server.shutdown()

    private fun respond(code: Int, body: String = "{}") =
        server.enqueue(MockResponse().setResponseCode(code).setBody(body))

    @Test fun `capture sends the envelope with the device key header`() {
        respond(202, """{"ok":true,"status":"queued"}""")
        val outcome = client.capture("You have received 5,000 RWF", "2026-11-14T10:00:00Z")

        assertEquals(SendOutcome.Accepted, outcome)
        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/capture", request.path)
        assertEquals("pfe_test_secret_0123456789ab", request.getHeader("x-device-key"))
        val body = JSONObject(request.body.readUtf8())
        assertEquals("capture", body.getString("op"))
        assertEquals("You have received 5,000 RWF", body.getString("message"))
        assertEquals("1.2.3", body.getString("client_version"))
    }

    @Test fun `a duplicate is treated as delivered`() {
        respond(200, """{"ok":true,"status":"duplicate"}""")
        assertEquals(SendOutcome.Accepted, client.capture("m", "2026-11-14T10:00:00Z"))
    }

    @Test fun `401 means the credential is gone`() {
        respond(401, """{"ok":false,"error":"INVALID_DEVICE_CREDENTIAL"}""")
        assertEquals(SendOutcome.Unauthorized, client.capture("m", "2026-11-14T10:00:00Z"))
    }

    @Test fun `structural rejections are permanent and carry the server code`() {
        respond(422, """{"ok":false,"error":"UNKNOWN_PROVIDER"}""")
        assertEquals(
            SendOutcome.PermanentReject("UNKNOWN_PROVIDER"),
            client.capture("m", "2026-11-14T10:00:00Z"),
        )
        respond(400, "not json")
        assertEquals(
            SendOutcome.PermanentReject("REJECTED_400"),
            client.capture("m", "2026-11-14T10:00:00Z"),
        )
    }

    @Test fun `rate limits and server errors are retried`() {
        respond(429)
        assertEquals(SendOutcome.Retry("rate_limited"), client.capture("m", "2026-11-14T10:00:00Z"))
        respond(503)
        assertEquals(SendOutcome.Retry("server_503"), client.capture("m", "2026-11-14T10:00:00Z"))
    }

    @Test fun `nothing is sent without a stored secret`() {
        store.deviceSecret = null
        assertEquals(SendOutcome.Unauthorized, client.capture("m", "2026-11-14T10:00:00Z"))
        assertEquals(0, server.requestCount)
    }

    @Test fun `test op sends no message and no key is leaked into the body`() {
        respond(200, """{"ok":true,"test":true}""")
        assertEquals(SendOutcome.Accepted, client.test())
        val raw = server.takeRequest().body.readUtf8()
        val body = JSONObject(raw)
        assertEquals("test", body.getString("op"))
        assertTrue(body.isNull("message"))
        assertTrue("secret must travel only in the header", !raw.contains("pfe_test_secret"))
    }

    @Test fun `pair posts the device-generated secret once and returns the routing`() {
        respond(200, """{"ok":true,"device_id":"dev-1","capture_url":"https://api.example/capture"}""")
        val outcome = client.pair("olp_abcd1234567890123456", "pfe_new_secret_0123456789ab", "Pixel 8")

        assertEquals(PairOutcome.Success("dev-1", "https://api.example/capture"), outcome)
        val request = server.takeRequest()
        assertNull("pair is unauthenticated", request.getHeader("x-device-key"))
        val body = JSONObject(request.body.readUtf8())
        assertEquals("pair", body.getString("op"))
        assertEquals("olp_abcd1234567890123456", body.getString("pairing_token"))
        assertEquals("pfe_new_secret_0123456789ab", body.getString("device_secret"))
        assertEquals("android", body.getString("platform"))
    }

    @Test fun `pair maps a dark endpoint and server refusals`() {
        respond(404, "Not Found")
        assertEquals(PairOutcome.Rejected("FEATURE_OFF", 404), client.pair("t", "s", null))
        respond(410, """{"ok":false,"error":"PAIRING_EXPIRED"}""")
        assertEquals(PairOutcome.Rejected("PAIRING_EXPIRED", 410), client.pair("t", "s", null))
        respond(200, """{"ok":true}""")
        assertEquals(PairOutcome.Rejected("PAIRING_INVALID", 200), client.pair("t", "s", null))
    }
}
