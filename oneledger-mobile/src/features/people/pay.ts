import { supabase } from "@/api/supabase";
import { formatLocalMsisdn } from "@/features/pay/target";

import type { PersonKind } from "./types";

// "Pay this person / Pay this merchant" on a person's page: what the form needs
// (who, and the number or code they were matched by) comes from the identifiers
// the person was grouped by, read under RLS like every other read in the app.

export type Identifier = { type: string; value: string };

export type PersonPayTarget = {
  type: "pay_person" | "pay_merchant";
  label: "Pay this person" | "Pay this merchant";
  /** The number or merchant code to pay, in the form the Pay form shows; null when none is on record (they type it). */
  to: string | null;
  name: string;
};

/** What the Pay button on a person's page does, or null for someone not yet known to be a person or a merchant. */
export function personPayTarget(person: { kind: PersonKind; displayName: string }, identifiers: readonly Identifier[]): PersonPayTarget | null {
  if (person.kind === "person") {
    const msisdn = identifiers.find((i) => i.type === "msisdn")?.value;
    return { type: "pay_person", label: "Pay this person", to: msisdn ? formatLocalMsisdn(msisdn) : null, name: person.displayName };
  }
  if (person.kind === "merchant") {
    const code = identifiers.find((i) => i.type === "merchant_code")?.value;
    return { type: "pay_merchant", label: "Pay this merchant", to: code ?? null, name: person.displayName };
  }
  return null;
}

/** The identifiers this person (and anyone combined into them) was grouped by. */
export async function getIdentifiers(counterpartyId: string): Promise<Identifier[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("counterparty_identifiers")
    .select("identifier_type, normalized_value")
    .eq("counterparty_id", counterpartyId);
  if (error) return [];
  return ((data ?? []) as { identifier_type: string; normalized_value: string }[]).map((r) => ({ type: r.identifier_type, value: r.normalized_value }));
}
