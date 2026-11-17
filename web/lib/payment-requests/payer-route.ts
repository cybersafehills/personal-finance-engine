// Turns an open public payment request into a "pay it from your own phone"
// hand-off. NON-CUSTODIAL: nothing here moves money. The only output is a
// USSD string the PAYER dials on their own handset (and confirms with their own
// PIN) plus the plain details to copy - the same assisted hand-off the Pay
// feature uses, built from the directory's published service code (never a
// hard-coded string). Pure and dependency-light so it is deno-testable.

import { guessProvider } from "../pay/phone.ts";
import {
  buildTelHref,
} from "../ussd/capability.ts";
import {
  buildUssdInstruction,
  type InstructionServiceCode,
} from "../pay/instruction.ts";
import type { PublicPaymentRequestView } from "./public-view.ts";

export type PayerNetwork = "mtn" | "airtel";

/** What to look up in the directory for this request, or null = no hand-off. */
export function payerRouteTarget(
  view: Pick<
    PublicPaymentRequestView,
    "status" | "currency" | "destination"
  >,
): { network: PayerNetwork; intent: "send_money" | "merchant_payment" } | null {
  if (view.status !== "open" || view.currency !== "RWF" || !view.destination) {
    return null;
  }
  if (view.destination.type === "merchant_code") {
    // The seeded merchant-pay code is MTN MoMo only.
    return { network: "mtn", intent: "merchant_payment" };
  }
  const network = guessProvider(view.destination.value);
  return network ? { network, intent: "send_money" } : null;
}

export type PayerRoute = {
  network: PayerNetwork;
  networkLabel: string;
  /** The USSD string, e.g. `*182*1*1*0788123456*5000#`. */
  dial: string;
  /** `tel:` link with `#` encoded - opens the dialer pre-filled. */
  telHref: string;
};

const NETWORK_LABEL: Record<PayerNetwork, string> = {
  mtn: "MTN Mobile Money",
  airtel: "Airtel Money",
};

/** Null when there is no usable code or it cannot be filled. */
export function buildPayerRoute(
  view: Pick<
    PublicPaymentRequestView,
    "status" | "currency" | "destination" | "amountMinor"
  >,
  serviceCode: InstructionServiceCode | null,
): PayerRoute | null {
  const target = payerRouteTarget(view);
  if (!target || !view.destination || !serviceCode) return null;

  const filled = buildUssdInstruction(
    {
      currency: view.currency,
      amount_minor: Number(view.amountMinor),
      recipient_msisdn_normalized: view.destination.type === "momo_phone"
        ? view.destination.value
        : null,
      merchant_code: view.destination.type === "merchant_code"
        ? view.destination.value
        : null,
      meter_number: null,
      billing_reference: null,
      government_reference: null,
    },
    serviceCode,
  );
  if (!filled || !filled.ok) return null;
  return {
    network: target.network,
    networkLabel: NETWORK_LABEL[target.network],
    dial: filled.dial,
    telHref: buildTelHref(filled.dial),
  };
}
