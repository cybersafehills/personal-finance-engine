import { redirect } from "next/navigation";
import { getIntelligenceInsights } from "../../../lib/intelligence/insights";
import { OwnAccountPrompt } from "../../../components/people/OwnAccountPrompt";
import { PageHeader } from "../../../components/PageHeader";
import { ForecastChart } from "../../../components/ForecastChart";
import { WhyThisInsight } from "../../../components/ds/WhyThisInsight";
import { kigaliDateKey } from "../../../lib/kigali-time";
import { aboutDays, runOutInDays } from "../../../lib/intelligence/run-out";
import { formatSignedRwf } from "../../../lib/format";
import { loadOwnAccountCandidates } from "../../../lib/counterparties/directory-data";
import { isCounterpartiesEnabledFor } from "../../../lib/counterparties/directory";
import { topSourcesOfMoneyIn } from "../../../lib/counterparties/own-account-suggestions";
import { getActiveWorkspace } from "../../../lib/queries";
import { supabaseSession } from "../../../lib/supabase-session-server";

export const dynamic = "force-dynamic";

const rwf = (minor: number) => formatSignedRwf(minor);
function runOutText(forecast: Parameters<typeof runOutInDays>[0]): string {
  const days = runOutInDays(forecast);
  if (days === null) return "At your recent pace, your balance could go below zero.";
  return days <= 0
    ? "Your balance is already below zero at your recent pace."
    : `At your recent pace, your money could run out ${aboutDays(days)}.`;
}
const title = (key: string) => key.replace(/\b\w/g, (c) => c.toUpperCase());

export default async function ForecastPage() {
  const insights = await getIntelligenceInsights();
  if (!insights.enabled || !insights.forecast) redirect("/inbox");

  const { baseline, recurring, anomalies, walletForecasts: entries } = insights;

  // The "usual income" figure is built from money received. If one of the biggest
  // senders is really one of your own accounts, it inflates that figure - so ask.
  const workspace = await getActiveWorkspace();
  let incomeSources: ReturnType<typeof topSourcesOfMoneyIn> = [];
  if (
    workspace && workspace.role !== "viewer" &&
    isCounterpartiesEnabledFor(process.env, workspace.id) &&
    entries.some((e) => e.forecast.estimatedInMinor > 0)
  ) {
    try {
      incomeSources = topSourcesOfMoneyIn(
        await loadOwnAccountCandidates(await supabaseSession(), workspace.id),
      );
    } catch (e) {
      console.error("forecast income sources failed:", e instanceof Error ? e.message : "unknown");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Cash-flow forecast"
        subtitle="A conservative 30-day outlook for each wallet, from its own ledger — no scores, no guesses beyond your recent pace"
        backHref="/inbox"
        backLabel="Inbox"
      />

      {entries.map(({ walletId, name, balanceAsOf, forecast }) => (
        <div key={walletId} className="flex flex-col gap-6">
          {entries.length > 1 && (
            <h2 className="text-base font-semibold text-text-primary">{name}</h2>
          )}
      <section
        aria-label="Projected balance"
        className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-4"
      >
        {balanceAsOf ? <p className="text-xs text-text-muted">Starting balance as of {kigaliDateKey(balanceAsOf)}.</p> : null}
        <ForecastChart forecast={forecast} />

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-control bg-background p-3">
            <p className="text-xs text-text-muted">
              In {forecast.horizonDays} days · scheduled items only
            </p>
            <p className="tabular-nums font-medium text-text-primary">
              {rwf(forecast.projectedEnd.knownBalanceMinor)}
            </p>
          </div>
          <div className="rounded-control bg-background p-3">
            <p className="text-xs text-text-muted">
              …with everyday spending{forecast.estimatedInMinor > 0 ? " and your usual income" : ""}
            </p>
            <p className="tabular-nums font-medium text-text-primary">
              {rwf(forecast.projectedEnd.estimatedBalanceMinor)}
            </p>
          </div>
          {forecast.estimatedInMinor > 0 && (
            <div className="col-span-2 rounded-control bg-background p-3">
              <p className="text-xs text-text-muted">
                …with everyday spending but nothing new coming in (the cautious end)
              </p>
              <p className="tabular-nums font-medium text-text-primary">
                {rwf(forecast.projectedEnd.noIncomeBalanceMinor)}
              </p>
            </div>
          )}
        </div>

        {forecast.mayGoNegative && (
          <p className="rounded-control bg-attention-bg p-2 text-xs text-attention">
            {runOutText(forecast)} If spending carries on at this pace, the
            balance would be {rwf(forecast.projectedLow.estimatedBalanceMinor)}{" "}
            by day {forecast.projectedLow.dayOffset}. Money that arrives sooner
            would stretch it.
          </p>
        )}
        <p className="text-xs text-text-muted">{forecast.disclaimer}</p>
        <WhyThisInsight
          basis={forecast.basis}
          period={`Next ${forecast.horizonDays} days`}
          method="Current balance, plus dated recurring items and bills, minus an estimated flat daily spend from your last 90 days."
        />
      </section>

      <section
        aria-label="Scheduled movements"
        className="rounded-card border border-border-subtle bg-surface p-4"
      >
        <h2 className="mb-2 text-sm font-semibold text-text-primary">
          Dated commitments in the next {forecast.horizonDays} days
        </h2>
        {forecast.points.length <= 2 ? (
          <p className="text-sm text-text-muted">
            None detected — the estimate below is everyday spending only.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="text-left text-xs text-text-muted">
                  <th className="py-1 pr-3 font-medium">Day</th>
                  <th className="py-1 pr-3 font-medium">Item</th>
                  <th className="py-1 pr-3 text-right font-medium">Amount</th>
                  <th className="py-1 text-right font-medium">
                    Projected balance
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {forecast.points
                  .filter((p) => p.dayOffset > 0)
                  .map((p, i, arr) => {
                    const prev = i === 0
                      ? forecast.openingBalanceMinor
                      : arr[i - 1].knownBalanceMinor;
                    const delta = p.knownBalanceMinor - prev;
                    return (
                      <tr key={`${p.dayOffset}-${p.label}`}>
                        <td className="py-1.5 pr-3 text-text-muted">
                          +{p.dayOffset}d
                        </td>
                        <td className="py-1.5 pr-3 text-text-primary">
                          {p.label}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">
                          {delta !== 0 ? rwf(delta) : "—"}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-text-secondary">
                          {rwf(p.knownBalanceMinor)}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </section>

        </div>
      ))}

      {incomeSources.length > 0 && (
        <OwnAccountPrompt
          title="Where your usual income comes from"
          intro="The forecast counts money you receive as income. If one of these is really one of your own accounts, mark it and it stops counting. Amounts are all-time."
          items={incomeSources}
        />
      )}

      {recurring.length > 0 && (
        <section
          aria-label="Recurring payments"
          className="rounded-card border border-border-subtle bg-surface p-4"
        >
          <h2 className="mb-2 text-sm font-semibold text-text-primary">
            {recurring.length} recurring payment
            {recurring.length === 1 ? "" : "s"} detected
          </h2>
          <ul className="flex flex-col divide-y divide-border-subtle text-sm">
            {recurring.map((p) => (
              <li
                key={`${p.counterpartyKey}:${p.category ?? ""}`}
                className="flex items-center justify-between gap-3 py-2"
              >
                <span className="text-text-primary">
                  {title(p.counterpartyKey)}
                  {p.category && (
                    <span className="text-text-muted"> · {p.category}</span>
                  )}
                </span>
                <span className="shrink-0 text-right text-xs text-text-muted">
                  ~{rwf(-Number(p.typicalAmountMinor))} · around day{" "}
                  {p.typicalDayOfMonth} · seen {p.monthsSeen} months
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {baseline && baseline.changePercent != null && (
        <section
          aria-label="Spending baseline"
          className="rounded-card border border-border-subtle bg-surface p-4"
        >
          <h2 className="mb-1 text-sm font-semibold text-text-primary">
            Spending this month
          </h2>
          <p className="text-sm text-text-secondary">
            <span className="tabular-nums">
              {rwf(-Math.abs(baseline.thisMonthToDateRwf))}
            </span>{" "}
            so far —{" "}
            {baseline.direction === "in_line"
              ? "about the same as"
              : `${Math.abs(baseline.changePercent)}% ${baseline.direction}`}{" "}
            your recent pace (usually {rwf(-Math.abs(baseline.baselineToSameDayRwf))}{" "}
            by now).
          </p>
          <WhyThisInsight
            basis={baseline.basis}
            period={`This month vs your last ${baseline.monthsCompared} complete months`}
            method="Same first-N-days spend, this month vs the average of prior months."
          />
        </section>
      )}

      {anomalies.length > 0 && (
        <section
          aria-label="Unusual payments"
          className="rounded-card border border-border-subtle bg-surface p-4"
        >
          <h2 className="mb-2 text-sm font-semibold text-text-primary">
            {anomalies.length === 1
              ? "An unusually large payment"
              : `${anomalies.length} unusually large payments`}
          </h2>
          <ul className="flex flex-col divide-y divide-border-subtle text-sm">
            {anomalies.map((a) => (
              <li
                key={`${a.counterpartyKey}:${a.occurredAt}`}
                className="flex items-center justify-between gap-3 py-2"
              >
                <span className="text-text-primary">{title(a.counterpartyKey)}</span>
                <span className="shrink-0 text-right text-xs text-text-muted">
                  {rwf(-a.amountMinor)} · about {a.timesTypical}× the usual{" "}
                  {rwf(-a.typicalMinor)}
                </span>
              </li>
            ))}
          </ul>
          <WhyThisInsight
            basis={[
              "A single payment far above what this counterparty has cost you before.",
              "Only counterparties with a stable payment history are checked.",
              "Flagged when it is at least 3x the usual amount and the gap is meaningful.",
            ]}
            period="Last 30 days"
            method="Compared against the median of that counterparty's prior payments."
            confidence="high"
          />
        </section>
      )}
    </div>
  );
}
