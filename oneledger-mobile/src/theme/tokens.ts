// Design tokens. Mirrors web/app/globals.css `:root` one-to-one; change a
// value there and here in the same PR. Never hardcode a hex value in a
// component (docs/design-system.md).
//
// Financial semantics are restrained: outgoing money is NOT red, it is
// primary-coloured text with a "−" sign.

export const colors = {
  background: "#f6f6f7",
  surface: "#ffffff",
  borderSubtle: "#e8e8ea",
  borderStrong: "#d4d4d8",

  textPrimary: "#18181b",
  textSecondary: "#52525b",
  textMuted: "#6b6b73",

  moneyPositive: "#067a4d",
  moneyPositiveBg: "#e9f7f0",
  moneyNegative: "#18181b",
  attention: "#92620a",
  attentionBg: "#fdf3d9",
  needsMapBg: "#fdf1f0",
  needsMapBorder: "#ecd0cd",
  notificationBadge: "#c0392b",
  lifetimeBadgeBg: "#f5c518",
  lifetimeBadgeText: "#1a1a1a",

  accent: "#33509e",
  accentForeground: "#ffffff",
  accentPressed: "#263c76",
  moneyPositivePressed: "#045b39",

  brandNavy: "#07143a",
  brandBlue: "#0050f4",
} as const;

export type ColorToken = keyof typeof colors;

export const radii = {
  card: 16,
  control: 10,
  pill: 999,
} as const;

/** 4pt spacing scale. */
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
} as const;

/** Accessibility floor for every tappable control (docs/design-system.md). */
export const MIN_TOUCH_TARGET = 44;
