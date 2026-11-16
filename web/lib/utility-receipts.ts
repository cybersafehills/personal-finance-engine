import "server-only";
import { supabaseSession } from "./supabase-session-server";
import { kwhText } from "./sensitive/token-format";

// Prepaid-electricity receipts that still need a decision (ADR 0020). Session
// client => RLS-scoped; the token columns are not selectable by clients at all.

export type OpenReceipt = {
  id: string;
  status: "unmatched" | "ambiguous";
  amountRwf: number;
  kwh: string;
  meterLast4: string | null;
  receiptAt: string;
  candidates: { id: string; occurredAt: string; counterpartyName: string | null }[];
};

const DAY = 86_400_000;

export async function countOpenReceipts(): Promise<number> {
  const supabase = await supabaseSession();
  const { count } = await supabase
    .from("utility_receipts")
    .select("id", { count: "exact", head: true })
    .in("status", ["unmatched", "ambiguous"]);
  return count ?? 0;
}

export async function listOpenReceipts(): Promise<OpenReceipt[]> {
  const supabase = await supabaseSession();
  const { data } = await supabase
    .from("utility_receipts")
    .select("id, workspace_id, status, amount_rwf, kwh_milli, meter_last4, receipt_at")
    .in("status", ["unmatched", "ambiguous"])
    .order("receipt_at", { ascending: false })
    .limit(50);
  const receipts = data ?? [];
  const out: OpenReceipt[] = [];
  for (const r of receipts) {
    const { data: txs } = await supabase
      .from("transactions")
      .select("id, occurred_at, counterparty_name")
      .eq("workspace_id", r.workspace_id)
      .eq("direction", "out")
      .eq("settlement_state", "settled")
      .eq("amount_rwf", r.amount_rwf)
      .neq("dedupe_state", "merged")
      .gte("occurred_at", new Date(Date.parse(r.receipt_at) - 60 * DAY).toISOString())
      .order("occurred_at", { ascending: false })
      .limit(10);
    const rows = txs ?? [];
    let free = rows;
    if (rows.length > 0) {
      const { data: taken } = await supabase
        .from("utility_receipts")
        .select("transaction_id")
        .in("transaction_id", rows.map((t) => t.id));
      const claimed = new Set((taken ?? []).map((t) => t.transaction_id));
      free = rows.filter((t) => !claimed.has(t.id));
    }
    out.push({
      id: r.id,
      status: r.status,
      amountRwf: Number(r.amount_rwf),
      kwh: kwhText(Number(r.kwh_milli)),
      meterLast4: r.meter_last4 ?? null,
      receiptAt: r.receipt_at,
      candidates: free.map((t) => ({ id: t.id, occurredAt: t.occurred_at, counterpartyName: t.counterparty_name })),
    });
  }
  return out;
}
