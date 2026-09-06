"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { AccountRow } from "../../lib/queries";
import { createAccount } from "../../app/settings/accounts/actions";
import { PairWizard } from "../PairWizard";

const PROVIDERS = [
  { value: "mtn_momo", label: "MTN MoMo" },
  { value: "airtel_money", label: "Airtel Money" },
  { value: "bank", label: "Bank" },
  { value: "other", label: "Other" },
] as const;

// The "Connect your money" step body. One account first (created right
// here - no trip to Settings), then the pairing + verify wizard inline.
export function OnboardingConnectStep({
  accounts,
  pairingEnabled,
  shortcutUrl,
  captureShortcutUrl,
  mtnSender,
  androidCompanionUrl,
}: {
  accounts: AccountRow[];
  pairingEnabled: boolean;
  shortcutUrl: string | null;
  captureShortcutUrl: string | null;
  mtnSender: string | null;
  androidCompanionUrl: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<string>("mtn_momo");
  const [currency, setCurrency] = useState("RWF");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (accounts.length === 0) {
    return (
      <form
        className="flex flex-col gap-4 rounded-card border border-border-subtle bg-surface p-5"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const result = await createAccount(name.trim(), provider, currency);
            if (result.ok) {
              // Re-render the step so the pairing wizard takes over.
              router.refresh();
            } else {
              setError(result.error);
            }
          });
        }}
      >
        <p className="text-sm text-text-secondary">
          Name the account your activity comes from - your MTN MoMo line, a
          bank account, or cash. You can add more later.
        </p>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-secondary">Account name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. MTN MoMo (Primary)"
            required
            autoFocus
            className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-text-secondary">Provider</span>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-text-secondary">Currency</span>
            <input
              type="text"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              maxLength={3}
              required
              className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm uppercase text-text-primary"
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="text-sm text-attention">{error}</p>
        )}
        <button
          type="submit"
          disabled={isPending || !name.trim()}
          className="min-h-11 w-fit rounded-control bg-accent px-4 text-sm font-semibold text-accent-foreground disabled:opacity-50"
        >
          {isPending ? "Adding…" : "Add this account"}
        </button>
      </form>
    );
  }

  if (!pairingEnabled) {
    return (
      <div className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-5 text-sm text-text-secondary">
        <p>
          Your account <strong className="text-text-primary">
            {accounts[0].name}
          </strong>{" "}
          is ready. Automatic phone capture isn&apos;t available on your plan
          yet - for now you can add transactions yourself or import a
          statement.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/transactions/new"
            className="min-h-11 rounded-control bg-accent px-4 text-sm font-semibold leading-[2.75rem] text-accent-foreground"
          >
            Add a transaction
          </Link>
          <Link
            href="/settings/sources/import"
            className="min-h-11 rounded-control border border-border-strong px-4 text-sm font-medium leading-[2.75rem] text-text-primary"
          >
            Import a statement
          </Link>
        </div>
      </div>
    );
  }

  return (
    <PairWizard
      accounts={accounts}
      shortcutUrl={shortcutUrl}
      captureShortcutUrl={captureShortcutUrl}
      mtnSender={mtnSender}
      androidCompanionUrl={androidCompanionUrl}
    />
  );
}
