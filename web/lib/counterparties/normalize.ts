// Counterparty key normalisation (docs/oneledger-3: identity rules in
// supabase/migrations/20261224000000_counterparties.sql). PURE, zero imports.
// Must stay byte-for-byte equivalent to the SQL function normalize_msisdn and
// the backfill's label/merchant-code rules; both are tested against
// msisdn-vectors.json (this module in Deno, SQL in run_migration_tests.sh).

/** 2507XXXXXXXX or null. Masked values (containing "*") are never identifiers. */
export function normalizeMsisdn(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw.includes("*")) return null;
  const v = raw.replace(/[^0-9]/g, "");
  if (/^2507[0-9]{8}$/.test(v)) return v;
  if (/^002507[0-9]{8}$/.test(v)) return v.slice(2);
  if (/^07[0-9]{8}$/.test(v)) return "250" + v.slice(1);
  if (/^7[0-9]{8}$/.test(v)) return "250" + v;
  return null;
}

/** Weak identity key: lower-cased, whitespace-collapsed label ("" if none). */
export function normalizeLabel(name: string | null | undefined): string {
  return (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export type CounterpartyKey = {
  type: "msisdn" | "merchant_code" | "name_label";
  value: string;
  confidence: "high" | "low";
  kind: "person" | "merchant" | "unknown";
};

/** The key the backfill would assign (strong identifiers win over names). */
export function counterpartyKeyFor(t: {
  transactionType: string;
  name: string | null;
  reference: string | null;
}): CounterpartyKey | null {
  const msisdn = normalizeMsisdn(t.reference);
  if (msisdn) {
    return {
      type: "msisdn",
      value: msisdn,
      confidence: "high",
      kind: "person",
    };
  }
  if (
    t.transactionType === "merchant_payment" && t.reference &&
    /^[0-9]{4,8}$/.test(t.reference)
  ) {
    return {
      type: "merchant_code",
      value: t.reference,
      confidence: "high",
      kind: "merchant",
    };
  }
  const label = normalizeLabel(t.name);
  if (label !== "") {
    return {
      type: "name_label",
      value: label,
      confidence: "low",
      kind: "unknown",
    };
  }
  return null;
}

/** Display-safe form of a number: 2507XX***439. */
export function maskMsisdn(msisdn: string): string {
  return msisdn.length < 9
    ? "***"
    : `${msisdn.slice(0, 5)}***${msisdn.slice(-3)}`;
}
