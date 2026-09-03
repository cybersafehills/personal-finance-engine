import { assert, assertEquals } from "jsr:@std/assert@1";
import { detectProvider, PROVIDER_MATCHERS } from "../providers.ts";

// Real MTN Rwanda MoMo SMS shapes (mirrors ingest-momo/tests/fixtures.ts).
const MTN_MESSAGES = [
  "*162*TxId:29959252916*S*Your payment of 50 RWF to Airtime with token and ET Id: 29959252916 was completed at 2026-08-18 19:42:11. Fee 0 RWF. Balance: 2305 RWF . Message: - -. *RW#",
  "TxId:29946098339*S*Your payment of 4,000 RWF to KMLVIO CENTER AND MILK ZONE SHOP 093011 was completed at 2026-08-18 11:02:56. Balance: 3,675 RWF. Fee 0 RWF.*EN#",
  "*165*S*1000 RWF transferred to Samuel NSHIMIYIMANA (250793000439) at 2026-08-18 10:20:09 .Fee: 20RWF.Balance: 175RWF.Dial *182*1*3# and send money abroad *RW#",
  "You have received 7500 RWF from Ogabor JULIUS INEJI (*********901) at 2026-08-18 10:37:10 . Balance:7675 RWF. FT Id: 29945559123",
  "*164*S*Y'ello, A transaction of 11520 RWF by Yego Innovision Ltd was completed at 2026-08-15 15:46:09. Balance:24415 RWF. Fee 0 RWF. FT Id: 29887752112.*RW#",
  "*143*R*Y'ello, the transaction with amount 200 RWF for MTN RWANDACELL LIMITED with message: failed at 2026-08-16 16:22:21 .Please Contact MobileMoney Helpline for Assistance.*EN#",
];

const NOT_MTN = [
  "Your OneLedger code is 4821. It expires in 10 minutes.",
  "WIN a car! Reply YES to enter our RWF 10,000,000 promo now!!!",
  "You have topped up your account with 5000 RWF successfully. Ref: ABC123",
  "Airtel Money: You sent RWF 2000 to JOHN. Bal RWF 500. Txn 99.", // different provider
  "",
  "   ",
  "Meeting moved to 3pm — see you there.",
];

Deno.test("detectProvider: every real MTN MoMo shape resolves to mtn_momo / mtn_momo_sms_v1 / sms", () => {
  for (const m of MTN_MESSAGES) {
    const hit = detectProvider(m);
    assert(hit, `expected a provider for: ${m.slice(0, 40)}…`);
    assertEquals(hit, {
      providerKey: "mtn_momo",
      connectorKey: "mtn_momo_sms_v1",
      channel: "sms",
    });
  }
});

Deno.test("detectProvider: non-MoMo / other-provider / empty text → null", () => {
  for (const m of NOT_MTN) {
    assertEquals(
      detectProvider(m),
      null,
      `should not match: ${JSON.stringify(m.slice(0, 40))}`,
    );
  }
});

Deno.test("detectProvider: RWF alone is not enough (needs an MTN marker or a MoMo verb)", () => {
  assertEquals(detectProvider("Balance enquiry: 12,000 RWF available."), null);
  assert(
    detectProvider(
      "Your payment of 100 RWF to SHOP was completed at 2026-01-01 00:00:00.*RW#",
    ),
  );
});

Deno.test("PROVIDER_MATCHERS: keys are adapter-contract shaped", () => {
  for (const m of PROVIDER_MATCHERS) {
    assert(/^[a-z][a-z0-9_]{2,63}$/.test(m.providerKey));
    assert(/^[a-z][a-z0-9_]{2,63}$/.test(m.connectorKey));
    assertEquals(m.channel, "sms");
  }
});
