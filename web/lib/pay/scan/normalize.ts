import { MAX_PAYLOAD_LENGTH, type RejectionReason } from "./types.ts";

// Stage 1 - normalization. Turn whatever the decoder handed us into a
// trimmed, length-bounded, control-character-free string, or reject it
// outright. Everything downstream can assume `raw` is printable and
// sane.
//
// The checks below walk char codes rather than using control-character
// regex literals (which ESLint's no-control-regex rightly flags).

export type NormalizedScan = {
  /** Trimmed decoded text. Printable, <= MAX_PAYLOAD_LENGTH. */
  raw: string;
  /** `raw` lowercased - for scheme / prefix matching only. */
  lower: string;
};

/** C0 controls (0x00-0x1F), DEL (0x7F), and the C1 block (0x80-0x9F). */
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) return true;
  }
  return false;
}

/**
 * Bidi overrides / embeddings / isolates - the classic "display one
 * thing, mean another" trick (§5.3 "Mixed-direction or deceptive
 * Unicode"): U+202A-202E (LRE/RLE/PDF/LRO/RLO), U+2066-2069
 * (LRI/RLI/FSI/PDI), and bare U+200E/200F (LRM/RLM).
 */
function hasDeceptiveBidi(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (
      (c >= 0x202a && c <= 0x202e) ||
      (c >= 0x2066 && c <= 0x2069) ||
      c === 0x200e ||
      c === 0x200f
    ) {
      return true;
    }
  }
  return false;
}

export function normalizeScan(
  input: string | null | undefined,
): { ok: true; value: NormalizedScan } | { ok: false; reason: RejectionReason } {
  if (input == null) return { ok: false, reason: "empty" };

  const raw = input.trim();
  if (raw.length === 0) return { ok: false, reason: "empty" };
  if (raw.length > MAX_PAYLOAD_LENGTH) return { ok: false, reason: "too_long" };
  if (hasControlChar(raw)) return { ok: false, reason: "control_chars" };
  if (hasDeceptiveBidi(raw)) return { ok: false, reason: "deceptive_unicode" };

  return { ok: true, value: { raw, lower: raw.toLowerCase() } };
}

/**
 * Collapse decoded text to a single-line, length-capped form safe to
 * show a human (an error line). Drops anything non-printable and never
 * exceeds `max` chars. NOT used for parsing - only for the rare case
 * the UI must echo something back.
 */
export function toDisplaySafe(raw: string, max = 48): string {
  let cleaned = "";
  const limit = Math.min(raw.length, MAX_PAYLOAD_LENGTH);
  for (let i = 0; i < limit; i++) {
    const c = raw.charCodeAt(i);
    if (c > 0x1f && !(c >= 0x7f && c <= 0x9f)) cleaned += raw[i];
  }
  cleaned = cleaned.trim();
  return cleaned.length > max ? cleaned.slice(0, max - 1) + "…" : cleaned;
}
