import type { RejectionReason } from "./types.ts";

// Verified-USSD payload parsing. Turns a `tel:` URI or a bare USSD
// string into a canonical dial string, then (via matchesTemplate) checks
// it against a verified directory template. Encoded `*` / `#` are
// normalized; nothing else is percent-decoded (so `%2F` can never become
// a path separator). A scanned USSD is NEVER auto-dialled and NEVER
// matched loosely - only an exact structural match against a published,
// verified template counts.

export type ParsedUssd = {
  /** Canonical dial form: only [*#0-9], begins with * or #, ends with #. */
  dial: string;
};

const ALLOWED_USSD_CHARS = /^[*#0-9]+$/;

/** Decode ONLY the two USSD control characters, upper- or lower-case
 *  percent form. Deliberately not a general decodeURIComponent. */
function decodeUssdControls(s: string): string {
  return s.replace(/%2a/gi, "*").replace(/%23/gi, "#");
}

export function parseUssd(
  raw: string,
): { ok: true; value: ParsedUssd } | { ok: false; reason: RejectionReason } {
  let body = raw.trim();

  if (/^tel:/i.test(body)) {
    body = body.slice(4);
  }
  body = decodeUssdControls(body).replace(/\s+/g, "");

  // iOS strips a bare trailing '#'; some encoders drop it entirely.
  // Accept a missing trailing '#' and re-add it, but nothing else.
  if (!body.endsWith("#") && ALLOWED_USSD_CHARS.test(body + "#")) {
    body = body + "#";
  }

  if (body.length < 3 || body.length > 64) {
    return { ok: false, reason: "malformed_ussd" };
  }
  if (!ALLOWED_USSD_CHARS.test(body)) {
    return { ok: false, reason: "malformed_ussd" };
  }
  if (!(body.startsWith("*") || body.startsWith("#")) || !body.endsWith("#")) {
    return { ok: false, reason: "malformed_ussd" };
  }
  // No empty segments (`**`, `*#`) and at least one digit run.
  if (/\*\*|\*#|##|#\*/.test(body) || !/\d/.test(body)) {
    return { ok: false, reason: "malformed_ussd" };
  }

  return { ok: true, value: { dial: body } };
}

const PLACEHOLDER_RE = /\{[a-z0-9_]+\}/gi;

/** The `{key}` names a parameterised directory template declares. */
export function templatePlaceholders(template: string): string[] {
  return (template.match(PLACEHOLDER_RE) ?? []).map((m) =>
    m.slice(1, -1).toLowerCase(),
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Does `dial` match this directory `template`? A literal template
 * (`*182#`) must match exactly. A parameterised one
 * (`*182*8*1*{merchant}*{amount}#`) matches when every `{placeholder}`
 * lines up with a non-empty run of digits in the scanned string.
 *
 * Returns the extracted placeholder values on a match (so a fully
 * literal scan of a parameterised code can be surfaced with its parts),
 * or null on no match.
 */
export function matchesTemplate(
  dial: string,
  template: string,
): { params: Record<string, string> } | null {
  const placeholders = templatePlaceholders(template);

  if (placeholders.length === 0) {
    return dial === template ? { params: {} } : null;
  }

  // Build an anchored regex: literal chars escaped, each {key} -> a
  // capturing group of 1+ digits (USSD parameters are numeric in the
  // directory's kind rules: phone, amount, meter, merchant code...).
  let pattern = "^";
  const names: string[] = [];
  let m: RegExpExecArray | null;
  const re = /\{([a-z0-9_]+)\}/gi;
  let lastIndex = 0;
  while ((m = re.exec(template)) !== null) {
    pattern += escapeRegExp(template.slice(lastIndex, m.index)) + "(\\d{1,20})";
    names.push(m[1].toLowerCase());
    lastIndex = m.index + m[0].length;
  }
  pattern += escapeRegExp(template.slice(lastIndex)) + "$";

  const matched = new RegExp(pattern).exec(dial);
  if (!matched) return null;

  const params: Record<string, string> = {};
  names.forEach((name, i) => {
    params[name] = matched[i + 1];
  });
  return { params };
}
