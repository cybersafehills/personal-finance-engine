import { classify, rejectionForUnsupported } from "./classify";
import { normalizeScan } from "./normalize";
import { maskMerchantId, parseOneLedgerPayload } from "./oneledger";
import {
  checkProviderLink,
  type ProviderLinkAllowEntry,
} from "./provider-link";
import { recogniseEmv } from "./emv";
import { maskDigits } from "./redact";
import { matchesTemplate, parseUssd } from "./ussd";
import {
  MAX_AMOUNT_MINOR,
  type PayloadClass,
  type RejectionReason,
  type ReviewModel,
  type ReviewWarning,
  type ScanAmount,
  type ScanResult,
} from "./types";

// The stage-2..8 orchestrator. Pure and injectable: the two lookups that
// need real-world state - the verified USSD directory and the provider
// allowlist - are passed in, so the whole pipeline is exercised
// deterministically in unit tests and re-run authoritatively on the
// server with live resolvers.

/** A published, matched directory template. */
export type UssdDirectoryMatch = {
  /** service_codes.id - the FK a recorded payment_intent points at. */
  id: string;
  slug: string;
  template: string;
  providerLabel: string | null;
  /** `verified_at` on the directory row - null => published but not
   *  officially verified. */
  verified: boolean;
  /** service_codes.category / .intent - drives payment_type mapping. */
  category: string | null;
  intent: string | null;
  /** supported_networks (['mtn'] / ['airtel']) - drives provider. */
  networks: string[];
};

export type ScanResolvers = {
  /** Match a canonical dial string against published directory templates.
   *  Return null for "structurally USSD but not in the directory".
   *  Omit entirely (undefined) to signal "can't check right now". */
  matchUssd?: (dial: string) => UssdDirectoryMatch | null | Promise<UssdDirectoryMatch | null>;
  providerAllowlist?: readonly ProviderLinkAllowEntry[];
  seenNonces?: ReadonlySet<string>;
  now?: () => number;
};

function reject(cls: PayloadClass, reason: RejectionReason): ScanResult {
  return { ok: false, class: cls, reason };
}

export async function parseScan(
  input: string,
  resolvers: ScanResolvers = {},
): Promise<ScanResult> {
  const normalized = normalizeScan(input);
  if (!normalized.ok) return { ok: false, class: "unsupported", reason: normalized.reason };

  const n = normalized.value;
  const c = classify(n);

  if (c.kind === "suspicious") {
    return { ok: false, class: "suspicious", reason: c.reason };
  }

  switch (c.kind) {
    case "verified_ussd": {
      const parsed = parseUssd(n.raw);
      if (!parsed.ok) return reject("unsupported", parsed.reason);

      if (!resolvers.matchUssd) return reject("unsupported", "needs_connection");
      const match = await resolvers.matchUssd(parsed.value.dial);
      if (!match) return reject("unsupported", "unknown_ussd");

      // A scanned USSD is always a COMPLETE dial string. If the matched
      // directory template is parameterised, matchesTemplate gives us
      // the captured values; the resolver only returns a match when
      // every placeholder lined up, so nothing is left unfilled.
      const captured = matchesTemplate(parsed.value.dial, match.template)?.params ?? {};

      // USSD directory amounts are RWF minor units == the currency itself.
      let amount: ScanAmount | null = null;
      const amtRaw = captured["amount"];
      if (amtRaw != null) {
        const a = Number(amtRaw);
        if (!Number.isInteger(a) || a <= 0 || a >= MAX_AMOUNT_MINOR) {
          return reject("unsupported", "amount_invalid");
        }
        amount = { minor: a, currency: "RWF" };
      }

      const recipRaw =
        captured["phone"] ?? captured["msisdn"] ?? captured["recipient"] ?? null;

      const warnings: ReviewWarning[] = [];
      if (!match.verified) warnings.push("ussd_not_officially_verified");

      const model: ReviewModel = {
        class: "verified_ussd",
        route: {
          kind: "ussd",
          template: match.template,
          literal: parsed.value.dial,
          params: [],
          directorySlug: match.slug,
        },
        providerLabel: match.providerLabel,
        providerVerified: match.verified,
        recipientMasked: recipRaw ? maskDigits(recipRaw) : null,
        amount,
        // A scanned USSD instruction is complete - the amount, if any,
        // is the merchant's. Never user-editable.
        amountEditable: false,
        reference: null,
        description: null,
        invoiceId: null,
        expiresAt: null,
        warnings,
      };
      return { ok: true, model };
    }

    case "oneledger_payment": {
      const parsed = parseOneLedgerPayload(n.raw, {
        seenNonces: resolvers.seenNonces,
        now: resolvers.now,
      });
      if (!parsed.ok) return reject("unsupported", parsed.reason);
      const p = parsed.value;

      const warnings: ReviewWarning[] = ["merchant_unverified"];
      if (p.amountMinor === null) warnings.push("amount_missing");

      const model: ReviewModel = {
        class: "oneledger_payment",
        route: {
          kind: "oneledger",
          provider: p.payload.provider,
          merchantIdMasked: maskMerchantId(p.payload.merchant_id),
          currency: p.currency,
        },
        providerLabel: p.payload.provider,
        // v1 carries no signature - the merchant name is unverified.
        providerVerified: false,
        recipientMasked: p.merchantName ?? maskMerchantId(p.payload.merchant_id),
        amount:
          p.amountMinor !== null
            ? { minor: p.amountMinor, currency: p.currency }
            : null,
        amountEditable: p.amountMinor === null,
        reference: p.reference,
        description: p.description,
        invoiceId: p.invoiceId,
        expiresAt: p.expiresAt,
        warnings,
      };
      return { ok: true, model };
    }

    case "emv_merchant": {
      const r = recogniseEmv(n.raw);
      return reject("unsupported", r.reason);
    }

    case "provider_link": {
      const checked = checkProviderLink(n.raw, resolvers.providerAllowlist);
      if (!checked.ok) {
        const cls: PayloadClass =
          checked.reason === "lookalike_host" ? "suspicious" : "unsupported";
        return reject(cls, checked.reason);
      }
      const model: ReviewModel = {
        class: "provider_link",
        route: { kind: "provider_link", provider: checked.provider, url: checked.url },
        providerLabel: checked.provider,
        providerVerified: true, // host is on the verified allowlist
        recipientMasked: null,
        amount: null,
        amountEditable: false,
        reference: null,
        description: null,
        invoiceId: null,
        expiresAt: null,
        warnings: [],
      };
      return { ok: true, model };
    }

    case "unsupported":
    default:
      return reject("unsupported", rejectionForUnsupported(n));
  }
}
