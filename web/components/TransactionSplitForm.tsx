"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clearTransactionSplits, setTransactionSplits } from "../app/transactions/actions";
import { ALLOCATION_TYPES, AllocationType } from "../lib/budget-math";
import { formatMoney, SupportedCurrency } from "../lib/money";
import type { TransactionSplitRow } from "../lib/queries";

const ALLOCATION_LABELS: Record<AllocationType, string> = {
  ESSENTIALS: "Essentials",
  INVESTING: "Investing",
  EMERGENCY: "Emergency savings",
  WANTS: "Wants",
};

export function TransactionSplitForm({
  transactionId,
  currency,
  transactionEffectMinor,
  existingSplits,
}: {
  transactionId: string;
  currency: SupportedCurrency;
  transactionEffectMinor: number;
  existingSplits: TransactionSplitRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const [rows, setRows] = useState<{ allocationType: AllocationType; amountText: string }[]>(
    existingSplits.length > 0
      ? existingSplits.map((s) => ({
        allocationType: s.allocation_type,
        amountText: String(s.amount_minor),
      }))
      : [{ allocationType: "ESSENTIALS", amountText: "" }],
  );

  const isSplit = existingSplits.length > 0;

  function addRow() {
    const unused = ALLOCATION_TYPES.find((t) => !rows.some((r) => r.allocationType === t));
    if (unused) setRows((prev) => [...prev, { allocationType: unused, amountText: "" }]);
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function updateRow(index: number, patch: Partial<{ allocationType: AllocationType; amountText: string }>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function handleSave() {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await setTransactionSplits(
        transactionId,
        rows.map((r) => ({ allocationType: r.allocationType, amountText: r.amountText })),
      );
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
      setIsEditing(false);
      router.refresh();
    });
  }

  function handleClear() {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await clearTransactionSplits(transactionId);
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
      setIsEditing(false);
      router.refresh();
    });
  }

  if (!isEditing) {
    return (
      <div className="mt-3 flex flex-col gap-2">
        {isSplit && (
          <div className="flex flex-col gap-1 text-sm">
            {existingSplits.map((s) => (
              <div key={s.id} className="flex items-center justify-between">
                <span className="text-text-secondary">{ALLOCATION_LABELS[s.allocation_type]}</span>
                <span className="font-medium text-text-primary">
                  {formatMoney(BigInt(s.amount_minor), currency)}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="text-xs font-medium text-accent hover:underline"
          >
            {isSplit ? "Edit split" : "Split across allocations"}
          </button>
          {isSplit && (
            <button
              type="button"
              disabled={isPending}
              onClick={handleClear}
              className="text-xs font-medium text-text-muted hover:text-attention disabled:opacity-50"
            >
              Clear split
            </button>
          )}
        </div>
      </div>
    );
  }

  const total = rows.reduce((sum, r) => sum + (Number(r.amountText) || 0), 0);

  return (
    <div className="mt-3 flex flex-col gap-3">
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          <select
            value={row.allocationType}
            onChange={(e) => updateRow(index, { allocationType: e.target.value as AllocationType })}
            className="min-h-9 flex-1 rounded-control border border-border-strong bg-background px-2 py-1 text-sm text-text-primary"
          >
            {ALLOCATION_TYPES.map((t) => (
              <option key={t} value={t}>{ALLOCATION_LABELS[t]}</option>
            ))}
          </select>
          <input
            type="text"
            inputMode="decimal"
            value={row.amountText}
            onChange={(e) => updateRow(index, { amountText: e.target.value })}
            className="min-h-9 w-28 rounded-control border border-border-strong bg-background px-2 py-1 text-right text-sm text-text-primary"
          />
          {rows.length > 1 && (
            <button
              type="button"
              onClick={() => removeRow(index)}
              className="text-xs font-medium text-text-muted hover:text-attention"
            >
              Remove
            </button>
          )}
        </div>
      ))}

      {rows.length < ALLOCATION_TYPES.length && (
        <button
          type="button"
          onClick={addRow}
          className="self-start text-xs font-medium text-accent hover:underline"
        >
          + Add allocation
        </button>
      )}

      <p className="text-xs text-text-muted">
        Total: {formatMoney(BigInt(Math.round(total)), currency)} of{" "}
        {formatMoney(BigInt(transactionEffectMinor), currency)}
      </p>

      {errorMessage && (
        <p role="alert" className="text-xs text-attention">{errorMessage}</p>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          disabled={isPending}
          onClick={handleSave}
          className="min-h-9 rounded-control bg-accent px-3 text-xs font-medium text-accent-foreground disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save split"}
        </button>
        <button
          type="button"
          onClick={() => setIsEditing(false)}
          className="text-xs font-medium text-text-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
