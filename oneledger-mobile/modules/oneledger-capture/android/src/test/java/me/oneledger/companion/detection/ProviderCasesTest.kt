package me.oneledger.companion.detection

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

/**
 * Cross-language guard (ADR 0019 §3). Runs the SAME
 * `supabase/functions/_shared/tests/provider-cases.json` that the Deno suite
 * (`provider_cases_test.ts`) runs against `providers.ts`, so the on-device
 * matcher and the server can never disagree about what is a provider message.
 */
@RunWith(RobolectricTestRunner::class)
class ProviderCasesTest {

    private fun fixture(): File {
        // Walk up from the Gradle working directory to the repository root.
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val candidate = File(dir, "supabase/functions/_shared/tests/provider-cases.json")
            if (candidate.isFile) return candidate
            dir = dir.parentFile
        }
        error("provider-cases.json not found above ${File("").absolutePath}")
    }

    @Test
    fun kotlin_matcher_agrees_with_the_shared_cases() {
        val cases = JSONObject(fixture().readText(Charsets.UTF_8)).getJSONArray("cases")
        assertTrue("fixture should not be empty", cases.length() > 0)

        var accepted = 0
        var rejected = 0
        for (i in 0 until cases.length()) {
            val case = cases.getJSONObject(i)
            val message = case.getString("message")
            val expected = if (case.isNull("provider")) null else case.getString("provider")
            assertEquals(
                "case $i: ${message.take(40)}",
                expected,
                detectProvider(message)?.providerKey,
            )
            if (expected == null) rejected++ else accepted++
        }
        assertTrue("fixture needs accept cases", accepted > 0)
        assertTrue("fixture needs reject cases", rejected > 0)
    }
}
