import type { RejectionReason } from "./types";

// EMVCo merchant-presented QR (EMV MPM). R2 ships the ADAPTER INTERFACE
// and enough of a structural + CRC check to RECOGNISE a genuine EMV
// payload - but it is always classified `emv_unsupported`, never turned
// into a ReviewModel. Implementing a partial financial standard from
// assumptions is explicitly out of scope (§5.2): a real merchant-QR
// integration needs the authoritative field spec and provider sign-off,
// at which point this file gains the field mapping behind its own flag.
//
// What we DO verify here is that a payload claiming to be EMV is
// well-formed and its CRC matches - so a malformed / tampered one is
// rejected as `emv_malformed` (a distinct, honest signal) rather than
// lumped in with "we don't support this".

export type EmvTag = { id: string; value: string };

export type EmvParse =
  | { ok: true; tags: EmvTag[] }
  | { ok: false; reason: Extract<RejectionReason, "emv_malformed"> };

/** Walk the ID(2) + LEN(2) + VALUE(LEN) TLV structure. */
export function parseEmvTlv(raw: string): EmvParse {
  const tags: EmvTag[] = [];
  let i = 0;
  while (i < raw.length) {
    if (i + 4 > raw.length) return { ok: false, reason: "emv_malformed" };
    const id = raw.slice(i, i + 2);
    const lenStr = raw.slice(i + 2, i + 4);
    if (!/^\d{2}$/.test(id) || !/^\d{2}$/.test(lenStr)) {
      return { ok: false, reason: "emv_malformed" };
    }
    const len = Number(lenStr);
    const start = i + 4;
    const end = start + len;
    if (end > raw.length) return { ok: false, reason: "emv_malformed" };
    tags.push({ id, value: raw.slice(start, end) });
    i = end;
  }
  if (tags.length === 0) return { ok: false, reason: "emv_malformed" };
  return { ok: true, tags };
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) over `input`, as an
 *  upper-case 4-hex-digit string - the EMV tag "63" checksum. */
export function crc16ccitt(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export type EmvRecognition =
  | { recognised: true; reason: "emv_unsupported" }
  | { recognised: false; reason: "emv_malformed" };

/**
 * Structural + CRC gate. On a well-formed payload with a valid trailing
 * CRC we return `emv_unsupported` (recognised, deliberately not handled);
 * otherwise `emv_malformed`.
 */
export function recogniseEmv(raw: string): EmvRecognition {
  // Tag "63" (CRC) is always last and its length is always "04". The CRC
  // is computed over everything up to AND INCLUDING "6304".
  const marker = raw.lastIndexOf("6304");
  if (marker === -1 || marker + 8 !== raw.length) {
    return { recognised: false, reason: "emv_malformed" };
  }
  const provided = raw.slice(marker + 4).toUpperCase();
  const expected = crc16ccitt(raw.slice(0, marker + 4));
  if (provided !== expected) {
    return { recognised: false, reason: "emv_malformed" };
  }

  const parsed = parseEmvTlv(raw);
  if (!parsed.ok) return { recognised: false, reason: "emv_malformed" };

  // Payload Format Indicator must be tag "00" = "01".
  const pfi = parsed.tags.find((t) => t.id === "00");
  if (!pfi || pfi.value !== "01") {
    return { recognised: false, reason: "emv_malformed" };
  }

  return { recognised: true, reason: "emv_unsupported" };
}
