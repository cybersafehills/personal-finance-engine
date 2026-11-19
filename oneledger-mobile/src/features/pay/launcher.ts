import type { DirectoryCategory } from "@/features/ussd/types";

import type { PayConfig } from "./types";

// What the Pay sheet offers, mirroring the web's launcher
// (web/components/pay/PayLauncher.tsx). Person and merchant payments are
// prepared in the app. Bill, electricity, airtime and government services open
// the in-app USSD directory on the matching category: those are the verified
// codes the app can show (and fill in) natively, with no unverified shortcut
// (the web maps airtime to the send-money code, which would transfer money).
// One tap never executes a payment.

export type LauncherAction =
  | { id: "pay_person" | "pay_merchant"; label: string; kind: "native" }
  | { id: "ekash"; label: string; kind: "ekash" }
  | {
      id: "buy_electricity" | "buy_airtime" | "government";
      label: string;
      kind: "directory";
      /** The directory category this opens on. */
      category: DirectoryCategory;
      /** Used when the directory is off for this account: the web page that does the same job. */
      webPath: string;
    };

export const LAUNCHER_ACTIONS: readonly LauncherAction[] = [
  { id: "pay_person", label: "Pay a person", kind: "native" },
  { id: "pay_merchant", label: "Pay a merchant", kind: "native" },
  { id: "buy_electricity", label: "Buy electricity", kind: "directory", category: "utilities", webPath: "/pay/new/buy_electricity" },
  { id: "buy_airtime", label: "Buy airtime or data", kind: "directory", category: "airtime_data", webPath: "/pay/new/buy_airtime" },
  { id: "government", label: "Government services", kind: "directory", category: "government", webPath: "/pay/new/government" },
  // The eKash transfer (*182*1*2*<receiver>*<amount>#): built in the app and opened in the dialer, like the directory codes.
  { id: "ekash", label: "Use eKash", kind: "ekash" },
];

export const LAUNCHER_LINKS = {
  ussd: { label: "Open USSD directory", path: "/pay/ussd" },
} as const;

/** The centre button is shown only where Pay is on. Any doubt hides it: never a button that does nothing. */
export function showPayButton(config: { ok: boolean } & Partial<PayConfig>): boolean {
  return config.ok && config.pay === true;
}

/** The prepare-here actions work only where assisted pay is on; the directory tiles and eKash (which only builds a code) are always offered. */
export function actionAvailableHere(action: LauncherAction, config: Partial<PayConfig>): boolean {
  return action.kind === "directory" || action.kind === "ekash" || config.assistedPay === true;
}

/** Whether a directory tile opens the in-app directory (true) or falls back to the web page (false). */
export function opensInApp(config: Partial<PayConfig>): boolean {
  return config.ussdDirectory === true;
}
