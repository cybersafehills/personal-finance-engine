// USSD template filling for the directory, ported from the web's
// web/lib/ussd/capability.ts (same rules, same messages) so a code filled in the
// app is the one the web would build. Dependency-free and pure.
//
// Hard rules: a filled value may never contain `*`, `#`, whitespace or braces
// (that would let a field rewrite the USSD path); a `tel:` route encodes `#` as
// %23. Nothing here dials anything or appends a PIN.

export type ParamKind =
  | "phone"
  | "amount"
  | "meter_number"
  | "billing_id"
  | "merchant_code"
  | "account_reference"
  | "national_id"
  | "reference"
  | "text";

export type ParamSpec = {
  key: string;
  kind: ParamKind;
  required: boolean;
  formatRegex?: string | null;
  minLength?: number | null;
  maxLength?: number | null;
};

export type FillResult = { ok: true; display: string; dial: string } | { ok: false; error: string };

const PLACEHOLDER_RE = /\{([a-z0-9_]+)\}/gi;

const DEFAULT_KIND_RULES: Record<ParamKind, { regex: RegExp; hint: string }> = {
  phone: { regex: /^\+?\d{7,15}$/, hint: "digits only, 7-15 long (a leading + is allowed)" },
  amount: { regex: /^[1-9]\d{0,8}$/, hint: "a whole number with no separators" },
  meter_number: { regex: /^\d{6,20}$/, hint: "6-20 digits" },
  billing_id: { regex: /^[A-Za-z0-9-]{3,40}$/, hint: "letters, digits and dashes" },
  merchant_code: { regex: /^\d{3,12}$/, hint: "3-12 digits" },
  account_reference: { regex: /^[A-Za-z0-9-]{3,40}$/, hint: "letters, digits and dashes" },
  national_id: { regex: /^\d{10,20}$/, hint: "10-20 digits" },
  reference: { regex: /^[A-Za-z0-9-]{1,40}$/, hint: "letters, digits and dashes" },
  text: { regex: /^[A-Za-z0-9 .,'-]{1,60}$/, hint: "plain text, up to 60 characters" },
};

const KIND_LABELS: Record<ParamKind, string> = {
  phone: "a phone number",
  amount: "an amount",
  meter_number: "a meter number",
  billing_id: "a billing ID",
  merchant_code: "a merchant code",
  account_reference: "an account reference",
  national_id: "a national ID",
  reference: "a reference",
  text: "a value",
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function fillUssdTemplate(template: string, params: Record<string, string>, schema: ParamSpec[]): FillResult {
  const specByKey = new Map(schema.map((s) => [s.key, s]));
  const seen = new Set<string>();
  let failure: string | null = null;

  const filled = template.replace(PLACEHOLDER_RE, (_match, rawKey: string) => {
    const key = rawKey.toLowerCase();
    seen.add(key);
    const spec = specByKey.get(key);
    if (!spec) {
      failure ??= `This code refers to "${key}", which isn't a known field. Report the code.`;
      return "";
    }
    const raw = (params[key] ?? "").trim();
    if (!raw) {
      if (spec.required) failure ??= `Enter ${KIND_LABELS[spec.kind] ?? "a value"}.`;
      return "";
    }
    if (/[*#\s{}]/.test(raw)) {
      failure ??= `${capitalize(KIND_LABELS[spec.kind])} can't contain spaces or the characters * # { }.`;
      return "";
    }
    const rule = DEFAULT_KIND_RULES[spec.kind];
    let ok = rule.regex.test(raw);
    let hint = rule.hint;
    if (ok && spec.formatRegex) {
      try {
        ok = new RegExp(spec.formatRegex).test(raw);
        hint = "the expected format for this service";
      } catch {
        // A bad stored regex must never block the user.
        ok = true;
      }
    }
    if (ok && spec.minLength != null && raw.length < spec.minLength) ok = false;
    if (ok && spec.maxLength != null && raw.length > spec.maxLength) ok = false;
    if (!ok) {
      failure ??= `${capitalize(KIND_LABELS[spec.kind])} should be ${hint}.`;
      return "";
    }
    return raw;
  });

  if (failure) return { ok: false, error: failure };
  for (const spec of schema) {
    if (spec.required && !seen.has(spec.key)) {
      return { ok: false, error: `This code is missing the "${spec.key}" field in its template. Report the code.` };
    }
  }
  return { ok: true, display: filled, dial: filled };
}

/** The `tel:` href for a fully filled USSD string: `#` as %23, `*` and digits literal. */
export function buildTelHref(filledUssd: string): string {
  return "tel:" + filledUssd.replace(/#/g, "%23");
}
