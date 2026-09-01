export const ONBOARDING_COUNTRIES = [
  { value: "RW", label: "Rwanda", currency: "RWF", timezone: "Africa/Kigali" },
  { value: "KE", label: "Kenya", currency: "KES", timezone: "Africa/Nairobi" },
  { value: "UG", label: "Uganda", currency: "UGX", timezone: "Africa/Kampala" },
  { value: "TZ", label: "Tanzania", currency: "TZS", timezone: "Africa/Dar_es_Salaam" },
  { value: "BI", label: "Burundi", currency: "BIF", timezone: "Africa/Bujumbura" },
  { value: "CD", label: "DR Congo", currency: "CDF", timezone: "Africa/Lubumbashi" },
  { value: "ZA", label: "South Africa", currency: "ZAR", timezone: "Africa/Johannesburg" },
  { value: "GB", label: "United Kingdom", currency: "GBP", timezone: "Europe/London" },
  { value: "US", label: "United States", currency: "USD", timezone: "America/New_York" },
  { value: "FR", label: "France", currency: "EUR", timezone: "Europe/Paris" },
] as const;

export const ONBOARDING_CURRENCIES = ["RWF", "USD", "EUR", "GBP", "KES", "UGX", "TZS", "BIF", "CDF", "ZAR"] as const;
export const ONBOARDING_LOCALES = [
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
] as const;

export type ProfileOnboardingStep = "profile" | "preferences" | "setup" | "completed";

export function isOnboardingCountry(value: string): boolean {
  return ONBOARDING_COUNTRIES.some((country) => country.value === value);
}

export function isOnboardingCurrency(value: string): boolean {
  return ONBOARDING_CURRENCIES.some((currency) => currency === value);
}

export function isOnboardingLocale(value: string): boolean {
  return ONBOARDING_LOCALES.some((locale) => locale.value === value);
}

