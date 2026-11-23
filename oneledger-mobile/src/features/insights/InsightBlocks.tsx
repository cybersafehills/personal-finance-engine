import { View } from "react-native";

import { Card, Text } from "@/components/ds";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { space } from "@/theme/tokens";

import type { Intelligence } from "./intelligence";
import {
  baselineSentence,
  recurringHeading,
  recurringLine,
  unusualHeading,
  unusualLine,
} from "./intelligence-display";
import { WhyThisInsight } from "./WhyThisInsight";

// The three fact blocks the web shows on Home and on /inbox/forecast. Each has
// its own "Why am I seeing this?". `bare` drops the card chrome so Home can
// place them inside its own Insights card.

const UNUSUAL_BASIS = [
  "A single payment far above what this counterparty has cost you before.",
  "Only counterparties with a stable payment history are checked.",
  "Flagged when it is at least 3x the usual amount and the gap is meaningful.",
];
const RECURRING_BASIS = [
  "Payments to the same counterparty, in the same category, at a similar amount.",
  "Seen in at least 2 of your last 4 complete months.",
  "Amounts within 15% of each other count as the same payment.",
];

function Block({ bare, label, children }: { bare: boolean; label: string; children: React.ReactNode }) {
  const body = <View style={{ gap: space[1] }} accessibilityLabel={label}>{children}</View>;
  return bare ? body : <Card>{body}</Card>;
}

export function BaselineBlock({ data, bare = false }: { data: Intelligence; bare?: boolean }) {
  const { amountsHidden } = usePrivacy();
  const b = data.baseline;
  if (!b) return null;
  return (
    <Block bare={bare} label="Spending this month">
      <Text variant="bodyStrong">Spending this month</Text>
      <Text>{baselineSentence(b, amountsHidden)}</Text>
      <WhyThisInsight basis={b.basis} period={`This month vs your last ${b.monthsCompared} complete months`}
        method="Same first-N-days spend, this month vs the average of prior months." />
    </Block>
  );
}

export function UnusualPaymentsBlock({ data, bare = false, limit }: { data: Intelligence; bare?: boolean; limit?: number }) {
  const { amountsHidden } = usePrivacy();
  if (data.anomalies.length === 0) return null;
  const shown = data.anomalies.slice(0, limit ?? data.anomalies.length);
  return (
    <Block bare={bare} label="Unusual payments">
      <Text variant="bodyStrong">{unusualHeading(data.anomaliesTotal)}</Text>
      {shown.map((a) => <Text key={`${a.counterparty}:${a.occurredAt}`} variant="caption" color="textMuted">{unusualLine(a, amountsHidden)}</Text>)}
      <WhyThisInsight basis={UNUSUAL_BASIS} period="Last 30 days"
        method="Compared against the median of that counterparty's prior payments." />
    </Block>
  );
}

export function RecurringBlock({ data, bare = false, limit }: { data: Intelligence; bare?: boolean; limit?: number }) {
  const { amountsHidden } = usePrivacy();
  if (data.recurring.length === 0) return null;
  const shown = data.recurring.slice(0, limit ?? data.recurring.length);
  return (
    <Block bare={bare} label="Recurring payments">
      <Text variant="bodyStrong">{recurringHeading(data.recurringTotal)}</Text>
      {shown.map((p) => <Text key={`${p.counterparty}:${p.category ?? ""}`} variant="caption" color="textMuted">{recurringLine(p, amountsHidden)}</Text>)}
      {data.recurringTotal > shown.length ? <Text variant="caption" color="textMuted">{`and ${data.recurringTotal - shown.length} more`}</Text> : null}
      <WhyThisInsight basis={RECURRING_BASIS} period="Last 4 complete months"
        method="Grouped by counterparty + category; median amount and day; must recur across months." />
    </Block>
  );
}
