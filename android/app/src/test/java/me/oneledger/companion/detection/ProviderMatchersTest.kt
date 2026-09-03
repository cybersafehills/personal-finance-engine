package me.oneledger.companion.detection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The cross-language guard for the Kotlin port of
 * `supabase/functions/_shared/providers.ts`. The two lists below are copied
 * verbatim from `supabase/functions/_shared/tests/providers_test.ts` — if a
 * case changes there, change it here (and the matcher in both languages) in the
 * same PR. This test proves the ports agree, not that the matcher is "good".
 */
class ProviderMatchersTest {

    // Real MTN Rwanda MoMo SMS shapes (mirrors ingest-momo/tests/fixtures.ts).
    private val mtnMessages = listOf(
        "*162*TxId:29959252916*S*Your payment of 50 RWF to Airtime with token and ET Id: 29959252916 was completed at 2026-08-18 19:42:11. Fee 0 RWF. Balance: 2305 RWF . Message: - -. *RW#",
        "TxId:29946098339*S*Your payment of 4,000 RWF to KMLVIO CENTER AND MILK ZONE SHOP 093011 was completed at 2026-08-18 11:02:56. Balance: 3,675 RWF. Fee 0 RWF.*EN#",
        "*165*S*1000 RWF transferred to Samuel NSHIMIYIMANA (250793000439) at 2026-08-18 10:20:09 .Fee: 20RWF.Balance: 175RWF.Dial *182*1*3# and send money abroad *RW#",
        "You have received 7500 RWF from Ogabor JULIUS INEJI (*********901) at 2026-08-18 10:37:10 . Balance:7675 RWF. FT Id: 29945559123",
        "*164*S*Y'ello, A transaction of 11520 RWF by Yego Innovision Ltd was completed at 2026-08-15 15:46:09. Balance:24415 RWF. Fee 0 RWF. FT Id: 29887752112.*RW#",
        "*143*R*Y'ello, the transaction with amount 200 RWF for MTN RWANDACELL LIMITED with message: failed at 2026-08-16 16:22:21 .Please Contact MobileMoney Helpline for Assistance.*EN#",
    )

    private val notMtn = listOf(
        "Your OneLedger code is 4821. It expires in 10 minutes.",
        "WIN a car! Reply YES to enter our RWF 10,000,000 promo now!!!",
        "You have topped up your account with 5000 RWF successfully. Ref: ABC123",
        "Airtel Money: You sent RWF 2000 to JOHN. Bal RWF 500. Txn 99.", // different provider
        "",
        "   ",
        "Meeting moved to 3pm — see you there.",
    )

    @Test
    fun every_real_mtn_momo_shape_resolves_to_the_adapter_contract() {
        for (m in mtnMessages) {
            val hit = detectProvider(m)
            assertEquals("expected mtn_momo for: ${m.take(40)}…", "mtn_momo", hit?.providerKey)
            assertEquals("mtn_momo_sms_v1", hit?.connectorKey)
            assertEquals("sms", hit?.channel)
        }
    }

    @Test
    fun non_momo_other_provider_and_empty_text_are_turned_away() {
        for (m in notMtn) {
            assertNull("should not match: ${m.take(40)}", detectProvider(m))
        }
    }

    @Test
    fun rwf_alone_is_not_enough_needs_a_marker_or_a_verb() {
        assertNull(detectProvider("Balance enquiry: 12,000 RWF available."))
        assertEquals(
            "mtn_momo",
            detectProvider(
                "Your payment of 100 RWF to SHOP was completed at 2026-01-01 00:00:00.*RW#",
            )?.providerKey,
        )
    }
}
