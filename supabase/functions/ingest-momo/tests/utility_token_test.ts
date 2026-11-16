import { assertEquals, assertNotMatch } from "jsr:@std/assert@1";
import { parseMomoMessage } from "../parser.ts";
import {
  extractUtilityTokenDetails,
  redactTokenFromLabel,
} from "../utility-token.ts";

// ALL MESSAGES HERE ARE SYNTHETIC (invented for this test; no real subscriber,
// meter or token). They follow the "...with token ..." wording the repo's own
// airtime comment documents; real Cash Power SMS must be added as fixtures
// before extraction is relied on.

const TOKEN_DASHED = "1234-5678-9012-3456-7890";
const TOKEN_DIGITS = "12345678901234567890";
const msg = (label: string, extra = "") =>
  `TxId: 998877. Your payment of 5,000 RWF to ${label} was completed at 2026-08-10 14:05:33. ${extra} Fee was 0 RWF. Your new balance: 12,000 RWF.`;

Deno.test("token + kWh are extracted as digits / dot-decimal", () => {
  const d = extractUtilityTokenDetails(
    msg(`EUCL with token ${TOKEN_DASHED}`, "You bought 25,5 kWh."),
  );
  assertEquals(d.token, TOKEN_DIGITS);
  assertEquals(d.kwh, "25.5");
  assertEquals(d.tokenMentioned, true);
  assertEquals(
    extractUtilityTokenDetails(msg(`EUCL with token ${TOKEN_DIGITS}`)).token,
    TOKEN_DIGITS,
  );
  assertEquals(
    extractUtilityTokenDetails(msg("EUCL with token 1234 5678 9012 3456 7890"))
      .token,
    TOKEN_DIGITS,
  );
});

Deno.test("never invents values: no token, malformed token, wrong length", () => {
  for (
    const m of [
      msg("KMLVIO SHOP 093011"),
      msg("EUCL with token 12-34"),
      msg("EUCL with token 123456789012345"),
      msg("EUCL with token 1234567890123456789012345"),
    ]
  ) {
    assertEquals(extractUtilityTokenDetails(m).token, null, m);
  }
  assertEquals(
    extractUtilityTokenDetails(msg("EUCL with token 12-34")).tokenMentioned,
    true,
  );
  assertEquals(extractUtilityTokenDetails(msg("Shop")).kwh, null);
  assertEquals(extractUtilityTokenDetails(msg("Shop")).tokenMentioned, false);
});

Deno.test("label redaction removes any token tail, even an unrecognised shape", () => {
  assertEquals(redactTokenFromLabel(`EUCL with token ${TOKEN_DASHED}`), "EUCL");
  assertEquals(redactTokenFromLabel(`EUCL with token ${TOKEN_DIGITS}`), "EUCL");
  assertEquals(redactTokenFromLabel("EUCL with token ABCD-???"), "EUCL"); // unparseable -> still removed
  assertEquals(
    redactTokenFromLabel("EUCL token: 1234 5678 9012 3456 7890"),
    "EUCL",
  );
  assertEquals(redactTokenFromLabel(`EUCL 12345678901234567890`), "EUCL"); // stray long digit run
  assertEquals(
    redactTokenFromLabel("KMLVIO CENTER AND MILK ZONE SHOP 093011"),
    "KMLVIO CENTER AND MILK ZONE SHOP 093011",
  );
});

Deno.test("parser: the token reaches NO display field (name, reference, metadata) and travels only in `sensitive`", () => {
  for (const token of [TOKEN_DASHED, TOKEN_DIGITS]) {
    const p = parseMomoMessage(
      msg(`EUCL with token ${token}`, "You bought 10 kWh."),
    )!;
    assertEquals(p.transaction_type, "merchant_payment");
    assertEquals(p.counterparty_name, "EUCL");
    assertEquals(p.counterparty_reference, null);
    assertEquals(p.amount_rwf, 5000);
    assertEquals(p.metadata.utility_token_present, true);
    assertEquals(p.metadata.kwh, "10");
    assertEquals(p.sensitive, { utility_token: TOKEN_DIGITS });
    const shown = JSON.stringify({ ...p, sensitive: undefined });
    assertNotMatch(shown, /1234[-\s]?5678|12345678901234567890/);
  }
});

Deno.test("parser: an unrecognised token shape is still kept out of the label and stored nowhere", () => {
  const p = parseMomoMessage(msg("EUCL with token ABCD-EFGH-???"))!;
  assertEquals(p.counterparty_name, "EUCL");
  assertEquals(p.sensitive, undefined);
  assertEquals(p.metadata.utility_token_present, true);
});

Deno.test("parser: ordinary merchant payments are unchanged (no sensitive, no extra metadata, reference kept)", () => {
  const p = parseMomoMessage(msg("KMLVIO CENTER AND MILK ZONE SHOP 093011"))!;
  assertEquals(p.counterparty_name, "KMLVIO CENTER AND MILK ZONE SHOP");
  assertEquals(p.counterparty_reference, "093011");
  assertEquals(p.metadata, { parser_pattern: "merchant_payment" });
  assertEquals("sensitive" in p, false);
});
