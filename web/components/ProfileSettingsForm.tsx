"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveFinancialPreferences,
  saveProfileOnboarding,
} from "../app/onboarding/actions";
import {
  ONBOARDING_COUNTRIES,
  ONBOARDING_CURRENCIES,
  ONBOARDING_LOCALES,
} from "../lib/profile-onboarding";
import { REPORT_TIMEZONE_OPTIONS } from "../lib/timezones";

// Post-onboarding editing of the same profile + regional fields the
// onboarding steps collect (master prompt section 23). Reuses the exact
// server actions (save_onboarding_profile / save_onboarding_preferences
// RPCs) so there is one validated write path - the only difference from
// the onboarding forms is that success stays on the page with a
// confirmation instead of advancing a wizard.
const inputClass =
  "min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-base text-text-primary";

export function ProfileSettingsForm({
  initial,
}: {
  initial: {
    firstName: string;
    lastName: string;
    countryCode: string;
    preferredCurrency: string;
    timezone: string;
    locale: string;
  };
}) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(initial.firstName);
  const [lastName, setLastName] = useState(initial.lastName);
  const [countryCode, setCountryCode] = useState(initial.countryCode);
  const [currency, setCurrency] = useState(initial.preferredCurrency);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [locale, setLocale] = useState(initial.locale);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-4 rounded-card border border-border-subtle bg-surface p-5"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setSaved(false);
        startTransition(async () => {
          const profile = await saveProfileOnboarding({
            firstName,
            lastName,
            countryCode,
            locale,
          });
          if (!profile.ok) {
            setError(profile.error);
            return;
          }
          const prefs = await saveFinancialPreferences({
            preferredCurrency: currency,
            timezone,
            locale,
          });
          if (!prefs.ok) {
            setError(prefs.error);
            return;
          }
          setSaved(true);
          router.refresh();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-secondary">First name</span>
          <input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="given-name"
            maxLength={80}
            required
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-secondary">
            Last name{" "}
            <span className="font-normal text-text-muted">(optional)</span>
          </span>
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            autoComplete="family-name"
            maxLength={80}
            className={inputClass}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Country of residence</span>
        <select
          value={countryCode}
          onChange={(e) => setCountryCode(e.target.value)}
          className={inputClass}
        >
          {ONBOARDING_COUNTRIES.map((country) => (
            <option key={country.value} value={country.value}>
              {country.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-text-muted">
          Used to suggest currency, timezone, and available financial services.
        </span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-secondary">Primary currency</span>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className={inputClass}
          >
            {ONBOARDING_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-secondary">Timezone</span>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className={inputClass}
          >
            {REPORT_TIMEZONE_OPTIONS.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Language</span>
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value)}
          className={inputClass}
        >
          {ONBOARDING_LOCALES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {error && (
        <p role="alert" className="text-sm text-attention">
          {error}
        </p>
      )}
      {saved && !error && (
        <p role="status" className="text-sm text-text-secondary">
          Saved.
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
      >
        {isPending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
