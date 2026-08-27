// UI chrome strings for the Pay & Services surface.
//
// There is no i18n framework in this codebase yet (decision recorded in
// docs/pay-and-services.md: "translation-ready content, no framework").
// This module is the single place those strings live, shaped as a nested
// object keyed by locale so a later extraction to next-intl (or similar)
// is mechanical. Directory *content* (service names, descriptions,
// steps) is localized separately via the *_en / *_rw columns on
// service_codes and friends - see pickLocale() below.
//
// Only "en" is populated today. `rw` intentionally falls back to `en`
// via t()/pickLocale so nothing renders blank before translations land.

export type Locale = "en" | "rw";

export const DEFAULT_LOCALE: Locale = "en";

const en = {
  pay: {
    action: "Pay",
    launcherTitle: "Pay & Services",
    launcherSubtitle: "Prepare a payment or find a verified USSD code.",
    close: "Close",
    comingSoon: "Coming in a later update",
    primary: {
      person: "Pay a person",
      merchant: "Pay a merchant",
      bill: "Pay a bill",
      electricity: "Buy electricity",
      airtime: "Buy airtime or data",
      government: "Government services",
    },
    secondary: {
      ussd: "Open USSD directory",
      activity: "View payment activity",
      template: "Use a payment template",
      scan: "Scan payment QR",
    },
    favourites: "Favourites",
    recent: "Recently used",
    disabledTitle: "Pay & Services isn't available",
    disabledBody:
      "This feature is turned off for your account right now. Check back later.",
  },
  ussd: {
    title: "USSD directory",
    subtitle: "Verified USSD codes for Mobile Money, banking, and government services in Rwanda.",
    searchLabel: "Search services",
    searchPlaceholder: "Search by name or code",
    categoryLabel: "Category",
    providerLabel: "Provider",
    allCategories: "All categories",
    allProviders: "All providers",
    favourites: "Favourites",
    recent: "Recently used",
    noResultsTitle: "No matching services",
    noResultsBody: "Try a different search term, or clear the filters.",
    emptyTitle: "The directory is empty",
    emptyBody: "No published services yet. Check back soon.",
    favouritesEmpty: "You haven't starred any services yet.",
    recentEmpty: "Services you use will show up here.",
    notVerifiedBadge: "Not officially verified",
    verifiedBadge: "Verified",
    deprecatedNotice: "This code is deprecated and may no longer work.",
    replacementLink: "Use the current code instead",
    unavailableNotice: "This service is temporarily unavailable.",
    prerequisitesHeading: "You'll need",
    stepsHeading: "How to do this on your phone",
    copyCode: "Copy code",
    copied: "Copied",
    openDialer: "Open phone dialer",
    dialerUnavailable: "Dialing isn't available on this device. Copy the code and dial it on your phone.",
    handoffNotice:
      "You'll authorize this with your provider, on your own phone. OneLedger never asks for your Mobile Money or banking PIN.",
    sourceHeading: "Source",
    reportCta: "Report incorrect information",
    reportTitle: "Report this code",
    reportTypeLabel: "What's wrong?",
    reportDetailsLabel: "Details (optional)",
    reportSubmit: "Send report",
    reportThanks: "Thanks - we'll review this.",
    reportTypes: {
      incorrect_code: "The code is wrong",
      outdated: "The code is out of date",
      wrong_prerequisites: "The listed prerequisites are wrong",
      provider_changed: "The provider changed this service",
      other: "Something else",
    },
  },
  admin: {
    title: "USSD directory admin",
    queueTitle: "Review queue",
    drafts: "Drafts",
    pendingReview: "Pending review",
    openReports: "Open reports",
    published: "Published",
    newCode: "New service code",
    editCode: "Edit service code",
    versionHistory: "Version history",
    stateChange: "Change state",
    stateReasonLabel: "Reason (optional)",
    save: "Save",
    markVerified: "Mark verified against source",
    notAuthorized: "You don't have access to this area.",
  },
} as const;

type Messages = typeof en;

const catalog: Record<Locale, Messages> = {
  en,
  // Kinyarwanda not yet translated - falls back to English, never blank.
  rw: en,
};

export function messages(locale: Locale = DEFAULT_LOCALE): Messages {
  return catalog[locale] ?? catalog[DEFAULT_LOCALE];
}

/**
 * Pick a localized value from a row that carries `<field>_en` / `<field>_rw`
 * columns, falling back to English (then to null) so a missing
 * translation never renders as an empty string.
 */
export function pickLocale<T extends Record<string, unknown>>(
  row: T,
  field: string,
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  const localized = row[`${field}_${locale}`];
  if (typeof localized === "string" && localized.trim()) return localized;
  const english = row[`${field}_en`];
  if (typeof english === "string" && english.trim()) return english;
  return null;
}
