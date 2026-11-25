import { formatAmount, isCurrency } from "../../../../web/shared/financial";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { formatRwf, formatSignedRwf } from "@/lib/money";
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
  currency,
  size = "md",
  masked,
  unsigned = false,
}: {
  amountRwf: number;
  currency?: string;
  size?: keyof typeof SIZES;
  masked?: boolean;
  /** Show the size of the amount with no direction: pending, failed or neutral rows. */
  unsigned?: boolean;
}) {
  const { amountsHidden, fullPrivacy } = usePrivacy();
  const hidden = fullPrivacy || (masked ?? amountsHidden);

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

  if (!Number.isSafeInteger(amountRwf) || (currency && !isCurrency(currency))) return <Text>Amount unavailable</Text>;

  const color: ColorToken = unsigned
    ? "textMuted"
    : amountRwf > 0
      ? "moneyPositive"
      : amountRwf < 0
        ? "moneyNegative"
        : "textMuted";

  return (
    <Text variant={SIZES[size]} color={color} tabular>
      {currency && currency !== "RWF"
        ? formatAmount(unsigned ? Math.abs(amountRwf) : amountRwf, currency, !unsigned)
        : unsigned
          ? formatRwf(amountRwf)
          : formatSignedRwf(amountRwf)}
    </Text>
  );
}
