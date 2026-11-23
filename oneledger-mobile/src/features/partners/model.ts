export const PARTNER_CATEGORIES = ["Connectivity", "Learning", "Banking"] as const;
export type PartnerCategory = typeof PARTNER_CATEGORIES[number];
export type PartnerOffer = {
  id: string; brandId: string; brand: string; category: PartnerCategory;
  title: string; benefit: string; eligibility: string; terms: string;
  destination: string; endsOn: string; country: string; language: string;
  homeFeatured: boolean; financialDisclosure?: string;
};

/** Fictional creative for the development-only placement review. Never a delivery feed. */
export const PREVIEW_OFFERS: readonly PartnerOffer[] = [
  { id: "example-connect", homeFeatured: true, brandId: "example-telecom", brand: "Example Telecom", category: "Connectivity", title: "A little more connection, for less", benefit: "Explore an example 10% data-bundle benefit.", eligibility: "Adults in Rwanda using an eligible prepaid bundle.", terms: "Fictional offer, not redeemable. Selected bundles only; provider eligibility and conditions would apply.", destination: "https://example.com/connect", endsOn: "2026-12-31", country: "Rwanda", language: "English" },
  { id: "example-learn", homeFeatured: false, brandId: "example-learning", brand: "Example Learning", category: "Learning", title: "Build a skill that grows with you", benefit: "Discover an example introductory bookkeeping course.", eligibility: "Adults in Rwanda interested in self-paced learning.", terms: "Fictional offer, not redeemable. Course content, availability and provider terms would be shown before enrollment.", destination: "https://example.com/learn", endsOn: "2026-12-31", country: "Rwanda", language: "English" },
  { id: "example-bank", homeFeatured: true, brandId: "example-bank", brand: "Example Bank", category: "Banking", title: "Understand your account options", benefit: "Explore the provider’s account features, eligibility and fees.", eligibility: "Adults in Rwanda; provider identity and eligibility checks would apply.", terms: "Fictional financial promotion. No real account is offered. Review fees and eligibility before choosing a provider.", destination: "https://example.com/accounts", endsOn: "2026-12-31", country: "Rwanda", language: "English", financialDisclosure: "This paid placement is not a OneLedger recommendation or a guarantee. No return is promised. Financial-provider identity, authorization and claims require separate review before any real campaign can run." },
];
export type PreviewScenario = "returning" | "first-visit" | "daily-cap" | "weekly-cap";
export const PLACEMENT_IDS = ["home", "pay-person", "pay-merchant", "plan"] as const;
export type PlacementId = typeof PLACEMENT_IDS[number];
/**
 * Creative formats, sized like Apple's own widgets so they sit naturally on iPhone:
 *  - wide:   medium-widget proportions (about 2.1 : 1), the main banner
 *  - square: small-widget proportions (1 : 1), shown as a pair so each is half the width
 *  - half:   one small-widget square on its own (half the width), for a single advert
 *  - tall:   the original taller card with the large artwork
 *  - bar:    a slim single-row strip
 */
export const PLACEMENT_FORMATS = ["wide", "square", "half", "tall", "bar"] as const;
export type PlacementFormat = typeof PLACEMENT_FORMATS[number];
export const PLACEMENT_LABELS: Record<PlacementId, { label: string; where: string }> = {
  home: { label: "Home", where: "Above Recent transactions" },
  "pay-person": { label: "Pay a person", where: "Below the Prepare payment button" },
  "pay-merchant": { label: "Pay a merchant", where: "Below the Prepare payment button" },
  plan: { label: "Plan", where: "Below the planning content" },
};
export const DEFAULT_ROTATION_SECONDS = 5;
export const INTERVAL_CHOICES = [3, 5, 8, 12] as const;
/** Platform-owner defaults for one placement. Owned by the platform console, never edited in a user's app. An empty `offerIds` means every eligible offer. */
export type PlacementPosition = "top" | "bottom";
export type PlacementConfig = { enabled: boolean; format: PlacementFormat; mode: "static" | "carousel"; intervalSec: number; loop: boolean; offerIds: string[]; position: PlacementPosition };
export function initialPlacements(): Record<PlacementId, PlacementConfig> {
  const base = (format: PlacementFormat): PlacementConfig => ({ enabled: true, format, mode: "carousel", intervalSec: DEFAULT_ROTATION_SECONDS, loop: true, offerIds: [], position: "bottom" });
  return { home: base("wide"), "pay-person": base("square"), "pay-merchant": base("square"), plan: base("bar") };
}
export type PartnerPreviewState = {
  placements: Record<PlacementId, PlacementConfig>;
  enabled: boolean; scenario: PreviewScenario; homeEnabled: boolean;
  hiddenBrands: string[]; interests: PartnerCategory[]; dismissedUntil: string | null;
  language: "English" | "Kinyarwanda";
};
export function initialPartnerPreview(): PartnerPreviewState {
  return { enabled: false, placements: initialPlacements(), scenario: "returning", homeEnabled: true, hiddenBrands: [], interests: [], dismissedUntil: null, language: "English" };
}
export function eligiblePreviewOffers(state: PartnerPreviewState, today: string, catalog: readonly PartnerOffer[] = PREVIEW_OFFERS) {
  return catalog.filter(offer => offer.endsOn >= today && offer.language === state.language && !state.hiddenBrands.includes(offer.brandId));
}
export function previewHomeReason(state: PartnerPreviewState, today: string): string | null {
  if (!state.enabled) return "Sponsored content is off.";
  if (!state.homeEnabled) return "Home promotions are off. Offers & partners remains available.";
  if (state.scenario === "first-visit") return "No Home promotion during the first three sessions.";
  if (state.scenario === "daily-cap") return "Daily limit reached: no additional Home promotion today.";
  if (state.scenario === "weekly-cap") return "Weekly limit reached: three Home exposures this week.";
  if (state.dismissedUntil && state.dismissedUntil > today) return `Home promotions paused until ${state.dismissedUntil}.`;
  return null;
}
export function previewHomeOffer(state: PartnerPreviewState, today: string, catalog: readonly PartnerOffer[] = PREVIEW_OFFERS) {
  if (previewHomeReason(state, today)) return null;
  return eligiblePreviewOffers(state, today, catalog).find(offer => offer.homeFeatured && (!state.interests.length || state.interests.includes(offer.category))) ?? null;
}
export function sevenDaysAfter(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 7);
  return date.toISOString().slice(0, 10);
}

/** Why a placement shows nothing right now, or null when it may show. Delivery states apply to every placement. */
export function placementReason(state: PartnerPreviewState, id: PlacementId, today: string): string | null {
  if (!state.enabled) return "Sponsored content is off.";
  if (!state.placements[id].enabled) return `${PLACEMENT_LABELS[id].label} placement is switched off by the platform.`;
  if (id === "home") return previewHomeReason(state, today);
  if (state.scenario === "first-visit") return "No promotions during the first three sessions.";
  if (state.scenario === "daily-cap") return "Daily limit reached: no additional promotion today.";
  if (state.scenario === "weekly-cap") return "Weekly limit reached: three exposures this week.";
  return null;
}
/** Offers a placement rotates through, in the owner's chosen order. Home keeps its featured-only rule. */
export function placementOffers(state: PartnerPreviewState, id: PlacementId, today: string, catalog: readonly PartnerOffer[] = PREVIEW_OFFERS): PartnerOffer[] {
  if (placementReason(state, id, today)) return [];
  const config = state.placements[id];
  const pool = eligiblePreviewOffers(state, today, catalog)
    .filter(offer => (id !== "home" || offer.homeFeatured) && (!state.interests.length || state.interests.includes(offer.category)))
    .filter(offer => !config.offerIds.length || config.offerIds.includes(offer.id));
  return config.offerIds.length ? config.offerIds.map(offerId => pool.find(offer => offer.id === offerId)).filter((o): o is PartnerOffer => !!o) : pool;
}
/** Index of the next creative; stops at the last one unless looping. */
export function nextIndex(current: number, count: number, loop: boolean): number {
  if (count <= 1) return 0;
  return current + 1 < count ? current + 1 : loop ? 0 : current;
}

/** Fictional design-review offers carry an example- id and are labelled as examples; real approved offers are not. */
export const isExampleOffer = (offer: PartnerOffer) => offer.id.startsWith("example-");
export const sponsorLabel = (offer: PartnerOffer) => (isExampleOffer(offer) ? "Sponsored · example" : "Sponsored");

export type PartnerFeed = { enabled: boolean; placements: Record<PlacementId, PlacementConfig>; offers: PartnerOffer[] };
export const EMPTY_FEED: PartnerFeed = { enabled: false, placements: initialPlacements(), offers: [] };
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim().length > 0 && v.length <= max ? v : null);
/** Defensive parse of partner_feed(): anything malformed is dropped, never rendered. Offers need an https destination. */
export function parsePartnerFeed(raw: unknown): PartnerFeed {
  if (!isRecord(raw) || raw.enabled !== true) return EMPTY_FEED;
  const placements = initialPlacements();
  for (const row of Array.isArray(raw.placements) ? raw.placements : []) {
    if (!isRecord(row) || !(PLACEMENT_IDS as readonly string[]).includes(String(row.id))) continue;
    const id = row.id as PlacementId;
    const format = (PLACEMENT_FORMATS as readonly unknown[]).includes(row.format) ? (row.format as PlacementFormat) : placements[id].format;
    const interval = typeof row.intervalSec === "number" && row.intervalSec >= 3 && row.intervalSec <= 30 ? row.intervalSec : DEFAULT_ROTATION_SECONDS;
    placements[id] = {
      enabled: row.enabled !== false, format, mode: row.mode === "static" ? "static" : "carousel", intervalSec: interval,
      loop: row.loop !== false, position: row.position === "top" ? "top" : "bottom", offerIds: Array.isArray(row.offerIds) ? row.offerIds.filter((x): x is string => typeof x === "string") : [],
    };
  }
  const offers: PartnerOffer[] = [];
  for (const row of Array.isArray(raw.offers) ? raw.offers : []) {
    if (!isRecord(row)) continue;
    const id = text(row.id, 64), brandId = text(row.brandId, 64), brand = text(row.brand, 120), title = text(row.title, 80), benefit = text(row.benefit, 160);
    const eligibility = text(row.eligibility, 300), terms = text(row.terms, 1000), destination = text(row.destination, 500), endsOn = text(row.endsOn, 10);
    const category = (PARTNER_CATEGORIES as readonly unknown[]).includes(row.category) ? (row.category as PartnerCategory) : null;
    if (!id || !brandId || !brand || !title || !benefit || !eligibility || !terms || !destination || !endsOn || !category || !destination.startsWith("https://")) continue;
    const disclosure = text(row.financialDisclosure, 600) ?? undefined;
    if (category === "Banking" && !disclosure) continue;
    offers.push({ id, brandId, brand, category, title, benefit, eligibility, terms, destination, endsOn, country: text(row.country, 60) ?? "Rwanda", language: text(row.language, 20) ?? "English", homeFeatured: row.homeFeatured === true, financialDisclosure: disclosure });
  }
  return { enabled: true, placements, offers };
}
