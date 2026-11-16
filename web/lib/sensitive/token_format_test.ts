import { assertEquals } from "jsr:@std/assert@1";
import {
  formatUtilityToken,
  friendlyRevealError,
  isUtilityTokenFeatureEnabled,
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
