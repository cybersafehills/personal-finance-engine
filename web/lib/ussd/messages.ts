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
    closeSheet: "Close Pay & Services",
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
    // Phase R1: the "Scan to pay" entry + camera scanner SHELL. No QR
    // decoding / payload parsing / handoff yet - the copy is deliberately
    // honest that this build only proves the camera works on the device.
    scan: {
      entryLabel: "Scan to pay",
      entryHint: "Scan a merchant payment QR code.",
      opening: "Opening scanner…",
      title: "Scan to pay",
      guidance:
        "Point your camera at the merchant's payment QR code and hold steady inside the frame.",
      back: "Back to payment options",
      backLabel: "Back",
      starting: "Starting the camera…",
      live: "Camera is on. Position the QR code inside the frame.",
      // R1 only - remove once the decoder lands.
      shellNotice:
        "Reading a code isn't part of this build yet. The preview is here so we can confirm the camera works on your device.",
      torchOn: "Turn on flashlight",
      torchOff: "Turn off flashlight",
      retry: "Try again",
      permissionHelp: "How to enable camera access",
      permissionHelpBody:
        "Open your browser or device settings, allow camera access for this site, then return here and try again.",
      errors: {
        denied:
          "OneLedger doesn't have permission to use the camera. Enable camera access for this site, then try again.",
        dismissed:
          "Camera access wasn't granted. Try again, or go back to the other payment options.",
        noCamera:
          "No camera was found on this device. You can still use the other payment options.",
        inUse:
          "The camera is in use by another app. Close that app, then try again.",
        insecure: "The camera only works over a secure (HTTPS) connection.",
        unsupported:
          "This browser can't open the camera. Try a recent version of Safari or Chrome.",
        generic:
          "The camera couldn't start. Try again, or go back to the other payment options.",
      },
    },
    favourites: "Favourites",
    recent: "Recently used",
    disabledTitle: "Pay & Services isn't available",
    disabledBody:
      "This feature is turned off for your account right now. Check back later.",
    assisted: {
      newTitle: {
        pay_person: "Pay a person",
        pay_merchant: "Pay a merchant",
        pay_bill: "Pay a bill",
        buy_electricity: "Buy electricity",
        buy_airtime: "Buy airtime or data",
        government: "Government services",
      },
      reviewTitle: "Review before you continue",
      handoffNotice:
        "Authorization happens with your provider, on your own phone. OneLedger never asks for your Mobile Money or banking PIN, and can't send money on your behalf.",
      feeNotice: "Your provider will show the final fee before you approve.",
      sessionStale:
        "You signed in a while ago. If anything looks off, sign out and back in before continuing.",
      sourceAccount: "Pay from",
      recipient: "Recipient",
      amount: "Amount",
      noteLabel: "Note (optional)",
      categoryLabel: "Category (optional)",
      budgetLabel: "Budget (optional)",
      trustBadgeSaved: "Saved",
      trustBadgeTrusted: "Trusted by you",
      trustNotProviderVerified: "Neither means your provider has verified this recipient.",
      nextAction: "Next: hand off to your provider",
      prepare: "Prepare payment",
      copyCode: "Copy code",
      openDialer: "Open phone dialer",
      showQr: "Show QR for your phone",
      qrCaption: "Scan with the phone you'll pay from, then follow the prompts.",
      dialerUnavailable:
        "Dialing isn't available on this device. Copy the code or scan the QR on your phone.",
      confirmCta: "I've confirmed this with my provider",
      confirmHint:
        "Marks this as manually confirmed. OneLedger hasn't independently verified it.",
      failCta: "It didn't work",
      cancelCta: "Cancel this draft",
      payAgain: "Pay again",
      timeline: "Activity",
      activityTitle: "Payment activity",
      activityEmpty: "You haven't prepared any payments yet.",
      recipientsTitle: "Trusted recipients",
      recipientsEmpty: "Save the people and merchants you pay often.",
      templatesTitle: "Payment templates",
      templatesEmpty: "Save a reusable payment setup (no PINs, ever).",
      addRecipient: "Add recipient",
      addTemplate: "New template",
      comingSoonType: "This payment type isn't available yet.",
      recon: {
        title: "Reconciliation",
        linkedHeading: "Linked payment",
        linkedBody: "This payment intent is linked to a transaction in your ledger.",
        likelyHeading: "We found a likely match",
        likelyBody:
          "A transaction in your ledger looks like this payment. Apply it to mark the payment verified.",
        apply: "Apply this match",
        reject: "Not this one",
        viewTransaction: "View transaction",
        conflictHeading: "More than one payment matches this transaction",
        conflictBody: "Pick the one that's right, or none.",
        pickThis: "This is the one",
        noneOfThese: "None of these",
        manualLinkCta: "Link an existing transaction",
        manualLinkBody: "Choose the ledger transaction that settled this payment.",
        manualLinkConfirm: "Link this transaction",
        preparedWithPay: "Prepared with OneLedger Pay",
        queueEmpty: "Nothing to reconcile right now.",
        observeNote:
          "Reconciliation is in observation mode — matches are recorded for review but not applied automatically.",
        noWindowTxns: "No matching ledger transactions in this payment's time window.",
      },
    },
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
  network: {
    findRoute: "Find a route",
    overviewHeading: "About this network",
    purposesHeading: "What you can do",
    operatorHeading: "Operator and regulator",
    feeHeading: "Published fees",
    limitHeading: "Published limits",
    aliasHeading: "Also known as",
    routeFinderTitle: "Route finder",
    routeFinderIntro:
      "Pick where the money starts and where it's going. OneLedger only shows routes it has verified.",
    sourceLabel: "Where the money starts",
    anySource: "Any institution or wallet",
    flowLabel: "What you're doing",
    anyFlow: "Any purpose",
    channelLabel: "Preferred channel",
    anyChannel: "Any channel",
    resultsHeading: "Verified routes",
    noRoutesTitle: "No verified route yet",
    noRoutesBody:
      "OneLedger hasn't verified the institution-specific instructions for this combination. We won't guess — check back, or ask the institution directly.",
    suggestRoute: "Suggest route information",
    suggestRouteComingSoon: "Route suggestions open in a later update.",
    routeResultHeading: "How this route works",
    entryPointHeading: "Where to start",
    stepsHeading: "Steps",
    supportedFlows: "Supported transfers",
    devicesHeading: "Devices and networks",
    verificationHeading: "Verification",
    lastVerified: "Last verified",
    safetyNotice:
      "You authorize the transfer with your provider, on your own phone. OneLedger never asks for your PIN and does not move the money.",
    copyEntryPoint: "Copy",
    saveRoute: "Save to favourites",
    savedRoute: "Saved",
    reportRoute: "Report a problem",
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
