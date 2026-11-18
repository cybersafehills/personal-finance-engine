import { Text as RNText, type TextProps as RNTextProps } from "react-native";

import { colors, type ColorToken } from "@/theme/tokens";
import { MAX_FONT_SCALE, textVariants, type TextVariant } from "@/theme/typography";

export type TextProps = RNTextProps & {
  variant?: TextVariant;
  color?: ColorToken;
  /** Fixed-width digits so amounts line up in lists. */
  tabular?: boolean;
};

/** The only text primitive. Always goes through a variant + colour token. */
export function Text({
  variant = "body",
  color = "textPrimary",
  tabular = false,
  style,
  ...rest
}: TextProps) {
  return (
    <RNText
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      {...rest}
      style={[
        textVariants[variant],
        { color: colors[color] },
        tabular && { fontVariant: ["tabular-nums"] },
        style,
      ]}
    />
  );
}
