import { MoneyAmount } from "./MoneyAmount";

export function SummaryMetric({
  label,
  amountRwf,
}: {
  label: string;
  amountRwf: number;
}) {
  return (
    <div className="rounded-card border border-border-subtle bg-surface px-4 py-3.5">
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <div className="mt-1">
        <MoneyAmount amountRwf={amountRwf} size="lg" />
      </div>
    </div>
  );
}
