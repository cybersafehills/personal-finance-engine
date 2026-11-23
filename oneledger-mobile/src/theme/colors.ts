// The two palettes. Every token exists in both (the `Palette` type makes a missing
// or extra key a compile error), and tests check contrast for the pairs that carry
// text. Naming is by ROLE, not by hue, so a token can change colour per theme:
//
//   textPrimary / Secondary / Muted   text and icons on `surface` or `background`
//   accent                            interactive text, icons, links and small fills
//   accentSolid / *Solid              a strong fill that carries white content (`onSolid`)
//   moneyPositive / attention / danger  text-and-icon colours for meaning on a surface
//   *Bg                               a quiet tint behind that meaning

// Creative surfaces intentionally retain their art direction in both themes.
const creativeColors = {
  iconMoneyStart: "#075c54",
  iconMoneyEnd: "#118568",
  iconLearningStart: "#99400c",
  iconLearningEnd: "#c87717",
  iconCommunicationStart: "#a52357",
  iconCommunicationEnd: "#cf4770",
  iconNeutralStart: "#303640",
  iconNeutralEnd: "#596575",
  creativePearl: "#e4ddff",
  creativeLilac: "#9b8ee2",
  creativeEdgeLight: "#a99ae8",
  creativeEdgeDark: "#51418a",
  creativeGoldLight: "#fff0b6",
  creativeGold: "#efc272",
  creativeGoldDark: "#b87b33",
  creativeShadow: "#000000",
  creativeScreen: "#443875",
  creativeSpeaker: "#c8bdec",
  creativeSignal: "#e9e3ff",
  creativeHandle: "#a69bd2",
  creativePaper: "#f5f0ff",
  creativeSpine: "#8372bd",
  creativePrint: "#7965af",
  creativeCoinEdge: "#ba8844",
  creativeCoinRim: "#fff0bc",
  creativeBankInk: "#6a579c",
  partnerConnectivityStart: "#35256c",
  partnerConnectivityEnd: "#14142e",
  partnerLearningStart: "#07564f",
  partnerLearningEnd: "#102c32",
  partnerBankingStart: "#652641",
  partnerBankingEnd: "#251627",
  partnerOnMuted: "#f0edf9",
} as const;

export const lightColors = {
  ...creativeColors,
  background: "#f6f6f7",
  guideScrim: "#151a38",
  surface: "#ffffff",
  borderSubtle: "#e8e8ea",
  borderStrong: "#d4d4d8",

  textPrimary: "#18181b",
  textSecondary: "#34343b",
  textMuted: "#484850",

  moneyPositive: "#067a4d",
  moneyPositiveBg: "#e9f7f0",
  moneyPositiveSolid: "#067a4d",
  moneyPositiveSolidPressed: "#045b39",
  moneyNegative: "#18181b",
  attention: "#92620a",
  attentionBg: "#fdf3d9",
  needsMapBg: "#fdf1f0",
  needsMapBorder: "#ecd0cd",
  /** A solid red badge/disc that carries white content. */
  notificationBadge: "#c0392b",
  /** Red text and icons on a surface (destructive actions). */
  danger: "#c0392b",
  // The orange "Request payment" accent in the Pay sheet (the green twin is moneyPositive).
  moneyRequest: "#c2610c",
  moneyRequestBg: "#fdf0e2",
  moneyRequestSolid: "#c2610c",
  // eKash brand colours (from its official logo): the teal "e" and the navy wordmark.
  ekash: "#1a95a1",
  ekashSolid: "#1a95a1",
  ekashNavy: "#0e3d63",
  ekashBg: "#e5f4f5",
  lifetimeBadgeBg: "#f5c518",
  lifetimeBadgeText: "#1a1a1a",

  /** Interactive text, icons, links, selected borders. */
  accent: "#33509e",
  accentBg: "#eaf0ff",
  navSelectedBg: "#eeebff",
  navSelectedInk: "#54449c",
  homeGradientStart: "#312b64",
  homeGradientEnd: "#7b6bf0",
  chartIncome: "#6956ee",
  chartExpense: "#149d99",
  chartFood: "#f7ad66",
  chartOther: "#e1e6f0",
  /** A brand-blue fill (primary button, balance card, selected chip) that carries `onSolid`. */
  accentSolid: "#33509e",
  accentSolidPressed: "#263c76",
  /** White content on any `*Solid` fill, the accent fill or the red badge, in every theme. */
  onSolid: "#ffffff",

  brandNavy: "#07143a",
  brandBlue: "#0050f4",
} as const;

export type ColorToken = keyof typeof lightColors;
export type Palette = { readonly [K in ColorToken]: string };

export const darkColors: Palette = {
  ...creativeColors,
  background: "#0d0e11",
  guideScrim: "#000000",
  surface: "#16181d",
  borderSubtle: "#26282f",
  borderStrong: "#3b3e48",

  textPrimary: "#f3f4f6",
  textSecondary: "#d1d3db",
  textMuted: "#b1b4bf",

  moneyPositive: "#3dd68c",
  moneyPositiveBg: "#0f2c20",
  moneyPositiveSolid: "#0f7a50",
  moneyPositiveSolidPressed: "#0b6140",
  moneyNegative: "#f3f4f6",
  attention: "#e8b64c",
  attentionBg: "#2b2210",
  needsMapBg: "#2a1715",
  needsMapBorder: "#4d2b27",
  notificationBadge: "#d4402f",
  danger: "#f2796b",
  moneyRequest: "#f39a4a",
  moneyRequestBg: "#2e1f10",
  moneyRequestSolid: "#b85a0c",
  ekash: "#3bbac6",
  ekashSolid: "#12808b",
  ekashNavy: "#a8e0ea",
  ekashBg: "#0f2c30",
  lifetimeBadgeBg: "#f5c518",
  lifetimeBadgeText: "#1a1a1a",

  accent: "#8fa5f2",
  accentBg: "#202b4a",
  navSelectedBg: "#eeebff",
  navSelectedInk: "#c4baff",
  homeGradientStart: "#312b64",
  homeGradientEnd: "#7b6bf0",
  chartIncome: "#a395ff",
  chartExpense: "#47d0c4",
  chartFood: "#f7ad66",
  chartOther: "#586277",
  accentSolid: "#3d5fc4",
  accentSolidPressed: "#334fa8",
  onSolid: "#ffffff",

  brandNavy: "#07143a",
  brandBlue: "#0050f4",
};

export const lightPalette: Palette = lightColors;
