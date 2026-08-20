import { formatRwf } from "../lib/format";

export function BalanceCard({ balanceRwf }: { balanceRwf: number | null }) {
  return (
    <section className="rounded-card bg-accent px-6 py-7 text-accent-foreground shadow-sm">
      <p className="text-sm font-medium text-accent-foreground/80">
        Current balance
      </p>
      <p className="mt-2 text-4xl font-semibold tabular-nums sm:text-5xl">
        {balanceRwf !== null ? formatRwf(balanceRwf) : "—"}
      </p>
      <p className="mt-1 text-sm text-accent-foreground/70">MTN Mobile Money</p>
    </section>
  );
}
