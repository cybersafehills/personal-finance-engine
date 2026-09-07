import { formatRwf } from "../lib/format";
import type { LifetimeFlowTotals } from "../lib/queries";

// Two small yellow chips under the Transactions header - the running
// lifetime total a user has sent and received through OneLedger, with no
// time period. Each holds just its figure plus an "i" that discloses a
// one-line explanation (a plain <details>, so it works on tap with no
// JS, matching ds/WhyThisInsight). It is a neutral "your history with us"
// stat, not a spend/alert signal - hence its own black-on-yellow token
// pair rather than the amber --attention colors.

function formatDdMmYyyy(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

function FlowChip({
  srLabel,
  amountRwf,
  info,
}: {
  srLabel: string;
  amountRwf: number;
  info: string;
}) {
  return (
    <details className="relative inline-block">
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded-full bg-lifetime-badge-bg px-2 py-0.5 text-xs font-semibold text-lifetime-badge-text [&::-webkit-details-marker]:hidden">
        <span className="tabular-nums">{formatRwf(amountRwf)}</span>
        <span
          aria-hidden="true"
          className="grid h-3.5 w-3.5 place-items-center rounded-full border border-lifetime-badge-text/40 text-[0.6rem] font-bold leading-none"
        >
          i
        </span>
        <span className="sr-only">{srLabel} &mdash; more information</span>
      </summary>
      <p className="absolute left-0 top-full z-20 mt-1 w-60 rounded-md border border-border-subtle bg-surface p-2 text-xs font-normal text-text-secondary shadow-lg">
        {info}
      </p>
    </details>
  );
}

export function LifetimeFlowBadge({ totals }: { totals: LifetimeFlowTotals }) {
  if (totals.count === 0) return null;

  const created = formatDdMmYyyy(totals.accountCreatedIso);
  const since = created
    ? `since your account was created on ${created}`
    : "since your account was created";

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <FlowChip
        srLabel="Total sent through OneLedger"
        amountRwf={totals.sentRwf}
        info={`Total money sent through OneLedger ${since}.`}
      />
      <FlowChip
        srLabel="Total received through OneLedger"
        amountRwf={totals.receivedRwf}
        info={`Total money received through OneLedger ${since}.`}
      />
    </div>
  );
}
