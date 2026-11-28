import type { TextStyle } from "react-native";

// Geist, the same family the web app uses. Each weight is its own font
// file on native, so weight is chosen by family name, never `fontWeight`.
export const fonts = {
  regular: "Geist_400Regular",
  medium: "Geist_500Medium",
  semibold: "Geist_600SemiBold",
  bold: "Geist_700Bold",
} as const;

export type TextVariant =
  | "hero"
  | "display"
  | "title"
  | "heading"
  | "body"
  | "bodyStrong"
  | "label"
  | "caption";

// Body text is 15px and captions 13px: one step up from the web, for a calmer,
// easier-to-read phone layout. `hero` is for the one headline number on a screen.
export const textVariants: Record<TextVariant, TextStyle> = {
  hero: { fontFamily: fonts.semibold, fontSize: 44, lineHeight: 52, letterSpacing: -1.2 },
  display: { fontFamily: fonts.semibold, fontSize: 30, lineHeight: 34 },
  title: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28 },
  heading: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  bodyStrong: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 21 },
  label: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 19 },
  caption: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
};

/**
 * System "Larger Text" scales every Text. A little is right (it is an
 * accessibility setting); unbounded, it blew the layout up on phones with the
 * setting raised. Capped so rows and controls stay inside their frames while text
 * still grows 25%.
 */
export const MAX_FONT_SCALE = 1.25;
