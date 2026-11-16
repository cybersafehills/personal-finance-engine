"use client";

import { usePrivacy } from "../PrivacyProvider";

const TONE = {
  positive: "text-money-positive",
  negative: "text-money-negative",
  neutral: "text-text-primary",
  muted: "text-text-muted",
} as const;

/**
 * An already-formatted amount ("12,345 RWF") that honours privacy mode the
 * same way the dashboard does: while masked the value is not placed in the
 * DOM or any attribute. The sign is part of `text` - colour only reinforces it.
 */
export function InsightAmount({
  text,
  tone = "neutral",
  className = "",
}: {
  text: string;
  tone?: keyof typeof TONE;
  className?: string;
}) {
  const { isDashboardMasked } = usePrivacy();
  if (isDashboardMasked) {
    return (
      <span
        className={`tabular-nums text-text-muted ${className}`}
        aria-label="Amount hidden"
      >
        ••••••
      </span>
    );
  }
  return (
    <span className={`tabular-nums ${TONE[tone]} ${className}`}>{text}</span>
  );
}
