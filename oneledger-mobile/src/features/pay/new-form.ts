// Pure rules for "Pay a person / Pay a merchant" started from the Pay button
// (as opposed to "Pay X again", which rebuilds its recipient from a past
// transaction). The server re-checks everything; these rules only stop an
// obviously unusable request before it is sent.

import { accountNetwork, normalizeRwandaMsisdn } from "./target";
import type { PayerAccount } from "./accounts";

export type PayKind = "pay_person" | "pay_merchant";

export type Recipient =
  | { ok: true; msisdn: string; merchantCode?: undefined }
  | { ok: true; merchantCode: string; msisdn?: undefined }
  | { ok: false; message: string };

const MERCHANT_CODE = /^\d{3,12}$/;

export function parseRecipient(kind: PayKind, input: string): Recipient {
  const text = input.trim();
  if (kind === "pay_person") {
    const msisdn = normalizeRwandaMsisdn(text);
    return msisdn
      ? { ok: true, msisdn }
      : { ok: false, message: "Enter a Rwandan mobile number, like 078 123 4567." };
  }
  const code = text.replace(/\s/g, "");
  return MERCHANT_CODE.test(code)
    ? { ok: true, merchantCode: code }
    : { ok: false, message: "Enter the merchant code: 3 to 12 digits." };
}

/**
 * The accounts a payment of this kind can be made from, in the active Space:
 * RWF only; a person's network comes from the recipient's number so any
 * mobile-money account will do; a merchant can only be dialled on MTN (the
 * only merchant-pay code in the directory) and the network comes from the
 * account. In a household only the user's own accounts count; in a personal
 * Space every account is theirs.
 */
export function payableAccounts(
  accounts: readonly PayerAccount[],
  ctx: { workspaceId: string; personal: boolean; userId: string },
  kind: PayKind,
): PayerAccount[] {
  return accounts.filter(
    (a) =>
      a.workspaceId === ctx.workspaceId &&
      (ctx.personal || a.ownerUserId === ctx.userId) &&
      a.currency === "RWF" &&
      (kind === "pay_merchant" ? accountNetwork(a.provider) === "mtn" : accountNetwork(a.provider) !== null),
  );
}
