import "server-only";

import { getServiceCodeForPayment, getServiceDirectory } from "../../ussd/queries";
import type { ServiceCodeDetail } from "../../ussd/queries";
import { matchesTemplate } from "./ussd";
import type { UssdDirectoryMatch } from "./pipeline";

// Server-side resolvers for the scan pipeline. RLS-scoped: getService
// directory only ever returns rows the caller is allowed to see
// (published, in-window). A scanned USSD string is matched against those
// templates ONLY - an unpublished or unknown code resolves to null,
// which the pipeline turns into `unknown_ussd`.

/**
 * Find the published directory template a canonical dial string matches.
 * Prefers a literal (no-placeholder) template; falls back to a
 * parameterised one whose placeholders line up with the scanned digits.
 */
export async function matchUssdInDirectory(
  dial: string,
): Promise<UssdDirectoryMatch | null> {
  const codes = await getServiceDirectory();

  let parameterised: UssdDirectoryMatch | null = null;

  for (const code of codes) {
    const hit = matchesTemplate(dial, code.ussd_template);
    if (!hit) continue;

    const match: UssdDirectoryMatch = {
      id: code.id,
      slug: code.slug,
      template: code.ussd_template,
      providerLabel: code.provider?.display_name ?? null,
      verified: code.verified_at != null,
      category: code.category ?? null,
      intent: code.intent ?? null,
      networks: code.supported_networks ?? [],
    };

    if (!code.ussd_template.includes("{")) {
      return match; // exact literal wins outright
    }
    parameterised ??= match;
  }

  return parameterised;
}

/**
 * The published pay-a-merchant USSD code for a mobile-money network -
 * what a OneLedger merchant-payment scan is filled into. Same RLS scope
 * and same verified-or-not handling as scanning a send-money code
 * directly (the review surfaces "not officially verified" when
 * `verified_at` is null). Returns null when the directory has no such
 * code, in which case the OneLedger hand-off stays unavailable.
 */
export async function resolveMerchantPayCode(
  network: "mtn" | "airtel",
): Promise<ServiceCodeDetail | null> {
  return getServiceCodeForPayment(network, "merchant_payment");
}
