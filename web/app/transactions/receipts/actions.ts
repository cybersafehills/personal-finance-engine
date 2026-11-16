"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../lib/supabase-session-server";

export type ReceiptActionResult = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function friendly(message: string | undefined): string {
  const s = message ?? "";
  if (/receipt_does_not_match/.test(s)) return "That payment doesn't match this receipt's amount, or it is already linked.";
  if (/receipt_not_found/.test(s)) return "That receipt couldn't be found.";
  return "Something went wrong. Please try again.";
}

// Each action runs a database function as the signed-in user: it checks
// membership, source visibility and the match rules, and writes an audit event.
async function run(fn: string, args: Record<string, unknown>): Promise<ReceiptActionResult> {
  const supabase = await supabaseSession();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/transactions/receipts");
  revalidatePath("/transactions");
  return { ok: true };
}

export async function confirmReceiptAction(receiptId: string, transactionId: string): Promise<ReceiptActionResult> {
  if (!UUID.test(receiptId) || !UUID.test(transactionId)) return { ok: false, error: "That receipt couldn't be found." };
  return run("confirm_utility_receipt", { p_receipt: receiptId, p_transaction: transactionId });
}

export async function ignoreReceiptAction(receiptId: string): Promise<ReceiptActionResult> {
  if (!UUID.test(receiptId)) return { ok: false, error: "That receipt couldn't be found." };
  return run("ignore_utility_receipt", { p_receipt: receiptId });
}

export async function unlinkReceiptAction(receiptId: string): Promise<ReceiptActionResult> {
  if (!UUID.test(receiptId)) return { ok: false, error: "That receipt couldn't be found." };
  const res = await run("unlink_utility_receipt", { p_receipt: receiptId });
  return res;
}
