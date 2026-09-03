import { assert, assertEquals } from "jsr:@std/assert@1";
import jsQRImport from "jsqr";
import { qrMatrix, qrSvg } from "./qr.ts";

// jsqr's bundled .d.ts exposes no call signature under Deno's resolution; the
// runtime value is the decoder function. Narrow it to what this test uses.
const jsQR = jsQRImport as unknown as (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  opts?: { inversionAttempts?: "dontInvert" | "onlyInvert" | "attemptBoth" | "invertFirst" },
) => { data: string } | null;

function rasterize(m: boolean[][], scale = 6, margin = 4): {
  data: Uint8ClampedArray;
  width: number;
  height: number;
} {
  const n = m.length;
  const dim = (n + margin * 2) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4).fill(255); // white RGBA
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!m[r][c]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const x = (c + margin) * scale + dx;
          const y = (r + margin) * scale + dy;
          const i = (y * dim + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0; // black; alpha stays 255
        }
      }
    }
  }
  return { data, width: dim, height: dim };
}

const CASES = [
  "olp_AB12CDEF0123456789ABCDEF01",
  "https://oneledger.me/pair?c=olp_Q8X4H7K2M9P3R5T6V8W0Y1Z3B5",
  "https://www.oneledger.me/pair?c=olp_MMMMabcdefghijklmnopqrstuvwx",
  "a",
  "The quick brown fox jumps over the lazy dog 0123456789 — pairing check.",
];

Deno.test("qrMatrix + jsQR round-trip: every payload decodes back to itself", () => {
  for (const text of CASES) {
    const m = qrMatrix(text);
    const { data, width, height } = rasterize(m);
    const decoded = jsQR(data, width, height, { inversionAttempts: "dontInvert" });
    assert(decoded, `jsQR failed to decode: ${JSON.stringify(text)}`);
    assertEquals(decoded!.data, text);
  }
});

Deno.test("qrMatrix: square, odd size 4*version+17, grows with payload", () => {
  const small = qrMatrix("a");
  assertEquals(small.length, small[0].length);
  assertEquals((small.length - 17) % 4, 0);
  assert(qrMatrix(CASES[4]).length >= small.length);
});

Deno.test("qrSvg: self-contained, currentColor, no external refs", () => {
  const svg = qrSvg(CASES[1], { scale: 4, margin: 4 });
  assert(svg.startsWith("<svg"));
  assert(svg.includes("currentColor"));
  assert(svg.includes("viewBox"));
  // xmlns is the only allowed w3.org reference; nothing else external
  assert(!/https?:\/\/(?!www\.w3\.org)/.test(svg));
});
