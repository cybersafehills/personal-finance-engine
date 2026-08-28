import { assertEquals } from "jsr:@std/assert@1";
import { classify } from "./classify.ts";
import { normalizeScan } from "./normalize.ts";

function cls(raw: string) {
  const n = normalizeScan(raw);
  if (!n.ok) throw new Error(`normalize rejected: ${n.reason}`);
  return classify(n.value);
}

Deno.test("classify: executable / local schemes are suspicious", () => {
  for (const raw of [
    "javascript:alert(1)",
    "data:text/html,<script>",
    "vbscript:msgbox",
    "file:///etc/passwd",
    "intent://scan/#Intent;scheme=x;end",
  ]) {
    const c = cls(raw);
    assertEquals(c.kind, "suspicious");
    if (c.kind === "suspicious") assertEquals(c.reason, "unsafe_scheme");
  }
});

Deno.test("classify: an https URL with embedded credentials is suspicious", () => {
  const c = cls("https://user:pass@pay.example/checkout");
  assertEquals(c.kind, "suspicious");
  if (c.kind === "suspicious") assertEquals(c.reason, "embedded_credentials");
});

Deno.test("classify: tel: and bare USSD -> verified_ussd", () => {
  assertEquals(cls("tel:*182*1*1%23").kind, "verified_ussd");
  assertEquals(cls("*182#").kind, "verified_ussd");
  assertEquals(cls("*182*8*1*250781234567*5000#").kind, "verified_ussd");
  assertEquals(cls("#123#").kind, "verified_ussd");
});

Deno.test("classify: JSON object and oneledger: uri -> oneledger_payment", () => {
  assertEquals(cls('{"v":1,"type":"merchant_payment"}').kind, "oneledger_payment");
  assertEquals(cls('oneledger:{"v":1}').kind, "oneledger_payment");
});

Deno.test("classify: an EMV TLV opener -> emv_merchant", () => {
  assertEquals(cls("000201010211...6304ABCD").kind, "emv_merchant");
});

Deno.test("classify: https URL -> provider_link; other schemes -> unsupported", () => {
  assertEquals(cls("https://pay.example/x").kind, "provider_link");
  assertEquals(cls("weirdscheme://foo").kind, "unsupported");
  assertEquals(cls("just some text").kind, "unsupported");
});
