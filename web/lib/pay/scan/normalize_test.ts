import { assert, assertEquals } from "jsr:@std/assert@1";
import { normalizeScan, toDisplaySafe } from "./normalize.ts";

Deno.test("normalizeScan: trims and lowercases the prefix view", () => {
  const r = normalizeScan("  HTTPS://Pay.Example/x  ");
  assert(r.ok);
  assertEquals(r.value.raw, "HTTPS://Pay.Example/x");
  assertEquals(r.value.lower, "https://pay.example/x");
});

Deno.test("normalizeScan: rejects empty / whitespace-only / null", () => {
  for (const v of ["", "   ", "\t\n"]) {
    const r = normalizeScan(v);
    assert(!r.ok);
    assertEquals(r.reason, "empty");
  }
  const n = normalizeScan(null);
  assert(!n.ok);
  assertEquals(n.reason, "empty");
});

Deno.test("normalizeScan: rejects an oversized payload", () => {
  const r = normalizeScan("x".repeat(5000));
  assert(!r.ok);
  assertEquals(r.reason, "too_long");
});

Deno.test("normalizeScan: rejects C0/C1 control characters", () => {
  for (const code of [0x00, 0x07, 0x1b, 0x1f, 0x7f, 0x9f]) {
    const r = normalizeScan(`abc${String.fromCharCode(code)}def`);
    assert(!r.ok, `expected reject for U+${code.toString(16)}`);
    assertEquals(r.reason, "control_chars");
  }
});

Deno.test("normalizeScan: rejects deceptive bidi overrides", () => {
  // U+202E RIGHT-TO-LEFT OVERRIDE ... U+202C POP DIRECTIONAL FORMATTING
  const r = normalizeScan(
    `pay${String.fromCharCode(0x202e)}malicious${String.fromCharCode(0x202c)}`,
  );
  assert(!r.ok);
  assertEquals(r.reason, "deceptive_unicode");
});

Deno.test("normalizeScan: a normal tel: USSD passes", () => {
  const r = normalizeScan("tel:*182*1*1%23");
  assert(r.ok);
  assertEquals(r.value.raw, "tel:*182*1*1%23");
});

Deno.test("toDisplaySafe: strips control chars and caps length", () => {
  assertEquals(toDisplaySafe(`ab${String.fromCharCode(0x00)}cd`), "abcd");
  const long = toDisplaySafe("y".repeat(100), 10);
  assertEquals(long.length, 10);
  assert(long.endsWith("…"));
});
