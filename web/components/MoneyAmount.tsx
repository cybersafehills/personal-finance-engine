import { formatSignedRwf } from "../lib/format";

const SIZE_CLASSES = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-2xl",
  xl: "text-4xl",
} as const;

/**
 * Renders a signed RWF amount. Direction is conveyed by the +/− sign
 * (always present, never color alone) and reinforced with color: green for
 * money in, ordinary primary-text color for money out - restrained, not an
 * alarming red, per product direction.
 *
 * `masked` renders a fixed-width placeholder instead of the real amount
 * (dashboard privacy mode - see PrivacyProvider's isDashboardMasked) with
 * a generic "Amount hidden" accessible name. The real value is never
 * placed in the DOM, an aria-label, a title, or any other attribute while
 * masked - there is nothing to leak.
 */
export function MoneyAmount({
  amountRwf,
  size = "md",
  masked = false,
}: {
  amountRwf: number;
  size?: keyof typeof SIZE_CLASSES;
  masked?: boolean;
}) {
  if (masked) {
    return (
      <span
        className={`font-semibold tabular-nums text-text-muted ${SIZE_CLASSES[size]}`}
        aria-label="Amount hidden"
      >
        ••••••
      </span>
    );
  }

  const isIncoming = amountRwf > 0;
  const isOutgoing = amountRwf < 0;

  const colorClass = isIncoming
    ? "text-money-positive"
    : isOutgoing
      ? "text-money-negative"
      : "text-text-muted";

  return (
    <span
      className={`font-semibold tabular-nums ${SIZE_CLASSES[size]} ${colorClass}`}
    >
      {formatSignedRwf(amountRwf)}
    </span>
  );
}
