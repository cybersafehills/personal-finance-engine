// The USSD instruction for a prepared payment intent: which string to show and
// dial, built from the intent's own recipient fields and the directory's
// published service code (never a hard-coded string). Pure and dependency-free
// so the web review panel, the mobile API and a Deno test all run the exact
// same code; extracted from components/pay/PaymentIntentPanel.tsx.

import {
  buildTelHref,
  type FillResult,
  fillUssdTemplate,
  type ParamSpec,
} from "../ussd/capability.ts";

export type InstructionIntent = {
  currency: string;
  amount_minor: number;
  recipient_msisdn_normalized: string | null;
  merchant_code: string | null;
  meter_number: string | null;
  billing_reference: string | null;
  government_reference: string | null;
};

export type InstructionServiceCode = {
  ussd_template: string;
  accepts_parameters: boolean;
  parameters: {
    key: string;
    kind: ParamSpec["kind"];
    required: boolean;
    format_regex: string | null;
    min_length: number | null;
    max_length: number | null;
  }[];
};

/** The amount as the whole-number major units USSD menus expect. */
export function ussdAmountMajor(
  intent: Pick<InstructionIntent, "currency" | "amount_minor">,
): number {
  return intent.currency === "RWF"
    ? intent.amount_minor
    : intent.amount_minor / 100;
}

/**
 * Null when the intent has no verified service code (the caller then says "no
 * verified USSD route"). Otherwise the filled string, or why it could not be
 * filled.
 */
export function buildUssdInstruction(
  intent: InstructionIntent,
  serviceCode: InstructionServiceCode | null,
): FillResult | null {
  if (!serviceCode) return null;
  if (!serviceCode.accepts_parameters) {
    return {
      ok: true as const,
      display: serviceCode.ussd_template,
      dial: serviceCode.ussd_template,
    };
  }
  const specs: ParamSpec[] = serviceCode.parameters.map((p) => ({
    key: p.key,
    kind: p.kind,
    required: p.required,
    formatRegex: p.format_regex,
    minLength: p.min_length,
    maxLength: p.max_length,
  }));
  // Rwandan MoMo/Airtel USSD menus expect the recipient in local `07XXXXXXXX`
  // form, which is also what the seeded service-code parameter regexes match.
  const localMsisdn = intent.recipient_msisdn_normalized
    ? "0" + intent.recipient_msisdn_normalized.slice(3)
    : "";
  // A value for every parameter kind a code might ask for, keyed by the code's
  // own parameter key and chosen by its kind, so a merchant / meter / bill
  // template (`*182*8*1*{merchant}*{amount}#`) fills the same way a send-money
  // one does.
  const valueForKind: Partial<Record<ParamSpec["kind"], string>> = {
    phone: localMsisdn,
    amount: String(Math.round(ussdAmountMajor(intent))),
    merchant_code: intent.merchant_code ?? "",
    meter_number: intent.meter_number ?? "",
    billing_id: intent.billing_reference ?? "",
    account_reference: intent.billing_reference ?? "",
    national_id: intent.government_reference ?? "",
    reference: intent.government_reference ?? "",
    text: intent.government_reference ?? "",
  };
  const params: Record<string, string> = {};
  for (const spec of specs) {
    const v = valueForKind[spec.kind];
    if (v) params[spec.key] = v;
  }
  return fillUssdTemplate(serviceCode.ussd_template, params, specs);
}

/** The `tel:` link for a successfully filled instruction (`#` is encoded). */
export function telHrefFor(filled: FillResult | null): string | null {
  return filled && filled.ok ? buildTelHref(filled.dial) : null;
}
