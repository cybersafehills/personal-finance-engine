"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveFinancialPreferences } from "../app/onboarding/actions";
import { ONBOARDING_COUNTRIES, ONBOARDING_CURRENCIES, ONBOARDING_LOCALES } from "../lib/profile-onboarding";
import { REPORT_TIMEZONE_OPTIONS } from "../lib/timezones";

const inputClass = "min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-base text-text-primary";

export function FinancialPreferencesOnboardingForm({ initial }: {
  initial: { countryCode: string; preferredCurrency: string; timezone: string; locale: string };
}) {
  const router = useRouter();
  const countryDefaults = ONBOARDING_COUNTRIES.find((country) => country.value === initial.countryCode);
  const [currency, setCurrency] = useState(countryDefaults?.currency ?? initial.preferredCurrency);
  const [timezone, setTimezone] = useState(countryDefaults?.timezone ?? initial.timezone);
  const [locale, setLocale] = useState(initial.locale);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!REPORT_TIMEZONE_OPTIONS.some((option) => option.value === detected)) return;
    const timer = window.setTimeout(() => setTimezone(detected), 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <form className="flex flex-col gap-4 rounded-card border border-border-subtle bg-surface p-5" onSubmit={(event) => {
      event.preventDefault();
      setError(null);
      startTransition(async () => {
        const result = await saveFinancialPreferences({ preferredCurrency: currency, timezone, locale });
        if (result.ok) router.push("/get-started");
        else setError(result.error);
      });
    }}>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Primary currency</span>
        <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
          {ONBOARDING_CURRENCIES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <span className="text-xs text-text-muted">Used for your personal space, budgets, and reports. You can change it later.</span>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Timezone</span>
        <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={inputClass}>
          {REPORT_TIMEZONE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <span className="text-xs text-text-muted">Detected from this device when supported. Confirm it for transaction dates and scheduled reports.</span>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Formatting language</span>
        <select value={locale} onChange={(e) => setLocale(e.target.value)} className={inputClass}>
          {ONBOARDING_LOCALES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={isPending} className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50">
          {isPending ? "Saving…" : "Save and continue"}
        </button>
        <button type="button" onClick={() => router.push("/onboarding/profile")} className="min-h-11 px-2 text-sm font-medium text-text-muted hover:text-text-primary">Back</button>
      </div>
      {error && <p role="alert" className="text-sm text-attention">{error}</p>}
    </form>
  );
}
