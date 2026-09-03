"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  type AccountantPackageInput,
  createAccountantPackage,
} from "../app/integrations/accountant/actions";

const PRESETS: { value: string; label: string }[] = [
  { value: "previous_month", label: "Last month" },
  { value: "current_month", label: "This month" },
  { value: "previous_week", label: "Last week" },
  { value: "last_30_days", label: "Last 30 days" },
  { value: "fiscal_year", label: "Year to date" },
  { value: "__custom", label: "Custom range…" },
];

export function AccountantPackageForm() {
  const router = useRouter();
  const [preset, setPreset] = useState("previous_month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isRunning, start] = useTransition();

  function submit() {
    setError(null);
    setNotice(null);
    const input: AccountantPackageInput = preset === "__custom"
      ? { kind: "absolute", from, to }
      : { kind: "preset", preset: preset as never };

    start(async () => {
      const result = await createAccountantPackage(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(
        result.ran
          ? "Package built — it’s in the list below."
          : "Package queued — it will appear below once built.",
      );
      router.refresh();
    });
  }

  return (
    <div className="rounded-card border border-border-subtle bg-surface p-4">
      <h2 className="mb-1 text-sm font-semibold text-text-primary">
        New package
      </h2>
      <p className="mb-3 text-sm text-text-muted">
        A ZIP with your transactions (CSV + Excel), a reconciliation summary, and
        a PDF cover — ready to hand to an accountant.
      </p>

      <label className="block text-sm font-medium text-text-secondary">
        Period
        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
          className="mt-1 block w-full rounded-md border border-border-subtle bg-background px-3 py-2 text-base"
        >
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </label>

      {preset === "__custom" && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="block text-sm font-medium text-text-secondary">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 block w-full rounded-md border border-border-subtle bg-background px-3 py-2 text-base"
            />
          </label>
          <label className="block text-sm font-medium text-text-secondary">
            To
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 block w-full rounded-md border border-border-subtle bg-background px-3 py-2 text-base"
            />
          </label>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-attention">{error}</p>}
      {notice && <p className="mt-3 text-sm text-money-positive">{notice}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={isRunning || (preset === "__custom" && (!from || !to))}
        className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
      >
        {isRunning ? "Building…" : "Build package"}
      </button>
    </div>
  );
}
