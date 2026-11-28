import { darkColors, lightColors, type Palette } from "../colors";
import { contrastRatio } from "../contrast";

const light: Palette = lightColors;
const palettes = { light, dark: darkColors } as const;

describe("palettes", () => {
  it("define exactly the same tokens", () => {
    expect(Object.keys(darkColors).sort()).toEqual(Object.keys(lightColors).sort());
  });

  it.each(Object.entries(palettes))("%s: every value is a #rrggbb colour", (_name, palette) => {
    for (const [token, value] of Object.entries(palette)) expect([token, /^#[0-9a-f]{6}$/i.test(value)]).toEqual([token, true]);
  });

  it("dark is genuinely dark: a dark page, and light text on it", () => {
    expect(contrastRatio(darkColors.background, "#000000")).toBeLessThan(contrastRatio(darkColors.background, "#ffffff"));
    expect(contrastRatio(darkColors.textPrimary, darkColors.background)).toBeGreaterThan(12);
    expect(contrastRatio(lightColors.textPrimary, lightColors.background)).toBeGreaterThan(12);
  });
});

describe.each(Object.entries(palettes))("%s palette: contrast", (_name, p) => {
  const TEXT_ON_PAGE = ["textPrimary", "textSecondary", "textMuted", "accent", "moneyPositive", "attention", "danger", "moneyNegative"] as const;
  it.each(TEXT_ON_PAGE)("%s is readable text on the surface and the page (4.5:1)", (token) => {
    expect(contrastRatio(p[token], p.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p[token], p.background)).toBeGreaterThanOrEqual(4.5);
  });

  it("brand tints keep their icons and borders visible (3:1)", () => {
    for (const token of ["moneyRequest", "ekash"] as const) expect(contrastRatio(p[token], p.surface)).toBeGreaterThanOrEqual(3);
  });

  it.each([
    ["moneyPositive", "moneyPositiveBg"],
    ["attention", "attentionBg"],
    ["ekashNavy", "ekashBg"],
    ["textPrimary", "needsMapBg"],
    ["lifetimeBadgeText", "lifetimeBadgeBg"],
  ] as const)("%s is readable on its tint %s (4.5:1)", (text, bg) => {
    expect(contrastRatio(p[text], p[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it("white content is readable on every fill that carries text (4.5:1)", () => {
    for (const fill of ["accentSolid", "accentSolidPressed", "moneyPositiveSolid", "moneyPositiveSolidPressed", "notificationBadge", "brandNavy"] as const) {
      expect([fill, contrastRatio(p.onSolid, p[fill]) >= 4.5]).toEqual([fill, true]);
    }
  });

  it("white icons are visible on the icon-only brand discs (3:1)", () => {
    for (const fill of ["moneyRequestSolid", "ekashSolid"] as const) expect(contrastRatio(p.onSolid, p[fill])).toBeGreaterThanOrEqual(3);
  });

  it("the Request-payment tint text is readable on its tint (3:1 for the brand orange)", () => {
    expect(contrastRatio(p.moneyRequest, p.moneyRequestBg)).toBeGreaterThanOrEqual(3);
  });
});

describe.each(Object.entries(palettes))("%s palette: creative, nav and icon contrast", (_name, p) => {
  it("keeps selected navigation strokes and labels visible", () => {
    for (const endpoint of [p.navIconStart, p.navIconEnd]) expect(contrastRatio(endpoint, p.navSelectedBg)).toBeGreaterThanOrEqual(3);
    // Unselected tabs sit on the dock surface in the primary text colour.
    expect(contrastRatio(p.navSelectedBg, p.surface)).toBeGreaterThanOrEqual(1.1);
    expect(contrastRatio(p.navSelectedInk, p.surface)).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps bare brand-family icons visible on a surface, with white readable on the same gradient", () => {
    // iconInk() uses whichever end of the brand gradient reads best on the surface.
    expect(Math.max(contrastRatio(p.homeGradientStart, p.surface), contrastRatio(p.homeGradientEnd, p.surface))).toBeGreaterThanOrEqual(3);
    for (const endpoint of [p.homeGradientStart, p.homeGradientEnd]) expect(contrastRatio(p.onSolid, endpoint)).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps sponsored copy readable across every creative gradient", () => {
    for (const endpoint of [p.partnerConnectivityStart, p.partnerConnectivityEnd, p.partnerLearningStart, p.partnerLearningEnd, p.partnerBankingStart, p.partnerBankingEnd]) {
      expect(contrastRatio(p.partnerOnMuted, endpoint)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("keeps white menu icons visible across semantic gradients", () => {
    for (const endpoint of [p.iconMoneyStart, p.iconMoneyEnd, p.iconLearningStart, p.iconLearningEnd, p.iconCommunicationStart, p.iconCommunicationEnd, p.iconNeutralStart, p.iconNeutralEnd]) expect(contrastRatio(p.onSolid, endpoint)).toBeGreaterThanOrEqual(3);
  });
});
