"use client";

import { formatRwf } from "../lib/format";
import { EyeIcon, EyeOffIcon } from "./icons";
import { usePrivacy } from "./PrivacyProvider";

export function BalanceCard({ balanceRwf }: { balanceRwf: number | null }) {
  const {
    isBalanceMasked,
    balanceHiddenByPrivacyMode,
    toggleBalanceVisible,
    isSavingBalanceVisibility,
  } = usePrivacy();

  return (
    <section className="rounded-card bg-accent px-6 py-7 text-accent-foreground shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-accent-foreground/80">
          Current balance
        </p>
        <button
          type="button"
          onClick={toggleBalanceVisible}
          disabled={balanceHiddenByPrivacyMode || isSavingBalanceVisibility}
          aria-label={
            balanceHiddenByPrivacyMode
              ? "Balance hidden by full privacy mode"
              : isBalanceMasked
                ? "Show current balance"
                : "Hide current balance"
          }
          title={
            balanceHiddenByPrivacyMode
              ? "Balance is hidden by full privacy mode (Settings → Privacy and security)"
              : isBalanceMasked
                ? "Show current balance"
                : "Hide current balance"
          }
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-accent-foreground/80 transition-colors hover:bg-accent-foreground/10 hover:text-accent-foreground focus-visible:bg-accent-foreground/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isBalanceMasked ? (
            <EyeOffIcon className="h-5 w-5" />
          ) : (
            <EyeIcon className="h-5 w-5" />
          )}
        </button>
      </div>

      <p className="mt-2 text-4xl font-semibold tabular-nums sm:text-5xl">
        {isBalanceMasked
          ? "••••••"
          : balanceRwf !== null
            ? formatRwf(balanceRwf)
            : "—"}
      </p>
      <p className="mt-1 text-sm text-accent-foreground/70">MTN Mobile Money</p>
    </section>
  );
}
