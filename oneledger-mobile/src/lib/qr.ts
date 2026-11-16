import { encode } from "uqr";

// QR module grid for `text` (true = dark), no quiet zone. `uqr` is pure
// JavaScript (no native code), the same library the web app uses.
export function qrMatrix(text: string): boolean[][] {
  return encode(text, { border: 0 }).data;
}
