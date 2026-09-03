// The one place QR generation is wired in. Thin wrapper over `uqr` (v0.1.x,
// MIT, zero runtime dependencies) so the component + tests have a single
// import point and `uqr` can be swapped without touching callers.
//
// Pure and env-free: type-checked by `deno test web/lib`, safe to import from a
// client component. `web/lib/qr_test.ts` round-trips the output through the
// `jsqr` decoder the repo already ships.
//
// A `/pair?c=…` URL is ~65 bytes → QR version 3-4 at the default ECC level.

import { encode, renderSVG } from "uqr";

/** The QR module grid for `text` (true = dark), no quiet zone (size 4·version+17). */
export function qrMatrix(text: string): boolean[][] {
  return encode(text, { border: 0 }).data;
}

export type QrSvgOptions = {
  /** CSS length per module (default 4). */
  scale?: number;
  /** Quiet-zone modules on every side (default 4). */
  margin?: number;
};

/**
 * A self-contained `<svg>` string. Dark modules use `currentColor`, light
 * modules are transparent, so it inherits the surrounding theme.
 */
export function qrSvg(text: string, opts: QrSvgOptions = {}): string {
  return renderSVG(text, {
    pixelSize: opts.scale ?? 4,
    border: opts.margin ?? 4,
    blackColor: "currentColor",
    whiteColor: "transparent",
  });
}
