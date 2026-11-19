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
  // Mobile-only for now: the orange "Request payment" accent in the Pay sheet (the green twin is moneyPositive).
  moneyRequest: "#c2610c",
  moneyRequestBg: "#fdf0e2",
  // eKash brand colours (from its official logo): the teal "e" and the navy wordmark. Used for the eKash shortcut in the Pay sheet.
  ekash: "#1a95a1",
  ekashNavy: "#0e3d63",
  ekashBg: "#e5f4f5",
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

/**
 * Visual heights. A control may look smaller than the 44pt touch floor as long as
 * its hit area is not: `hitSlopFor` adds the difference around it.
 */
export const CONTROL_HEIGHT = { md: 40, sm: 32 } as const;

/** Extra touchable margin that brings a control of `visualHeight` up to the 44pt floor. */
export function hitSlopFor(visualHeight: number) {
  const pad = Math.max(0, Math.ceil((MIN_TOUCH_TARGET - visualHeight) / 2));
  return { top: pad, bottom: pad, left: pad, right: pad };
}
