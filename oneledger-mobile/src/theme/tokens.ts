// Design tokens. The light palette mirrors web/app/globals.css `:root` one-to-one;
// change a value there and here in the same PR. Never hardcode a hex value in a
// component (docs/design-system.md). Colours live in ./colors (light + dark), and
// components read them through the theme (`useTheme`, `makeStyles`), never directly.
//
// Financial semantics are restrained: outgoing money is NOT red, it is
// primary-coloured text with a "−" sign.

export type { ColorToken, Palette } from "./colors";

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
