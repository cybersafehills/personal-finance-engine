"use client";

import { MoneyAmount } from "./MoneyAmount";
import { usePrivacy } from "./PrivacyProvider";

export function SummaryMetric({
  label,
  amountRwf,
  currency,
}: {
  label: string;
  amountRwf: number;
  currency?: string;
}) {
  const { isDashboardMasked } = usePrivacy();

  return (
    <div className="rounded-card border border-border-subtle bg-surface px-4 py-3.5">
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <div className="mt-1">
        <MoneyAmount amountRwf={amountRwf} currency={currency} size="lg" masked={isDashboardMasked} />
      </div>
    </div>
  );
}
