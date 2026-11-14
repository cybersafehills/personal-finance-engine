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

export const textVariants: Record<TextVariant, TextStyle> = {
  display: { fontFamily: fonts.semibold, fontSize: 36, lineHeight: 40 },
  title: { fontFamily: fonts.semibold, fontSize: 24, lineHeight: 30 },
  heading: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22 },
  bodyStrong: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 22 },
  label: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
};
