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
  | "display"
  | "title"
  | "heading"
  | "body"
  | "bodyStrong"
  | "label"
  | "caption";

// The scale follows the web app, whose body text is 14px (Tailwind `text-sm`,
// used ~1,400 times against ~90 for 16px) and whose captions are 12px. Phones are
// held closer than monitors, so 14 reads comfortably; bigger text made every
// screen look oversized next to the web. Hierarchy comes from weight and colour,
// not from size.
export const textVariants: Record<TextVariant, TextStyle> = {
  display: { fontFamily: fonts.semibold, fontSize: 30, lineHeight: 34 },
  title: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28 },
  heading: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  bodyStrong: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  label: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
};

/**
 * System "Larger Text" scales every Text. A little is right (it is an
 * accessibility setting); unbounded, it blew the layout up on phones with the
 * setting raised. Capped so rows and controls stay inside their frames while text
 * still grows 25%.
 */
export const MAX_FONT_SCALE = 1.25;
