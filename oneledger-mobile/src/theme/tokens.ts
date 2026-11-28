// Design tokens. Most of the light palette mirrors web/app/globals.css `:root`.
// The accent family (deep green) and the larger type, button and card sizes are
// mobile-only for now: the web still uses its blue accent. Never hardcode a hex value in a
// component (docs/design-system.md). Colours live in ./colors (light + dark), and
// components read them through the theme (`useTheme`, `makeStyles`), never directly.
//
// Financial semantics are restrained: outgoing money is NOT red, it is
// primary-coloured text with a "−" sign.

export type { ColorToken, Palette } from "./colors";

export const radii = {
  card: 20,
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

/** The `Button` primitive: a tall pill by default. Other chrome keeps CONTROL_HEIGHT. */
export const BUTTON_HEIGHT = { md: 52, sm: 36 } as const;

/** Extra touchable margin that brings a control of `visualHeight` up to the 44pt floor. */
export function hitSlopFor(visualHeight: number) {
  const pad = Math.max(0, Math.ceil((MIN_TOUCH_TARGET - visualHeight) / 2));
  return { top: pad, bottom: pad, left: pad, right: pad };
}

/** User-selected avatar backgrounds keep a fixed accessible ink pairing in both themes. */
export const AVATAR_COLORS = { indigo: { bg: '#E9EEFF', ink: '#334D9F' }, mint: { bg: '#DFF5EC', ink: '#176952' }, peach: { bg: '#FFF0DE', ink: '#9B520B' }, rose: { bg: '#FCE7EF', ink: '#993658' }, lilac: { bg: '#EFE7FF', ink: '#6540A3' } } as const;
export const NAVIGATION_DIVIDER = "#000000";
