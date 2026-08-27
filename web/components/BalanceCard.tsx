"use client";

import { formatRwf, dateGroupLabel, formatTime } from "../lib/format";
import { EyeIcon, EyeOffIcon } from "./icons";
import { usePrivacy } from "./PrivacyProvider";

export function BalanceCard({
  balanceRwf,
  asOfIso,
}: {
  balanceRwf: number | null;
  /** occurred_at of the transaction this balance is derived from - null
   *  when there's no transaction history yet (a legitimate empty state,
   *  not unavailable data - see lib/queries.ts's getCurrentBalance). */
  asOfIso: string | null;
}) {
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
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="text-sm text-accent-foreground/70">MTN Mobile Money</p>
        {/* Freshness, not an amount - never masked, and never implied to
            be "live": this balance is only ever as current as the most
            recent transaction MoMo has reported (master prompt §7/§11.4). */}
        {asOfIso && (
          <p className="text-xs text-accent-foreground/60">
            Updated {dateGroupLabel(asOfIso)}, {formatTime(asOfIso)}
          </p>
        )}
      </div>
    </section>
  );
}
