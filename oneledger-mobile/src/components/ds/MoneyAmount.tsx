import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { formatSignedRwf } from "@/lib/money";
import type { ColorToken } from "@/theme/tokens";
import type { TextVariant } from "@/theme/typography";

import { Text } from "./Text";

const SIZES = {
  sm: "label",
  md: "bodyStrong",
  lg: "title",
  xl: "display",
} as const satisfies Record<string, TextVariant>;

/**
 * A signed RWF amount. Direction is carried by the +/− sign (always
 * present) and reinforced with colour: green for money in, ordinary primary
 * text for money out. Never red.
 *
 * While masked (privacy mode, or `masked`), the real value is not rendered
 * or exposed to assistive tech at all.
 */
export function MoneyAmount({
  amountRwf,
  size = "md",
  masked,
}: {
  amountRwf: number;
  size?: keyof typeof SIZES;
  masked?: boolean;
}) {
  const { amountsHidden } = usePrivacy();
  const hidden = masked ?? amountsHidden;

  if (hidden) {
    return (
      <Text
        variant={SIZES[size]}
        color="textMuted"
        accessibilityLabel="Amount hidden"
      >
        ••••••
      </Text>
    );
  }

  const color: ColorToken =
    amountRwf > 0
      ? "moneyPositive"
      : amountRwf < 0
        ? "moneyNegative"
        : "textMuted";

  return (
    <Text variant={SIZES[size]} color={color} tabular>
      {formatSignedRwf(amountRwf)}
    </Text>
  );
}
