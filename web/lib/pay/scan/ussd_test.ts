import { assert, assertEquals } from "jsr:@std/assert@1";
import { matchesTemplate, parseUssd, templatePlaceholders } from "./ussd.ts";

Deno.test("parseUssd: strips tel:, decodes %23 / %2A, canonicalises", () => {
  const r = parseUssd("tel:*182*1*1%23");
  assert(r.ok);
  assertEquals(r.value.dial, "*182*1*1#");

  const r2 = parseUssd("%2A182%23");
  assert(r2.ok);
  assertEquals(r2.value.dial, "*182#");
});

Deno.test("parseUssd: re-adds a dropped trailing #", () => {
  const r = parseUssd("tel:*182*1*1");
  assert(r.ok);
  assertEquals(r.value.dial, "*182*1*1#");
});

Deno.test("parseUssd: rejects non-USSD characters and path tricks", () => {
  for (const bad of [
    "tel:*182*abc#",
    "*182*1*1*/etc#",
    "*182%2Fpath#",
    "*#",
    "**182#",
    "*182**1#",
    "*182*1*1", // no digits after re-add would still be fine; this one is fine actually
  ]) {
    const r = parseUssd(bad);
    if (bad === "*182*1*1") {
      assert(r.ok);
      continue;
    }
    assert(!r.ok, `expected reject for ${bad}`);
    assertEquals(r.reason, "malformed_ussd");
  }
});

Deno.test("parseUssd: rejects an over-long body", () => {
  const r = parseUssd("*" + "1".repeat(80) + "#");
  assert(!r.ok);
  assertEquals(r.reason, "malformed_ussd");
});

Deno.test("templatePlaceholders: extracts {key} names, lower-cased", () => {
  assertEquals(templatePlaceholders("*182*8*1*{Merchant}*{amount}#"), [
    "merchant",
    "amount",
  ]);
  assertEquals(templatePlaceholders("*182#"), []);
});

Deno.test("matchesTemplate: a literal template matches only exactly", () => {
  assert(matchesTemplate("*182#", "*182#"));
  assertEquals(matchesTemplate("*182*1#", "*182#"), null);
});

Deno.test("matchesTemplate: a parameterised template captures the digit runs", () => {
  const hit = matchesTemplate(
    "*182*8*1*123456*5000#",
    "*182*8*1*{merchant}*{amount}#",
  );
  assert(hit);
  assertEquals(hit.params, { merchant: "123456", amount: "5000" });
});

Deno.test("matchesTemplate: a parameterised template rejects a shape mismatch", () => {
  assertEquals(
    matchesTemplate("*182*9*1*123456*5000#", "*182*8*1*{merchant}*{amount}#"),
    null,
  );
  assertEquals(
    matchesTemplate("*182*8*1*abc*5000#", "*182*8*1*{merchant}*{amount}#"),
    null,
  );
});
