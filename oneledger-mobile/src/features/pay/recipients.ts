import { supabase } from "@/api/supabase";

import { activeWorkspace } from "./payment-accounts";
import { normalizeRwandaMsisdn } from "./target";
import type { PayKind } from "./new-form";

// Trusted recipients and recent payees, read and written under RLS exactly as
// the web does (web/lib/pay/intents.ts, web/app/pay/assisted-actions.ts). The
// server flag that gates writing on the web is `trustedRecipients` in
// GET /api/mobile/config; the app only offers the manage screen where it's on.

export type TrustedRecipient = {
  id: string;
  name: string;
  kind: string;
  msisdn: string | null;
  merchantCode: string | null;
  trusted: boolean;
  relationship: string | null;
};

export type RecentRecipient = { name: string; maskedMsisdn: string | null; kind: string | null };

type Row = {
  id: string;
  display_name: string;
  kind: string;
  normalized_msisdn: string | null;
  merchant_code: string | null;
  trust_status: string;
  relationship: string | null;
};

export function toTrusted(row: Row): TrustedRecipient {
  return {
    id: row.id,
    name: row.display_name,
    kind: row.kind,
    msisdn: row.normalized_msisdn,
    merchantCode: row.merchant_code,
    trusted: row.trust_status === "trusted_by_user",
    relationship: row.relationship,
  };
}

export async function getTrustedRecipients(): Promise<TrustedRecipient[]> {
  if (!supabase) throw new Error("not connected");
  const { data, error } = await supabase
    .from("trusted_recipients")
    .select("id, display_name, kind, normalized_msisdn, merchant_code, trust_status, relationship")
    .order("display_name", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map(toTrusted);
}

/** The distinct recent payees from the last 40 intents (names only; the number is masked by the server). */
export function distinctRecents(
  rows: readonly { recipient_name: string | null; recipient_msisdn_masked: string | null; recipient_kind: string | null }[],
  limit = 6,
): RecentRecipient[] {
  const seen = new Set<string>();
  const out: RecentRecipient[] = [];
  for (const r of rows) {
    const key = `${r.recipient_name ?? ""}|${r.recipient_msisdn_masked ?? ""}`;
    if (!r.recipient_name || seen.has(key)) continue;
    seen.add(key);
    out.push({ name: r.recipient_name, maskedMsisdn: r.recipient_msisdn_masked, kind: r.recipient_kind });
    if (out.length >= limit) break;
  }
  return out;
}

export async function getRecentRecipients(limit = 6): Promise<RecentRecipient[]> {
  if (!supabase) throw new Error("not connected");
  const { data, error } = await supabase
    .from("payment_intents")
    .select("recipient_name, recipient_msisdn_masked, recipient_kind, created_at")
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) throw new Error(error.message);
  return distinctRecents(data ?? [], limit);
}

/** Saved recipients that fit this payment: a person has a number, a merchant has a code. */
export function recipientsFor(kind: PayKind, all: readonly TrustedRecipient[]): TrustedRecipient[] {
  return all.filter((r) => (kind === "pay_person" ? r.kind === "phone" && r.msisdn : r.kind === "merchant" && r.merchantCode));
}

/** Recents of this kind; one with no recorded kind is kept (the web offers every recent name). */
export function recentsFor(kind: PayKind, all: readonly RecentRecipient[]): RecentRecipient[] {
  const want = kind === "pay_person" ? "phone" : "merchant";
  return all.filter((r) => r.kind === null || r.kind === want);
}

export type NewRecipient = { name: string; kind: "phone" | "merchant"; number: string; relationship?: string; trusted: boolean };

/** Same checks as the web's createTrustedRecipient. Returns the row to insert, or an error message. */
export function validateNewRecipient(
  input: NewRecipient,
): { ok: true; row: Record<string, unknown> } | { ok: false; message: string } {
  const name = input.name.trim();
  if (!name) return { ok: false, message: "Give the recipient a name." };
  const number = input.number.trim();
  let normalized: string | null = null;
  let merchantCode: string | null = null;
  if (input.kind === "phone") {
    normalized = normalizeRwandaMsisdn(number);
    if (!normalized) return { ok: false, message: "That doesn't look like a Rwandan mobile number." };
  } else {
    merchantCode = number.replace(/\s/g, "");
    if (!/^\d{3,12}$/.test(merchantCode)) return { ok: false, message: "Enter the merchant code: 3 to 12 digits." };
  }
  return {
    ok: true,
    row: {
      display_name: name,
      kind: input.kind,
      normalized_msisdn: normalized,
      msisdn_display: normalized ? `0${normalized.slice(3)}` : null,
      merchant_code: merchantCode,
      relationship: input.relationship?.trim() || null,
      trust_status: input.trusted ? "trusted_by_user" : "saved",
    },
  };
}

/** Returns an error message, or null on success. */
export async function createTrustedRecipient(input: NewRecipient): Promise<string | null> {
  const checked = validateNewRecipient(input);
  if (!checked.ok) return checked.message;
  if (!supabase) return "This build isn't connected to OneLedger yet.";
  try {
    const { workspaceId, userId } = await activeWorkspace();
    const { error } = await supabase
      .from("trusted_recipients")
      .insert({ ...checked.row, workspace_id: workspaceId, created_by: userId });
    if (!error) return null;
    return /duplicate|unique/i.test(error.message) ? "You've already saved this recipient." : "Could not save the recipient.";
  } catch {
    return "Could not save the recipient.";
  }
}

export async function setRecipientTrust(id: string, trusted: boolean): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase
    .from("trusted_recipients")
    .update({ trust_status: trusted ? "trusted_by_user" : "saved" })
    .eq("id", id);
  return !error;
}

export async function deleteTrustedRecipient(id: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("trusted_recipients").delete().eq("id", id);
  return !error;
}
