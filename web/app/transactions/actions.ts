"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../lib/supabase-session-server";
import { getActiveWorkspaceId } from "../../lib/queries";
import { isSupportedCurrency, toMinorUnits } from "../../lib/money";
import { ALLOCATION_TYPES, AllocationType } from "../../lib/budget-math";

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
 * deploy). The principal/fee effect formula lives in the
 * create_manual_transaction() database function this calls, deliberately
 * kept identical to what the generated net_effect_rwf column and the
 * transactions_new_accounting_fields_all_or_nothing check constraint both
 * already enforce for status='success' - so the insert is consistent with
 * the database's own invariants, not a parallel reimplementation of
 * contested logic.
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

  const workspaceId = await getActiveWorkspaceId();
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

  // The insert goes through create_manual_transaction
  // (20261222000000_create_manual_transaction.sql), not a direct INSERT:
  // signed-in users have no INSERT on `transactions` (Phase B: ingestion is
  // the only writer). The function re-checks workspace ownership, derives the
  // workspace and currency from the account, and writes the principal/fee
  // effects exactly as the accounting check constraints expect (out moves
  // principal and fee down; in moves principal up and carries no fee).
  const { data: transactionId, error } = await supabase.rpc(
    "create_manual_transaction",
    {
      p_account_id: account.id,
      p_transaction_type: input.transactionType,
      p_direction: input.direction,
      p_amount_minor: amountMinor.toString(),
      p_fee_minor: feeMinor.toString(),
      p_occurred_at: input.occurredAt,
      p_counterparty_name: input.counterpartyName.trim() || null,
      p_notes: input.notes.trim() || null,
    },
  );

  if (error || !transactionId) {
    return { ok: false, error: "Could not create the transaction." };
  }

  // The optional category is applied as a manual decision (with its history
  // entry) through the same function the "Correct category" form uses. The
  // transaction already exists, so a failure here is not fatal: it can be
  // categorized from its detail page, where the user lands next.
  const category = input.category.trim();
  if (category) {
    await supabase.rpc("apply_manual_category_correction", {
      p_transaction_id: transactionId,
      p_category: category,
      p_subcategory: null,
    });
  }

  revalidatePath("/transactions");
  revalidatePath("/budgets");
  return { ok: true, transactionId };
}

export type SimpleActionResult = { ok: true } | { ok: false; error: string };

function isAllocationType(value: string): value is AllocationType {
  return (ALLOCATION_TYPES as readonly string[]).includes(value);
}

/**
 * Replaces a transaction's split across allocations (delete-then-insert,
 * not a diff/patch - the whole set is always specified together, since a
 * partial split makes no sense). The transaction_splits_total constraint
 * trigger (deferred to statement end, see the Phase E migration) is what
 * actually enforces the amounts sum exactly to the transaction's settled
 * effect - this only does the friendlier client-facing validation first.
 */
export async function setTransactionSplits(
  transactionId: string,
  splits: { allocationType: string; amountText: string }[],
): Promise<SimpleActionResult> {
  const supabase = await supabaseSession();
  const { data: transaction, error: transactionError } = await supabase
    .from("transactions")
    .select("currency, workspace_id, principal_effect_rwf, fee_effect_rwf, settlement_state")
    .eq("id", transactionId)
    .maybeSingle();

  if (transactionError || !transaction || !isSupportedCurrency(transaction.currency)) {
    return { ok: false, error: "Transaction not found." };
  }
  if (transaction.settlement_state !== "settled" || transaction.principal_effect_rwf === null) {
    return { ok: false, error: "Only settled transactions can be split." };
  }

  if (splits.length === 0) {
    return { ok: false, error: "Add at least one allocation, or clear the split entirely." };
  }

  const seenTypes = new Set<string>();
  const parsedSplits: { allocationType: AllocationType; amountMinor: bigint }[] = [];
  for (const split of splits) {
    if (!isAllocationType(split.allocationType)) {
      return { ok: false, error: "Unrecognized allocation type." };
    }
    if (seenTypes.has(split.allocationType)) {
      return { ok: false, error: "Each allocation can only appear once in a split." };
    }
    seenTypes.add(split.allocationType);

    let amountMinor: bigint;
    try {
      amountMinor = toMinorUnits(split.amountText, transaction.currency);
    } catch {
      return { ok: false, error: "Enter valid amounts for every allocation." };
    }
    if (amountMinor <= 0n) {
      return { ok: false, error: "Every split amount must be greater than zero." };
    }
    parsedSplits.push({ allocationType: split.allocationType, amountMinor });
  }

  const transactionEffect = Math.abs(
    Number(transaction.principal_effect_rwf) + Number(transaction.fee_effect_rwf),
  );
  const splitsTotal = parsedSplits.reduce((sum, s) => sum + s.amountMinor, 0n);
  if (splitsTotal !== BigInt(transactionEffect)) {
    return {
      ok: false,
      error: `Splits must total exactly the transaction's amount (${transactionEffect}), got ${splitsTotal}.`,
    };
  }

  const { error: deleteError } = await supabase
    .from("transaction_splits")
    .delete()
    .eq("transaction_id", transactionId);
  if (deleteError) {
    return { ok: false, error: "Could not update the split." };
  }

  const { error: insertError } = await supabase.from("transaction_splits").insert(
    parsedSplits.map((s) => ({
      transaction_id: transactionId,
      workspace_id: transaction.workspace_id,
      allocation_type: s.allocationType,
      amount_minor: s.amountMinor,
    })),
  );
  if (insertError) {
    return { ok: false, error: "Could not save the split." };
  }

  revalidatePath(`/transactions/${transactionId}`);
  revalidatePath("/budgets");
  return { ok: true };
}

/** Removes a transaction's split - it reverts to being assigned wholesale via its category mapping, exactly as before any split existed. */
export async function clearTransactionSplits(
  transactionId: string,
): Promise<SimpleActionResult> {
  const supabase = await supabaseSession();
  const { error } = await supabase
    .from("transaction_splits")
    .delete()
    .eq("transaction_id", transactionId);

  if (error) {
    return { ok: false, error: "Could not clear the split." };
  }

  revalidatePath(`/transactions/${transactionId}`);
  revalidatePath("/budgets");
  return { ok: true };
}
