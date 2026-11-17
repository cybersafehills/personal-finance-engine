import { assertEquals } from "jsr:@std/assert@1";
import { MAX_RAW_LENGTH, parseClassifyBody, parsePrepareBody } from "./mobile-scan.ts";

Deno.test("parseClassifyBody: needs a non-empty string within the cap", () => {
  assertEquals(parseClassifyBody({ raw: "*182#" }), { ok: true, raw: "*182#" });
  assertEquals(parseClassifyBody({ raw: "" }).ok, false);
  assertEquals(parseClassifyBody({}).ok, false);
  assertEquals(parseClassifyBody(null).ok, false);
  assertEquals(parseClassifyBody({ raw: 5 }).ok, false);
  assertEquals(parseClassifyBody({ raw: "x".repeat(MAX_RAW_LENGTH + 1) }).ok, false);
  assertEquals(parseClassifyBody({ raw: "x".repeat(MAX_RAW_LENGTH) }).ok, true);
});

Deno.test("parsePrepareBody: the amount is optional and must be a positive integer", () => {
  assertEquals(parsePrepareBody({ raw: "a" }), { ok: true, raw: "a" });
  assertEquals(parsePrepareBody({ raw: "a", amountMinor: 5000 }), { ok: true, raw: "a", amountMinor: 5000 });
  for (const bad of [0, -1, 1.5, "5000", NaN]) {
    assertEquals(parsePrepareBody({ raw: "a", amountMinor: bad }).ok, false, `rejects ${String(bad)}`);
  }
  assertEquals(parsePrepareBody({ amountMinor: 5 }).ok, false);
});
