import { eligiblePreviewOffers, initialPartnerPreview, initialPlacements, nextIndex, placementOffers, placementReason, previewHomeOffer, previewHomeReason, sevenDaysAfter } from "../model";
const today = "2026-11-23";
const active = () => ({ ...initialPartnerPreview(), enabled: true });
it("keeps all placements off until explicitly enabled", () => {
  expect(previewHomeOffer(initialPartnerPreview(), today)).toBeNull();
  expect(previewHomeOffer(active(), today)?.id).toBe("example-connect");
});
it("suppresses Home for the first sessions and capped delivery states", () => {
  for (const scenario of ["first-visit", "daily-cap", "weekly-cap"] as const) {
    expect(previewHomeOffer({ ...active(), scenario }, today)).toBeNull();
    expect(previewHomeReason({ ...active(), scenario }, today)).toBeTruthy();
  }
});
it("a Home opt-out does not remove the offers hub", () => {
  const state = { ...active(), homeEnabled: false };
  expect(previewHomeOffer(state, today)).toBeNull();
  expect(eligiblePreviewOffers(state, today)).toHaveLength(3);
});
it("excludes hidden, expired or language-mismatched offers", () => {
  expect(eligiblePreviewOffers({ ...active(), hiddenBrands: ["example-telecom"] }, today)).toHaveLength(2);
  expect(eligiblePreviewOffers({ ...active(), language: "Kinyarwanda" }, today)).toHaveLength(0);
  expect(eligiblePreviewOffers(active(), "2027-01-01")).toHaveLength(0);
});
it("only uses explicit interests for Home selection and honors seven-day dismissal", () => {
  expect(previewHomeOffer({ ...active(), interests: ["Learning"] }, today)).toBeNull();
  expect(previewHomeOffer({ ...active(), interests: ["Banking"] }, today)?.brand).toBe("Example Bank");
  expect(sevenDaysAfter(today)).toBe("2026-11-30");
  const state = { ...active(), dismissedUntil: sevenDaysAfter(today) };
  expect(previewHomeOffer(state, "2026-11-29")).toBeNull();
  expect(previewHomeOffer(state, "2026-11-30")).not.toBeNull();
});

it("placements are configurable per slot and Home stays featured-only", () => {
  const state = active();
  expect(placementOffers(state, "home", today).map(o => o.id)).toEqual(["example-connect", "example-bank"]);
  expect(placementOffers(state, "plan", today)).toHaveLength(3);
  const off = { ...state, placements: { ...initialPlacements(), plan: { ...initialPlacements().plan, enabled: false } } };
  expect(placementOffers(off, "plan", today)).toEqual([]);
  expect(placementReason(off, "plan", today)).toMatch(/switched off/);
});
it("honours the owner's creative selection and order, and delivery caps on every slot", () => {
  const state = { ...active(), placements: { ...initialPlacements(), "pay-person": { ...initialPlacements()["pay-person"], offerIds: ["example-bank", "example-connect"] } } };
  expect(placementOffers(state, "pay-person", today).map(o => o.id)).toEqual(["example-bank", "example-connect"]);
  expect(placementOffers({ ...state, scenario: "daily-cap" }, "pay-person", today)).toEqual([]);
});
it("advances a carousel and stops at the end when not looping", () => {
  expect(nextIndex(0, 3, true)).toBe(1);
  expect(nextIndex(2, 3, true)).toBe(0);
  expect(nextIndex(2, 3, false)).toBe(2);
  expect(nextIndex(0, 1, true)).toBe(0);
});

it("uses Apple-widget formats and a five second loop by default, and only loops when more than one offer", () => {
  const p = initialPlacements();
  expect([p.home.format, p["pay-person"].format, p["pay-merchant"].format, p.plan.format, p.transactions.format]).toEqual(["wide", "square", "square", "bar", "bar"]);
  expect(p.home.intervalSec).toBe(5);
  expect(p.home.loop).toBe(true);
  expect(nextIndex(0, 1, true)).toBe(0);
});

import { EMPTY_FEED, parsePartnerFeed, sponsorLabel } from "../model";
const offerRow = { id: "11111111-1111-1111-1111-111111111111", brandId: "b1", brand: "Acme", category: "Learning", title: "Build a skill", benefit: "Intro course", eligibility: "Adults", terms: "Terms apply to this offer", destination: "https://example.com/x", endsOn: "2099-12-31", homeFeatured: true };
it("parses a live feed and drops anything malformed or unsafe", () => {
  const feed = parsePartnerFeed({
    enabled: true,
    placements: [{ id: "home", enabled: true, format: "wide", mode: "carousel", intervalSec: 5, loop: true, offerIds: [] }, { id: "evil", enabled: true }],
    offers: [offerRow, { ...offerRow, id: "x", destination: "http://insecure.example" }, { ...offerRow, id: "y", category: "Banking" }, "junk"],
  });
  expect(feed.enabled).toBe(true);
  expect(feed.offers.map(o => o.id)).toEqual([offerRow.id]);
  expect(feed.placements.home.format).toBe("wide");
});
it("treats a disabled, missing or malformed feed as no sponsored content", () => {
  expect(parsePartnerFeed({ enabled: false, offers: [offerRow] })).toEqual(EMPTY_FEED);
  expect(parsePartnerFeed(null)).toEqual(EMPTY_FEED);
  expect(parsePartnerFeed("nope")).toEqual(EMPTY_FEED);
});
it("labels real offers Sponsored and only fictional ones as examples", () => {
  const [real] = parsePartnerFeed({ enabled: true, offers: [offerRow] }).offers;
  expect(sponsorLabel(real)).toBe("Sponsored");
  expect(sponsorLabel({ ...real, id: "example-x" })).toBe("Sponsored · example");
});

it("the Transactions placement shows every eligible offer and honours the owner's switch", () => {
  const state = active();
  expect(placementOffers(state, "transactions", today)).toHaveLength(3);
  const off = { ...state, placements: { ...initialPlacements(), transactions: { ...initialPlacements().transactions, enabled: false } } };
  expect(placementOffers(off, "transactions", today)).toEqual([]);
});
