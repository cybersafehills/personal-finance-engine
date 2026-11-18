"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAccount } from "../../app/settings/accounts/actions";

const TYPES = [
  { value: "mtn_momo", label: "MTN Mobile Money" },
  { value: "airtel_money", label: "Airtel Money" },
  { value: "bank", label: "Bank account" },
  { value: "other", label: "Cash or other" },
] as const;

const field =
  "min-h-11 w-full rounded-control border border-border-subtle bg-surface px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent";

/**
 * Add a wallet without leaving the Wallets page. A wallet is just an account
 * you name and type; its balance then arrives from your phone's messages, a
 * statement import, or a balance you enter - the card says which.
 */
export function AddWalletForm({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]["value"]>("mtn_momo");
  const [currency, setCurrency] = useState("RWF");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const nameId = useId();
  const typeId = useId();
  const currencyId = useId();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-11 self-start rounded-control border border-border-subtle bg-surface px-4 py-2.5 text-sm font-semibold text-text-primary hover:border-accent"
      >
        Add a wallet
      </button>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const res = await createAccount(name, type, currency);
          if (!res.ok) {
            setError(res.error);
            return;
          }
          setName("");
          setOpen(defaultOpen);
          router.refresh();
        });
      }}
    >
      <h2 className="text-sm font-semibold text-text-primary">Add a wallet</h2>
      <div className="flex flex-col gap-1">
        <label htmlFor={nameId} className="text-xs font-medium text-text-secondary">Name</label>
        <input
          id={nameId}
          className={field}
          value={name}
          maxLength={60}
          required
          placeholder="e.g. Equity Bank, Savings, Cash"
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={typeId} className="text-xs font-medium text-text-secondary">Type</label>
          <select
            id={typeId}
            className={field}
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
          >
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={currencyId} className="text-xs font-medium text-text-secondary">Currency</label>
          <select
            id={currencyId}
            className={field}
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {["RWF", "USD", "EUR"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      {error ? <p role="alert" className="text-sm text-attention">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending || name.trim() === ""}
          className="min-h-11 rounded-control bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add wallet"}
        </button>
        {!defaultOpen && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="min-h-11 rounded-control px-4 py-2.5 text-sm font-medium text-text-secondary"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
