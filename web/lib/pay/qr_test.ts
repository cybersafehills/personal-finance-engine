import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { encodeQr, qrToSvg } from "./qr.ts";

// Structural checks. A from-scratch QR port needs a real-scanner check
// too (see the Phase 2a manual-verification steps), but these catch the
// common porting bugs: wrong size, broken finder patterns, missing
// timing line, malformed SVG.

Deno.test("encodeQr: a short string is version 1 (21x21)", () => {
  const m = encodeQr("HELLO", "M");
  assertEquals(m.size, 21);
  assertEquals(m.modules.length, 21);
  assertEquals(m.modules[0].length, 21);
});

Deno.test("encodeQr: a realistic tel: route encodes without throwing and grows the matrix", () => {
  const m = encodeQr("tel:*182*1*1*250781234567*5000%23", "M");
  assert(m.size >= 21 && m.size % 4 === 1, `unexpected size ${m.size}`);
});

Deno.test("encodeQr: the three finder patterns are intact", () => {
  const m = encodeQr("tel:*182%23", "M");
  const isFinder = (ox: number, oy: number) => {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const dist = Math.max(Math.abs(x - 3), Math.abs(y - 3));
        const expectDark = dist !== 2;
        if (m.modules[oy + y][ox + x] !== expectDark) return false;
      }
    }
    return true;
  };
  assert(isFinder(0, 0), "top-left finder");
  assert(isFinder(m.size - 7, 0), "top-right finder");
  assert(isFinder(0, m.size - 7), "bottom-left finder");
});

Deno.test("encodeQr: the timing patterns alternate", () => {
  const m = encodeQr("tel:*182%23", "M");
  for (let i = 8; i < m.size - 8; i++) {
    assertEquals(m.modules[6][i], i % 2 === 0, `row timing at ${i}`);
    assertEquals(m.modules[i][6], i % 2 === 0, `col timing at ${i}`);
  }
});

Deno.test("encodeQr: throws only when the payload cannot fit at all", () => {
  assertThrows(() => encodeQr("x".repeat(3000), "H"));
});

Deno.test("qrToSvg: self-contained, no external refs, theme-aware default", () => {
  const svg = qrToSvg(encodeQr("tel:*182%23", "M"));
  assert(svg.startsWith("<svg"));
  assert(svg.includes('fill="currentColor"'));
  assert(!svg.includes("http://") || svg.includes("www.w3.org/2000/svg"));
  assert(!svg.includes("<image"));
});
