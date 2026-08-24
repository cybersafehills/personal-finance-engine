"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createManualTransaction } from "../app/transactions/actions";
import type { AccountRow } from "../lib/queries";

const TRANSACTION_TYPE_OPTIONS = [
  { value: "merchant_payment", label: "Merchant payment" },
  { value: "send_money", label: "Send money" },
  { value: "money_received", label: "Money received" },
  { value: "airtime", label: "Airtime" },
  { value: "cash_withdrawal", label: "Cash withdrawal" },
  { value: "cash_deposit", label: "Cash deposit" },
  { value: "bill_payment", label: "Bill payment" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "other", label: "Other" },
] as const;

function nowLocalDatetimeValue(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

export function ManualTransactionForm({ accounts }: { accounts: AccountRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [direction, setDirection] = useState<"in" | "out">("out");
  const [transactionType, setTransactionType] = useState("merchant_payment");
  const [amountText, setAmountText] = useState("");
  const [feeText, setFeeText] = useState("");
  const [occurredAt, setOccurredAt] = useState(nowLocalDatetimeValue());
  const [counterpartyName, setCounterpartyName] = useState("");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");

  const selectedAccount = accounts.find((a) => a.id === accountId);

  if (accounts.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        Add an account first — a manual transaction must belong to one.
      </p>
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    startTransition(async () => {
      const result = await createManualTransaction({
        accountId,
        transactionType,
        direction,
        amountText,
        feeText,
        occurredAt: new Date(occurredAt).toISOString(),
        counterpartyName,
        category,
        notes,
      });
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
      router.push(`/transactions/${result.transactionId}`);
    });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Account</span>
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          required
          className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
          ))}
        </select>
      </label>

      <div className="flex gap-2 rounded-control bg-background p-1 text-sm">
        {(["out", "in"] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDirection(d)}
            className={`flex-1 rounded-control py-1.5 font-medium transition-colors ${
              direction === d ? "bg-surface text-text-primary shadow-sm" : "text-text-muted"
            }`}
          >
            {d === "out" ? "Money out" : "Money in"}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Type</span>
        <select
          value={transactionType}
          onChange={(e) => setTransactionType(e.target.value)}
          className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
        >
          {TRANSACTION_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-secondary">
            Amount {selectedAccount ? `(${selectedAccount.currency})` : ""}
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            required
            className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-secondary">Fee (optional)</span>
          <input
            type="text"
            inputMode="decimal"
            value={feeText}
            onChange={(e) => setFeeText(e.target.value)}
            className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">When</span>
        <input
          type="datetime-local"
          value={occurredAt}
          onChange={(e) => setOccurredAt(e.target.value)}
          required
          className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Counterparty (optional)</span>
        <input
          type="text"
          value={counterpartyName}
          onChange={(e) => setCounterpartyName(e.target.value)}
          className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Category (optional)</span>
        <input
          type="text"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="e.g. Groceries"
          className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Notes (optional)</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
        />
      </label>

      {errorMessage && (
        <p role="alert" className="text-sm text-attention">{errorMessage}</p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
      >
        {isPending ? "Saving…" : "Add transaction"}
      </button>
    </form>
  );
}
