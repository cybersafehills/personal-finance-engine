import type { PayConfig } from "./types";

// What the Pay sheet offers, mirroring the web's launcher
// (web/components/pay/PayLauncher.tsx). Person and merchant payments are
// prepared in the app. The others (bill, electricity, airtime, government) and
// the USSD directory, activity and templates open on the web: the app has no
// verified route for them yet (docs/adr/0019 "Pay intents"). One tap never
// executes a payment.

export type LauncherAction =
  | { id: "pay_person" | "pay_merchant"; label: string; kind: "native" }
  | { id: "pay_bill" | "buy_electricity" | "buy_airtime" | "government"; label: string; kind: "web"; path: string };

export const LAUNCHER_ACTIONS: readonly LauncherAction[] = [
  { id: "pay_person", label: "Pay a person", kind: "native" },
  { id: "pay_merchant", label: "Pay a merchant", kind: "native" },
  { id: "pay_bill", label: "Pay a bill", kind: "web", path: "/pay/new/pay_bill" },
  { id: "buy_electricity", label: "Buy electricity", kind: "web", path: "/pay/new/buy_electricity" },
  { id: "buy_airtime", label: "Buy airtime or data", kind: "web", path: "/pay/new/buy_airtime" },
  { id: "government", label: "Government services", kind: "web", path: "/pay/new/government" },
];

export const LAUNCHER_LINKS = {
  ussd: { label: "Open USSD directory", path: "/pay/ussd" },
  activity: { label: "View payment activity", path: "/pay/activity" },
  templates: { label: "Use a payment template", path: "/pay/templates" },
} as const;

/** The centre button is shown only where Pay is on. Any doubt hides it: never a button that does nothing. */
export function showPayButton(config: { ok: boolean } & Partial<PayConfig>): boolean {
  return config.ok && config.pay === true;
}

/** The prepare-here actions work only where assisted pay is on; elsewhere they open the web like the rest. */
export function actionAvailableHere(action: LauncherAction, config: Partial<PayConfig>): boolean {
  return action.kind === "web" || config.assistedPay === true;
}
