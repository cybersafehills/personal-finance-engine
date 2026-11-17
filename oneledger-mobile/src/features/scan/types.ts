// What the app needs of the server's classified scan (web/lib/pay/scan/types.ts).
// The server redacts: it sends masked identifiers and never the raw payload.

export type ScanRejection = { ok: false; class: string; reason: string };

export type ScanRoute =
  | { kind: "ussd"; template: string; literal: string | null }
  | { kind: "provider_link"; provider: string; url: string }
  | { kind: "oneledger"; provider: string | null; merchantIdMasked: string; currency: string };

export type ScanModel = {
  class: "verified_ussd" | "provider_link" | "oneledger_payment";
  route: ScanRoute;
  providerLabel: string | null;
  providerVerified: boolean;
  recipientMasked: string | null;
  amount: { minor: number; currency: string } | null;
  amountEditable: boolean;
  reference: string | null;
  warnings: string[];
};

export type ClassifyResult = { ok: true; model: ScanModel } | ScanRejection;

export type PrepareOutcome =
  | { status: "prepared"; intentId: string; telHref: string; existed: boolean }
  | { status: "info_only"; telHref: string }
  | { status: "unsupported" | "amount_required" | "currency_unsupported" | "feature_disabled" | "error" };
