"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../lib/supabase-session-server";
import { getOwnedWorkspaceId } from "../../lib/queries";
import { isSupportedCurrency, toMinorUnits } from "../../lib/money";

export type ManualTransactionResult =
  | { ok: true; transactionId: string }
  | { ok: false; error: string };

const MANUAL_TRANSACTION_TYPES = [
  "send_money",
  "merchant_payment",
  "money_received",
  "airtime",
  "cash_withdrawal",
  "cash_deposit",
  "bill_payment",
  "bank_transfer",
  "other",
] as const;

function isManualTransactionType(
  value: string,
): value is (typeof MANUAL_TRANSACTION_TYPES)[number] {
  return (MANUAL_TRANSACTION_TYPES as readonly string[]).includes(value);
}

export type ManualTransactionInput = {
  accountId: string;
  transactionType: string;
  direction: "in" | "out";
  amountText: string;
  feeText: string;
  occurredAt: string;
  counterpartyName: string;
  category: string;
  notes: string;
};

/**
 * Creates a manually entered transaction - the only path in this app
 * that inserts into `transactions` outside of ingest-momo. Deliberately
 * scoped to what a manual entry can state unambiguously: it is always
 * status='success'/settlement_state='settled' (nothing about "did this
 * happen" is uncertain when a person is typing it in themselves, unlike
 * an SMS-derived transaction), and direction is restricted to in/out
 * (no 'neutral' manual entries - there's no real-world manual use case
 * for one). This intentionally does NOT call the shared accounting
 * engine (supabase/functions/_shared/accounting.ts) - that module exists
 * to resolve genuine SMS-parsing ambiguity (failed/pending/reversed/
 * unknown MTN statuses) that simply doesn't exist for a manual entry, and
 * it isn't import-reachable from web/ anyway (see kigali-time.ts's own
 * comment on why cross-package imports don't survive Vercel's web/-only
 * deploy). The principal/fee effect formula below is deliberately kept
 * byte-for-byte identical to what the generated net_effect_rwf column and
 * the transactions_new_accounting_fields_all_or_nothing check constraint
 * both already enforce for status='success' - so this insert is provably
 * consistent with the database's own invariants, not a parallel
 * reimplementation of contested logic.
 *
 * The transaction's currency is inherited from the selected account, not
 * chosen separately - this is also what unlocks EUR/USD budget actuals:
 * a EUR account's manual transactions carry currency='EUR', and
 * getBudgetActuals() already aggregates by transaction currency with no
 * further change needed (see the Phase E migration's own note on this).
 */
export async function createManualTransaction(
  input: ManualTransactionInput,
): Promise<ManualTransactionResult> {
  if (!isManualTransactionType(input.transactionType)) {
    return { ok: false, error: "Unrecognized transaction type." };
  }
  if (input.direction !== "in" && input.direction !== "out") {
    return { ok: false, error: "Direction must be money in or money out." };
  }
  if (!input.occurredAt) {
    return { ok: false, error: "Choose when this happened." };
  }

  const workspaceId = await getOwnedWorkspaceId();
  if (!workspaceId) {
    return { ok: false, error: "Could not resolve your workspace." };
  }

  const supabase = await supabaseSession();
  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .select("id, currency, is_active")
    .eq("id", input.accountId)
    .maybeSingle();

  if (accountError || !account || !account.is_active) {
    return { ok: false, error: "Choose a valid, active account." };
  }
  if (!isSupportedCurrency(account.currency)) {
    return { ok: false, error: "This account's currency isn't supported for manual entry." };
  }

  let amountMinor: bigint;
  try {
    amountMinor = toMinorUnits(input.amountText, account.currency);
  } catch {
    return { ok: false, error: "Enter a valid amount." };
  }
  if (amountMinor <= 0n) {
    return { ok: false, error: "Amount must be greater than zero." };
  }

  let feeMinor = 0n;
  if (input.feeText.trim()) {
    try {
      feeMinor = toMinorUnits(input.feeText, account.currency);
    } catch {
      return { ok: false, error: "Enter a valid fee amount." };
    }
    if (feeMinor < 0n) {
      return { ok: false, error: "Fee cannot be negative." };
    }
  }

  // Matches the generated net_effect_rwf expression and the
  // transactions_new_accounting_fields_all_or_nothing check constraint
  // exactly for status='success': 'out' moves principal down by amount
  // and fee down by fee; 'in' moves principal up by amount and never
  // subtracts a fee (fees on incoming money aren't modeled - matches
  // existing MoMo ingestion behavior, see accounting.ts).
  const principalEffectMinor = input.direction === "out" ? -amountMinor : amountMinor;
  const feeEffectMinor = input.direction === "out" ? -feeMinor : 0n;

  const { data, error } = await supabase
    .from("transactions")
    .insert({
      momo_message_id: null,
      account_id: account.id,
      workspace_id: workspaceId,
      source: "manual",
      transaction_type: input.transactionType,
      direction: input.direction,
      status: "success",
      currency: account.currency,
      amount_rwf: amountMinor,
      fee_rwf: feeMinor,
      principal_effect_rwf: principalEffectMinor,
      fee_effect_rwf: feeEffectMinor,
      settlement_state: "settled",
      affects_balance: true,
      effect_reason: "manual_entry",
      counterparty_name: input.counterpartyName.trim() || null,
      occurred_at: input.occurredAt,
      category: input.category.trim() || null,
      category_source: input.category.trim() ? "manual" : null,
      notes: input.notes.trim() || null,
      parser_version: "manual-entry-v1",
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: "Could not create the transaction." };
  }

  revalidatePath("/transactions");
  revalidatePath("/budgets");
  return { ok: true, transactionId: data.id };
}
