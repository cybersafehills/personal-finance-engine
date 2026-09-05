"use client";

import { useState, useTransition } from "react";
import { saveReportPreferences } from "../app/settings/reports/actions";
import { REPORT_TIMEZONE_OPTIONS } from "../lib/timezones";
import { DEFAULT_ALERT_THRESHOLDS } from "../lib/report-math";
import type { ReportPreferencesRow } from "../lib/queries";

const inputClass =
  "min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary";

/** Parse a number input's string value; NaN for blank/invalid so the server rejects it. */
function num(value: string): number {
  return value.trim() === "" ? NaN : Number(value);
}

export function ReportPreferencesForm({
  preferences,
  suggestedEmail,
}: {
  preferences: ReportPreferencesRow | null;
  suggestedEmail: string | null;
}) {
  const [dailyReportEnabled, setDailyReportEnabled] = useState(
    preferences?.daily_report_enabled ?? false,
  );
  const [timezone, setTimezone] = useState(preferences?.timezone ?? "Africa/Kigali");
  const [generationTime, setGenerationTime] = useState(
    (preferences?.generation_time ?? "00:05:00").slice(0, 5),
  );
  const [emailEnabled, setEmailEnabled] = useState(preferences?.email_enabled ?? false);
  const [deliveryTime, setDeliveryTime] = useState(
    (preferences?.delivery_time ?? "07:00:00").slice(0, 5),
  );
  const [deliveryEmail, setDeliveryEmail] = useState(
    preferences?.delivery_email ?? suggestedEmail ?? "",
  );
  const [includeAiAnalysis, setIncludeAiAnalysis] = useState(
    preferences?.include_ai_analysis ?? false,
  );

  // Alert thresholds - seeded from the stored row, falling back to the
  // system defaults. Kept as strings so the number inputs can be cleared
  // while editing; parsed on submit.
  const [largeTransaction, setLargeTransaction] = useState(
    String(preferences?.alert_large_transaction_rwf ?? DEFAULT_ALERT_THRESHOLDS.largeTransactionRwf),
  );
  const [highDailySpend, setHighDailySpend] = useState(
    String(preferences?.alert_high_daily_spend_rwf ?? DEFAULT_ALERT_THRESHOLDS.highDailySpendRwf),
  );
  const [elevatedFees, setElevatedFees] = useState(
    String(preferences?.alert_elevated_fees_rwf ?? DEFAULT_ALERT_THRESHOLDS.elevatedFeesRwf),
  );
  const storedLowBalance = preferences?.alert_low_balance_rwf ?? null;
  const [lowBalanceEnabled, setLowBalanceEnabled] = useState(
    preferences ? storedLowBalance !== null : DEFAULT_ALERT_THRESHOLDS.lowBalanceRwf !== null,
  );
  const [lowBalance, setLowBalance] = useState(
    String(storedLowBalance ?? DEFAULT_ALERT_THRESHOLDS.lowBalanceRwf ?? 10000),
  );
  const [negativeDays, setNegativeDays] = useState(
    String(
      preferences?.alert_sustained_negative_cashflow_days ??
        DEFAULT_ALERT_THRESHOLDS.sustainedNegativeCashflowDays,
    ),
  );
  const [uncategorizedPercent, setUncategorizedPercent] = useState(
    String(preferences?.alert_uncategorized_percent ?? DEFAULT_ALERT_THRESHOLDS.uncategorizedPercentThreshold),
  );

  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  return (
    <form
      className="flex flex-col gap-4 rounded-card border border-border-subtle bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setErrorMessage(null);
        startTransition(async () => {
          const result = await saveReportPreferences({
            dailyReportEnabled,
            timezone,
            generationTime,
            deliveryTime,
            emailEnabled,
            deliveryEmail,
            includeAiAnalysis,
            alertThresholds: {
              largeTransactionRwf: num(largeTransaction),
              highDailySpendRwf: num(highDailySpend),
              elevatedFeesRwf: num(elevatedFees),
              lowBalanceRwf: lowBalanceEnabled ? num(lowBalance) : null,
              sustainedNegativeCashflowDays: num(negativeDays),
              uncategorizedPercentThreshold: num(uncategorizedPercent),
            },
          });
          if (result.ok) {
            setSavedAt(Date.now());
          } else {
            setErrorMessage(result.error);
          }
        });
      }}
    >
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={dailyReportEnabled}
          onChange={(event) => setDailyReportEnabled(event.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-accent"
        />
        <span>
          <span className="block font-medium text-text-primary">Daily report</span>
          <span className="block text-text-muted">
            Generate a financial report every day covering the previous calendar day.
          </span>
        </span>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Timezone</span>
        <select
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
          className={inputClass}
        >
          {REPORT_TIMEZONE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-text-muted">
          Used to determine the report&apos;s day boundaries and delivery time.
        </span>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Generate report at</span>
        <input
          type="time"
          value={generationTime}
          onChange={(event) => setGenerationTime(event.target.value)}
          className={`${inputClass} w-32`}
        />
        <span className="text-xs text-text-muted">
          Local time, shortly after midnight is recommended so the report covers a complete day.
        </span>
      </label>

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={includeAiAnalysis}
          onChange={(event) => setIncludeAiAnalysis(event.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-accent"
        />
        <span>
          <span className="block font-medium text-text-primary">AI commentary</span>
          <span className="block text-text-muted">
            Add a short, AI-generated interpretation of your report (&ldquo;OneLedger Insights&rdquo;) grounded
            only in the figures already in the report. Informational only, never financial advice - and if it&apos;s
            ever unavailable, the rest of the report is unaffected.
          </span>
        </span>
      </label>

      <fieldset className="flex flex-col gap-3 border-t border-border-subtle pt-4">
        <legend className="text-sm font-medium text-text-primary">Alert thresholds</legend>
        <p className="text-xs text-text-muted">
          When a report is generated, these decide which watch-outs appear. Amounts are in RWF.
          Leave them at the defaults unless a warning is firing too often or not often enough.
        </p>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-secondary">Large single transaction at or above</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1000}
            value={largeTransaction}
            onChange={(event) => setLargeTransaction(event.target.value)}
            className={`${inputClass} w-40`}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-secondary">Total spent in a day at or above</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1000}
            value={highDailySpend}
            onChange={(event) => setHighDailySpend(event.target.value)}
            className={`${inputClass} w-40`}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-secondary">Transaction fees in a day at or above</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={500}
            value={elevatedFees}
            onChange={(event) => setElevatedFees(event.target.value)}
            className={`${inputClass} w-40`}
          />
        </label>

        <div className="flex flex-col gap-1 text-sm">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={lowBalanceEnabled}
              onChange={(event) => setLowBalanceEnabled(event.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-accent"
            />
            <span className="font-medium text-text-secondary">
              Warn when the closing balance drops to or below
            </span>
          </label>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1000}
            value={lowBalance}
            disabled={!lowBalanceEnabled}
            onChange={(event) => setLowBalance(event.target.value)}
            className={`${inputClass} w-40 disabled:opacity-50`}
          />
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-secondary">
            Sustained negative cash flow after this many consecutive days
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={30}
            step={1}
            value={negativeDays}
            onChange={(event) => setNegativeDays(event.target.value)}
            className={`${inputClass} w-24`}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-secondary">
            Too much uncategorized spending at or above this % of the day&apos;s transactions
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            step={1}
            value={uncategorizedPercent}
            onChange={(event) => setUncategorizedPercent(event.target.value)}
            className={`${inputClass} w-24`}
          />
        </label>
      </fieldset>

      <div className="border-t border-border-subtle pt-4">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={emailEnabled}
            onChange={(event) => setEmailEnabled(event.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-accent"
          />
          <span>
            <span className="block font-medium text-text-primary">Morning email</span>
            <span className="block text-text-muted">
              Email a summary of the report once it&apos;s generated.
            </span>
          </span>
        </label>

        {emailEnabled && (
          <div className="mt-3 flex flex-col gap-3 pl-8">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-text-secondary">Send email at</span>
              <input
                type="time"
                value={deliveryTime}
                onChange={(event) => setDeliveryTime(event.target.value)}
                className={`${inputClass} w-32`}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-text-secondary">Email address</span>
              <input
                type="email"
                value={deliveryEmail}
                onChange={(event) => setDeliveryEmail(event.target.value)}
                placeholder="you@example.com"
                required={emailEnabled}
                className={inputClass}
              />
            </label>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={isPending}
          className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save preferences"}
        </button>
        {savedAt && !isPending && !errorMessage && (
          <span className="text-sm text-money-positive">Saved</span>
        )}
      </div>

      {errorMessage && (
        <p role="alert" className="text-sm text-attention">
          {errorMessage}
        </p>
      )}
    </form>
  );
}
