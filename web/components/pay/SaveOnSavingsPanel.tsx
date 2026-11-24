"use client";

import Link from "next/link";
import { useState } from "react";

import { messages } from "../../lib/ussd/messages";
import { fill, formatRwf } from "../../lib/pay/splits/format";
import {
  DEFAULT_SAVINGS_PERIOD,
  hasSavingsActivity,
  periodOf,
  SAVINGS_PERIODS,
  savedPercent,
  type SavingsPeriodKey,
  type SavingsReport,
} from "../../lib/pay/splits/savings-report";

const t = messages().pay.splits.savings;

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Kigali" });

/**
 * What Save On has saved, over the window the person picks. Every window is already in
 * the report, so switching is instant. Estimates, and a saving counts only once every part
 * of a plan has gone through (the server decides that; this only shows it).
 *
 * `compact` is the one-line Home tile: the all-time-ish month figure and a link, shown only
 * once there is something to say.
 */
export function SaveOnSavingsPanel({
  report,
  compact = false,
  initialPeriod = DEFAULT_SAVINGS_PERIOD,
}: {
  report: SavingsReport;
  compact?: boolean;
  initialPeriod?: SavingsPeriodKey;
}) {
  const [key, setKey] = useState<SavingsPeriodKey>(initialPeriod);
  const period = periodOf(report, key);
  const share = savedPercent(period);
  const label = SAVINGS_PERIODS.find((p) => p.key === key)?.label ?? "";
  const active = hasSavingsActivity(report);

  if (compact) {
    if (!active) return null;
    return (
      <section
        aria-label={t.title}
        className="flex items-center justify-between gap-3 rounded-card border border-border-subtle bg-surface p-4"
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-accent">{messages().pay.splits.brand}</p>
          <p className="text-sm text-text-secondary">{t.title}</p>
          <p className="text-xl font-semibold text-text-primary tabular-nums">
            {formatRwf(periodOf(report, "30d").savedMinor)} RWF
          </p>
          <p className="text-xs text-text-muted">Last month</p>
        </div>
        <Link href="/pay/splits" className="text-sm font-medium text-accent hover:underline">
          {t.seeAll}
        </Link>
      </section>
    );
  }

  return (
    <section aria-label={t.title} className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">{messages().pay.splits.brand}</p>
        <h2 className="text-base font-semibold text-text-primary">{t.title}</h2>
        <p className="mt-1 text-sm text-text-secondary">{t.intro}</p>
      </div>

      <div role="group" aria-label={t.periodGroup} className="flex flex-wrap gap-2">
        {SAVINGS_PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            aria-pressed={p.key === key}
            onClick={() => setKey(p.key)}
            className={`min-h-11 rounded-control border px-3 text-sm ${
              p.key === key
                ? "border-accent bg-accent font-semibold text-accent-foreground"
                : "border-border-subtle bg-background text-text-secondary"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div aria-live="polite" className="flex flex-col gap-1">
        {period.plans === 0 ? (
          <>
            <p className="text-2xl font-semibold text-text-primary">{t.none}</p>
            <p className="text-sm text-text-secondary">{label}</p>
          </>
        ) : (
          <>
            <p className="text-3xl font-semibold text-text-primary tabular-nums">{formatRwf(period.savedMinor)} RWF</p>
            <p className="text-sm text-text-secondary">
              {label} · {fill(t.plans, { n: period.plans, s: period.plans === 1 ? "" : "s", transfers: period.transfers })}
            </p>
            <p className="text-sm text-text-secondary">{fill(t.asOne, { amount: formatRwf(period.wouldHavePaidMinor) })}</p>
            <p className="text-sm text-text-secondary">{fill(t.asParts, { amount: formatRwf(period.paidMinor) })}</p>
            <p className="text-sm font-medium text-text-primary">
              {share === null
                ? fill(t.savedNoShare, { amount: formatRwf(period.savedMinor) })
                : fill(t.saved, { amount: formatRwf(period.savedMinor), pct: share })}
            </p>
          </>
        )}
      </div>

      {!active && <p className="text-sm text-text-secondary">{t.emptyBody}</p>}

      {report.inProgress.plans > 0 && (
        <p className="text-sm text-text-secondary">
          {fill(t.inProgress, { n: report.inProgress.plans, amount: formatRwf(report.inProgress.expectedSavingMinor) })}
        </p>
      )}

      {report.recent.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-text-primary">{t.recentTitle}</h3>
          <ul className="mt-1 flex flex-col gap-1 text-sm text-text-secondary">
            {report.recent.map((r) => (
              <li key={r.planId}>
                {fill(t.recentRow, {
                  date: day(r.completedAt),
                  total: formatRwf(r.totalMinor),
                  n: r.transfers,
                  amount: formatRwf(r.savedMinor),
                })}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-text-muted">{t.estimate}</p>
    </section>
  );
}
