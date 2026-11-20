// The two palettes. Every token exists in both (the `Palette` type makes a missing
// or extra key a compile error), and tests check contrast for the pairs that carry
// text. Naming is by ROLE, not by hue, so a token can change colour per theme:
//
//   textPrimary / Secondary / Muted   text and icons on `surface` or `background`
//   accent                            interactive text, icons, links and small fills
//   accentSolid / *Solid              a strong fill that carries white content (`onSolid`)
//   moneyPositive / attention / danger  text-and-icon colours for meaning on a surface
//   *Bg                               a quiet tint behind that meaning

export const lightColors = {
  background: "#f6f6f7",
  surface: "#ffffff",
  borderSubtle: "#e8e8ea",
  borderStrong: "#d4d4d8",

  textPrimary: "#18181b",
  textSecondary: "#52525b",
  textMuted: "#6b6b73",

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
  background: "#0d0e11",
  surface: "#16181d",
  borderSubtle: "#26282f",
  borderStrong: "#3b3e48",

  textPrimary: "#f3f4f6",
  textSecondary: "#b8bbc4",
  textMuted: "#8f929d",

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
  accentSolid: "#3d5fc4",
  accentSolidPressed: "#334fa8",
  onSolid: "#ffffff",

  brandNavy: "#07143a",
  brandBlue: "#0050f4",
};

export const lightPalette: Palette = lightColors;
