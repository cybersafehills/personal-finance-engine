// A curated IANA timezone list for the reporting preferences selector
// (master prompt §29: "avoid free-form timezone strings where a
// controlled timezone selector is appropriate"). Deliberately a short,
// broad-coverage list rather than the full ~400-zone IANA database - a
// searchable/exhaustive picker is more UI than a single daily-report
// preference warrants today. Server-side validation
// (saveReportPreferences in app/settings/reports/actions.ts) additionally
// checks against Intl.supportedValuesOf("timeZone") as defense-in-depth,
// so a value outside this curated list is rejected even if this file and
// the client were somehow bypassed - this list only constrains the UI.

export const REPORT_TIMEZONE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "Africa/Kigali", label: "Kigali (Rwanda)" },
  { value: "Africa/Nairobi", label: "Nairobi (East Africa)" },
  { value: "Africa/Lagos", label: "Lagos (West Africa)" },
  { value: "Africa/Johannesburg", label: "Johannesburg (South Africa)" },
  { value: "Africa/Cairo", label: "Cairo (Egypt)" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Paris", label: "Paris / Berlin / Madrid" },
  { value: "America/New_York", label: "New York (Eastern)" },
  { value: "America/Chicago", label: "Chicago (Central)" },
  { value: "America/Denver", label: "Denver (Mountain)" },
  { value: "America/Los_Angeles", label: "Los Angeles (Pacific)" },
  { value: "America/Sao_Paulo", label: "São Paulo" },
  { value: "Asia/Dubai", label: "Dubai" },
  { value: "Asia/Kolkata", label: "Mumbai / Delhi" },
  { value: "Asia/Shanghai", label: "Shanghai / Beijing" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Australia/Sydney", label: "Sydney" },
  { value: "Pacific/Auckland", label: "Auckland" },
  { value: "UTC", label: "UTC" },
] as const;

const CURATED_VALUES = new Set(REPORT_TIMEZONE_OPTIONS.map((o) => o.value));

/**
 * Full defense-in-depth check: must be in the curated UI list AND a value
 * the runtime's ICU data actually recognizes as a real IANA zone.
 * Intl.supportedValuesOf may be unavailable in a very old runtime, in
 * which case this degrades to the curated-list check alone (every value
 * in that list is a real zone, so this never becomes less safe, only
 * potentially less strict about zones outside it - which the curated
 * check already excludes anyway).
 */
export function isValidReportTimezone(value: string): boolean {
  if (!CURATED_VALUES.has(value)) return false;
  if (typeof Intl.supportedValuesOf !== "function") return true;
  return Intl.supportedValuesOf("timeZone").includes(value);
}
