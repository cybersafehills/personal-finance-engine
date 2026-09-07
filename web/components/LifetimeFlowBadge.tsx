import { formatRwf } from "../lib/format";
import type { LifetimeFlowTotals } from "../lib/queries";

// A small, always-present maroon badge on the Transactions screen: the
// running lifetime total a user has sent and received through OneLedger,
// with no time period - "here's your history with us at a glance". It is
// deliberately quiet (small text, hairline border, faint wash) and is
// never a spend/alert signal, so it uses its own --lifetime-flow token
// rather than any of the financial-semantic colors.

function sinceLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "Africa/Kigali",
  });
}

export function LifetimeFlowBadge({ totals }: { totals: LifetimeFlowTotals }) {
  if (totals.count === 0) return null;

  const since = sinceLabel(totals.sinceIso);

  return (
    <div
      className="mb-3 inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-control border border-lifetime-flow/25 bg-lifetime-flow/5 px-2.5 py-1 text-[0.72rem] leading-tight text-lifetime-flow"
      title={`Totals across every transaction OneLedger has recorded for this workspace${
        since ? `, since ${since}` : ""
      }`}
    >
      <span className="font-medium">
        {since ? `Through OneLedger since ${since}` : "Through OneLedger"}
      </span>
      <span aria-hidden="true" className="opacity-40">
        •
      </span>
      <span>
        <span className="font-semibold tabular-nums">
          {formatRwf(totals.sentRwf)}
        </span>{" "}
        sent
      </span>
      <span aria-hidden="true" className="opacity-40">
        •
      </span>
      <span>
        <span className="font-semibold tabular-nums">
          {formatRwf(totals.receivedRwf)}
        </span>{" "}
        received
      </span>
    </div>
  );
}
