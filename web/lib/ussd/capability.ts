// USSD capability layer.
//
// One place that decides *whether* a device can plausibly open a dialer,
// *how* to turn a (possibly parameterised) USSD template into a safe
// `tel:` route, and *how* to strip user values before anything is sent
// to analytics. Deliberately dependency-free and free of any
// Next/Node/Deno API so it runs identically in a Deno unit test, a React
// client component, and (if ever needed) on the server.
//
// Hard rules encoded here (see docs/pay-and-services.md, master prompt
// "USSD and device handling"):
//   * a filled value may never contain `*` or `#` - that would let a
//     recipient/amount field rewrite the USSD path itself.
//   * a `tel:` route encodes `#` as %23 (iOS drops a bare trailing `#`
//     for USSD) and leaves `*` and digits literal.
//   * redaction replaces every parameter with its <kind>, never its
//     value.
// Nothing here dials anything or appends a PIN.

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

export type Platform = "ios" | "android" | "desktop" | "unknown";

export type DialerCapability = {
  /** True only where attempting a `tel:` USSD open is worth offering as
   *  the primary action. False everywhere else - the UI then leads with
   *  Copy code + written steps instead. */
  canAttemptDialer: boolean;
  platform: Platform;
  /** Short machine-ish reason, safe to log. */
  reason: string;
};

export function detectPlatform(userAgent: string | null | undefined): Platform {
  if (!userAgent) return "unknown";
  const ua = userAgent.toLowerCase();
  if (/iphone|ipod/.test(ua)) return "ios";
  if (/ipad/.test(ua)) return "ios";
  // iPadOS 13+ reports a desktop-Safari UA; treated as desktop here on
  // purpose - USSD on a cellular iPad is a rounding-error case and the
  // fallback (copy + steps) is always shown anyway.
  if (/android/.test(ua)) {
    // Android TVs / some tablets carry "Android" but no telephony. We
    // still offer the attempt (the fallback covers a miss) unless it is
    // clearly a non-phone form factor.
    if (/tv\b|smart-tv|googletv/.test(ua)) return "unknown";
    return "android";
  }
  if (/windows|macintosh|mac os x|cros|linux x86_64|x11/.test(ua)) return "desktop";
  return "unknown";
}

export function detectDialerCapability(
  userAgent: string | null | undefined,
): DialerCapability {
  const platform = detectPlatform(userAgent);
  switch (platform) {
    case "ios":
      return {
        canAttemptDialer: true,
        platform,
        reason: "ios-tel-supported",
      };
    case "android":
      return {
        canAttemptDialer: true,
        platform,
        reason: "android-tel-supported",
      };
    case "desktop":
      return {
        canAttemptDialer: false,
        platform,
        reason: "desktop-no-dialer",
      };
    default:
      return {
        canAttemptDialer: false,
        platform,
        reason: "unknown-platform-fallback-only",
      };
  }
}

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

export type FillResult =
  | { ok: true; display: string; dial: string }
  | { ok: false; error: string };

/**
 * Substitute `{key}` placeholders in a USSD template with validated,
 * formatted parameter values. Returns the human-readable string and the
 * exact string to dial (identical today; kept separate so a future
 * per-provider display format never leaks into the dial path).
 *
 * Rejects, with a user-safe message:
 *   * a missing required value,
 *   * a value that fails its format rule (per-code regex if present,
 *     otherwise the kind default),
 *   * a value containing `*`, `#`, whitespace, or a `{`/`}` - any of
 *     which could rewrite the USSD path,
 *   * a placeholder with no matching parameter spec.
 */
export function fillUssdTemplate(
  template: string,
  params: Record<string, string>,
  schema: ParamSpec[],
): FillResult {
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
      if (spec.required) {
        failure ??= `Enter ${labelForKind(spec.kind)}.`;
      }
      return "";
    }

    if (/[*#\s{}]/.test(raw)) {
      failure ??= `${capitalize(labelForKind(spec.kind))} can't contain spaces or the characters * # { }.`;
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
        // A bad stored regex must never block the user - fall back to the
        // kind default (already passed) rather than erroring.
        ok = true;
      }
    }
    if (ok && spec.minLength != null && raw.length < spec.minLength) ok = false;
    if (ok && spec.maxLength != null && raw.length > spec.maxLength) ok = false;

    if (!ok) {
      failure ??= `${capitalize(labelForKind(spec.kind))} should be ${hint}.`;
      return "";
    }
    return raw;
  });

  if (failure) return { ok: false, error: failure };

  // Every required spec must have been referenced by the template.
  for (const spec of schema) {
    if (spec.required && !seen.has(spec.key)) {
      return {
        ok: false,
        error: `This code is missing the "${spec.key}" field in its template. Report the code.`,
      };
    }
  }

  return { ok: true, display: filled, dial: filled };
}

/**
 * Build the `tel:` href for a *fully filled* USSD string. Encodes `#` as
 * %23 and leaves `*` and digits literal - the combination iOS and
 * Android both dial reliably. Never call this with an unfilled template
 * (it would put a literal `{amount}` on the dialer).
 */
export function buildTelHref(filledUssd: string): string {
  return "tel:" + filledUssd.replace(/#/g, "%23");
}

/**
 * A version of the template safe to put in an analytics event: every
 * `{key}` becomes `<kind>` (or `<field>` if unknown), so no phone
 * number, amount, meter number or reference is ever recorded. A
 * non-parameterised template is returned unchanged (it carries no user
 * data).
 */
export function redactUssdForAnalytics(template: string, schema: ParamSpec[]): string {
  const kindByKey = new Map(schema.map((s) => [s.key, s.kind]));
  return template.replace(PLACEHOLDER_RE, (_m, rawKey: string) => {
    const kind = kindByKey.get(rawKey.toLowerCase());
    return `<${kind ?? "field"}>`;
  });
}

function labelForKind(kind: ParamKind): string {
  switch (kind) {
    case "phone":
      return "a phone number";
    case "amount":
      return "an amount";
    case "meter_number":
      return "a meter number";
    case "billing_id":
      return "a billing ID";
    case "merchant_code":
      return "a merchant code";
    case "account_reference":
      return "an account reference";
    case "national_id":
      return "a national ID";
    case "reference":
      return "a reference";
    default:
      return "a value";
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
