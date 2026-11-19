import { Children } from "react";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { privateText } from "@/features/privacy/mask";
import { Text as RNText, type TextProps as RNTextProps } from "react-native";

import { colors, type ColorToken } from "@/theme/tokens";
import { textVariants, type TextVariant } from "@/theme/typography";

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
  children,
  accessibilityLabel,
  ...rest
}: TextProps) {
  const { fullPrivacy } = usePrivacy();
  return (
    <RNText
      {...rest}
      accessibilityLabel={privateText(accessibilityLabel, fullPrivacy)}
      style={[
        textVariants[variant],
        { color: colors[color] },
        tabular && { fontVariant: ["tabular-nums"] },
        style,
      ]}
    >
      {Children.map(children, (child) => typeof child === "string" ? privateText(child, fullPrivacy) : child)}
    </RNText>
  );
}
