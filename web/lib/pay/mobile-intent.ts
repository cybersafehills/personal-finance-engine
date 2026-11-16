import "server-only";

import { type MobileIntent, toMobileIntent } from "../mobile-pay";
import { getServiceCodeById } from "../ussd/queries";
import { buildUssdInstruction } from "./instruction";
import { getPaymentIntent } from "./intents";

/**
 * A payment intent with its prepared USSD instruction, for the mobile app.
 * Reads under the caller's own session (RLS), so an id from another user's
 * workspace is simply "not found". The instruction comes from the same builder
 * as the web review panel and the directory's published service code.
 */
export async function loadMobileIntent(id: string): Promise<MobileIntent | null> {
  const found = await getPaymentIntent(id);
  if (!found) return null;
  const { intent } = found;
  const serviceCode = intent.service_code_id
    ? await getServiceCodeById(intent.service_code_id)
    : null;
  return toMobileIntent(intent, buildUssdInstruction(intent, serviceCode));
}
