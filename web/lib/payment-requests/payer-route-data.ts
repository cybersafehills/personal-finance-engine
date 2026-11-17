import "server-only";

import { supabaseServer } from "../supabase-server";
import type { InstructionServiceCode } from "../pay/instruction";
import type { PayerNetwork } from "./payer-route";

// The public payment-request page is anonymous, but the USSD directory is
// readable only by signed-in users (RLS). The directory is public reference
// data (published, in-effect codes only), so this reads it with the server
// client for one fixed provider+intent lookup - no user data is read or
// returned. Failure (or no code) just means the page shows the plain details
// without a Pay button.
export async function getPayerServiceCode(
  network: PayerNetwork,
  intent: "send_money" | "merchant_payment",
): Promise<InstructionServiceCode | null> {
  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabaseServer()
      .from("service_codes")
      .select(
        `ussd_template, accepts_parameters,
         parameters:service_code_parameters(key, kind, required, format_regex, min_length, max_length)`,
      )
      .eq("intent", intent)
      .eq("state", "published")
      .lte("effective_from", nowIso)
      .or(`effective_to.is.null,effective_to.gt.${nowIso}`)
      .contains("supported_networks", [network])
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return data as unknown as InstructionServiceCode;
  } catch {
    return null;
  }
}
