import { assertEquals } from "jsr:@std/assert@1";
import {
  formatUtilityToken,
  friendlyRevealError,
  isUtilityTokenFeatureEnabled,
  kwhText,
} from "./token-format.ts";

Deno.test("formatUtilityToken groups digits in fours", () => {
  assertEquals(
    formatUtilityToken("12345678901234567890"),
    "1234-5678-9012-3456-7890",
  );
  assertEquals(formatUtilityToken("1234-5678 9012"), "1234-5678-9012");
  assertEquals(formatUtilityToken("123456"), "1234-56");
  assertEquals(formatUtilityToken(""), "");
});

Deno.test("feature switch is opt-in on the exact string 'true'", () => {
  assertEquals(isUtilityTokenFeatureEnabled({}), false);
  assertEquals(
    isUtilityTokenFeatureEnabled({ UTILITY_TOKEN_CAPTURE_ENABLED: "TRUE" }),
    false,
  );
  assertEquals(
    isUtilityTokenFeatureEnabled({ UTILITY_TOKEN_CAPTURE_ENABLED: "true" }),
    true,
  );
});

Deno.test("reveal errors never echo raw text", () => {
  assertEquals(friendlyRevealError("rate_limited").includes("later"), true);
  assertEquals(
    friendlyRevealError("sensitive_detail_not_found").includes(
      "isn't available",
    ),
    true,
  );
  assertEquals(
    friendlyRevealError('relation "transaction_sensitive_details" secretvalue')
      .includes("secretvalue"),
    false,
  );
});

Deno.test("kwhText shows integer thousandths exactly", () => {
  assertEquals(kwhText(11900), "11.9");
  assertEquals(kwhText(2400), "2.4");
  assertEquals(kwhText(23805), "23.805");
  assertEquals(kwhText(7000), "7");
  assertEquals(kwhText(500), "0.5");
  assertEquals(kwhText(1), "0.001");
});
