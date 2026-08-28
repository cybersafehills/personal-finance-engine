import { assert, assertEquals } from "jsr:@std/assert@1";
import { crc16ccitt, parseEmvTlv, recogniseEmv } from "./emv.ts";

Deno.test("crc16ccitt: the standard check value", () => {
  // CRC-16/CCITT-FALSE("123456789") == 0x29B1
  assertEquals(crc16ccitt("123456789"), "29B1");
});

const BODY =
  "000201" + "52040000" + "5303646" + "5802RW" + "5904SHOP" + "6006KIGALI";
const VALID_EMV = BODY + "6304" + crc16ccitt(BODY + "6304");

Deno.test("parseEmvTlv: walks a well-formed ID/LEN/VALUE stream", () => {
  const r = parseEmvTlv(VALID_EMV);
  assert(r.ok);
  assertEquals(r.tags[0], { id: "00", value: "01" });
  assert(r.tags.some((t) => t.id === "59" && t.value === "SHOP"));
});

Deno.test("parseEmvTlv: rejects a truncated value", () => {
  const r = parseEmvTlv("0004AB"); // says len 4, only 2 bytes follow
  assert(!r.ok);
  assertEquals(r.reason, "emv_malformed");
});

Deno.test("recogniseEmv: a valid CRC -> recognised but emv_unsupported", () => {
  const r = recogniseEmv(VALID_EMV);
  assertEquals(r, { recognised: true, reason: "emv_unsupported" });
});

Deno.test("recogniseEmv: a wrong CRC -> emv_malformed", () => {
  const tampered = BODY.replace("SHOP", "SH0P") + "6304" + crc16ccitt(BODY + "6304");
  const r = recogniseEmv(tampered);
  assertEquals(r, { recognised: false, reason: "emv_malformed" });
});

Deno.test("recogniseEmv: no trailing 6304 CRC -> emv_malformed", () => {
  const r = recogniseEmv(BODY);
  assertEquals(r, { recognised: false, reason: "emv_malformed" });
});
