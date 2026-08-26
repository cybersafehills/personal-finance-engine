"use client";

import { useState, useTransition } from "react";
import { saveReportPreferences } from "../app/settings/reports/actions";
import { REPORT_TIMEZONE_OPTIONS } from "../lib/timezones";
import type { ReportPreferencesRow } from "../lib/queries";

const inputClass =
  "min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary";

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
