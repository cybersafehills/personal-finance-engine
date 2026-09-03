package me.oneledger.companion.detection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Cross-checks the Kotlin port against the same acceptance/rejection posture as
 * `supabase/functions/_shared/providers.ts`. If a case here changes, change the
 * Deno matcher and `_shared/tests` in the same PR (ADR 0010 §Consequences).
 */
class ProviderMatchersTest {

    private val mtnAccept = listOf(
        "Y'ello. Payment of 5,000 RWF to JOHN DOE 250788xxxxxx has been completed at 2026-01-02 10:15:03. Fee was 0 RWF. New balance: 12,340 RWF. TxId: 1122334455.",
        "You have received 20,000 RWF from JANE (250788xxxxxx) at 2026-02-14 08:00:00. Message from sender: rent. Your new balance:35,000 RWF. Financial Transaction Id: 987654321.",
        "TxId: 5566778899. Your payment of 1,200 RWF to MTN Cashpower has been completed. Fee 25 RWF. New balance 4,000 RWF.",
        "*165*S*4,000 RWF transferred to AGENT 12345 (250799xxxxxx) from your mobile money account. Fee: 100 RWF. New balance: 900 RWF. *EN#",
        "A transaction of 3,000 RWF by MOMOPAY on your MOMO account was successful. Ref: ABC123.",
    )

    private val reject = listOf(
        "Your OTP code is 448291. Do not share it with anyone.",
        "Get 2GB for 1000 RWF! Dial *345# now to subscribe to our data bundle.",
        "USD 45.00 was spent on your Visa card ending 1234 at AMAZON.",
        "Your Uber is arriving now. RAF 123 K.",
        "Reminder: your appointment is at 3pm tomorrow.",
        "",
        "   ",
    )

    @Test
    fun accepts_real_mtn_momo_shapes() {
        for (msg in mtnAccept) {
            val p = detectProvider(msg)
            assertEquals("should detect mtn_momo for: $msg", "mtn_momo", p?.providerKey)
            assertEquals("mtn_momo_sms_v1", p?.connectorKey)
            assertEquals("sms", p?.channel)
        }
    }

    @Test
    fun rejects_non_financial_and_other_currency() {
        for (msg in reject) {
            assertNull("should NOT detect a provider for: '$msg'", detectProvider(msg))
        }
    }

    @Test
    fun rwf_amount_alone_is_not_enough() {
        // No MTN marker, no MoMo verb → not ours.
        assertNull(detectProvider("Balance enquiry: 10,000 RWF available."))
    }
}
