"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveProfileOnboarding } from "../app/onboarding/actions";
import { ONBOARDING_COUNTRIES, ONBOARDING_LOCALES } from "../lib/profile-onboarding";

const inputClass = "min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-base text-text-primary";

export function ProfileOnboardingForm({ initial }: {
  initial: { firstName: string; lastName: string; countryCode: string; locale: string };
}) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(initial.firstName);
  const [lastName, setLastName] = useState(initial.lastName);
  const [countryCode, setCountryCode] = useState(initial.countryCode);
  const [locale, setLocale] = useState(initial.locale);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form className="flex flex-col gap-4 rounded-card border border-border-subtle bg-surface p-5" onSubmit={(event) => {
      event.preventDefault();
      setError(null);
      startTransition(async () => {
        const result = await saveProfileOnboarding({ firstName, lastName, countryCode, locale });
        if (result.ok) router.push("/onboarding/preferences");
        else setError(result.error);
      });
    }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-secondary">First name</span>
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" maxLength={80} required autoFocus className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-secondary">Last name <span className="font-normal text-text-muted">(optional)</span></span>
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" maxLength={80} className={inputClass} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Country or residence</span>
        <select value={countryCode} onChange={(e) => setCountryCode(e.target.value)} className={inputClass}>
          {ONBOARDING_COUNTRIES.map((country) => <option key={country.value} value={country.value}>{country.label}</option>)}
        </select>
        <span className="text-xs text-text-muted">Used to suggest currency, timezone, and available financial services.</span>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Language</span>
        <select value={locale} onChange={(e) => setLocale(e.target.value)} className={inputClass}>
          {ONBOARDING_LOCALES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <button type="submit" disabled={isPending} className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50">
        {isPending ? "Saving…" : "Continue"}
      </button>
      {error && <p role="alert" className="text-sm text-attention">{error}</p>}
    </form>
  );
}

