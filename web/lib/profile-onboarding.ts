// Country -> regional defaults. `currency` / `timezone` are applied as
// editable suggestions by FinancialPreferencesOnboardingForm; `momoProviders`
// are the mobile-money providers worth offering first when the user adds a
// financial account in that country (a recommendation, never a
// restriction - `other` and every bank option stay available). Empty for
// countries with no first-class MoMo support here yet.
export const ONBOARDING_COUNTRIES = [
  { value: "RW", label: "Rwanda", currency: "RWF", timezone: "Africa/Kigali", momoProviders: ["mtn_momo", "airtel_money"] },
  { value: "KE", label: "Kenya", currency: "KES", timezone: "Africa/Nairobi", momoProviders: ["mpesa", "airtel_money"] },
  { value: "UG", label: "Uganda", currency: "UGX", timezone: "Africa/Kampala", momoProviders: ["mtn_momo", "airtel_money"] },
  { value: "TZ", label: "Tanzania", currency: "TZS", timezone: "Africa/Dar_es_Salaam", momoProviders: ["mpesa", "airtel_money", "mixx"] },
  { value: "BI", label: "Burundi", currency: "BIF", timezone: "Africa/Bujumbura", momoProviders: ["lumicash", "ecocash"] },
  { value: "CD", label: "DR Congo", currency: "CDF", timezone: "Africa/Lubumbashi", momoProviders: ["mpesa", "airtel_money", "orange_money"] },
  { value: "ZA", label: "South Africa", currency: "ZAR", timezone: "Africa/Johannesburg", momoProviders: [] },
  { value: "GB", label: "United Kingdom", currency: "GBP", timezone: "Europe/London", momoProviders: [] },
  { value: "US", label: "United States", currency: "USD", timezone: "America/New_York", momoProviders: [] },
  { value: "FR", label: "France", currency: "EUR", timezone: "Europe/Paris", momoProviders: [] },
] as const;

export const ONBOARDING_CURRENCIES = ["RWF", "USD", "EUR", "GBP", "KES", "UGX", "TZS", "BIF", "CDF", "ZAR"] as const;
export const ONBOARDING_LOCALES = [
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
] as const;

export type ProfileOnboardingStep = "profile" | "preferences" | "setup" | "completed";

const DEFAULT_COUNTRY = "RW";

function findCountry(code: string) {
  return ONBOARDING_COUNTRIES.find((c) => c.value === code.toUpperCase());
}

export function isOnboardingCountry(value: string): boolean {
  return ONBOARDING_COUNTRIES.some((country) => country.value === value);
}

export function isOnboardingCurrency(value: string): boolean {
  return ONBOARDING_CURRENCIES.some((currency) => currency === value);
}

export function isOnboardingLocale(value: string): boolean {
  return ONBOARDING_LOCALES.some((locale) => locale.value === value);
}

/** Suggested primary currency for a country; falls back to the default. */
export function currencyForCountry(code: string): string {
  return (findCountry(code) ?? findCountry(DEFAULT_COUNTRY)!).currency;
}

/** Suggested IANA timezone for a country; falls back to the default. */
export function timezoneForCountry(code: string): string {
  return (findCountry(code) ?? findCountry(DEFAULT_COUNTRY)!).timezone;
}

/**
 * Mobile-money providers to surface first when adding an account in this
 * country. Empty array = no recommendation (show the generic list).
 * Never a restriction.
 */
export function momoProvidersForCountry(code: string): readonly string[] {
  return findCountry(code)?.momoProviders ?? [];
}
