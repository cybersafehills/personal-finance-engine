package me.oneledger.companion

import org.junit.Assert.assertEquals
import org.junit.Test

class CaptureConfigTest {

    @Test fun `passes a plain semver through`() {
        assertEquals("1.2.3", normalizeClientVersion("1.2.3"))
    }

    @Test fun `strips suffixes the server would reject`() {
        assertEquals("0.1.0", normalizeClientVersion("0.1.0-debug"))
        assertEquals("2.10.4", normalizeClientVersion("v2.10.4 (57)"))
    }

    @Test fun `falls back when there is no usable version`() {
        assertEquals("0.0.0", normalizeClientVersion(null))
        assertEquals("0.0.0", normalizeClientVersion(""))
        assertEquals("0.0.0", normalizeClientVersion("1.2"))
    }
}
