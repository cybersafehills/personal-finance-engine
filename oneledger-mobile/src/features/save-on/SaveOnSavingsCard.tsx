import { router } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";

import { fetchSaveOnSavings } from "@/api/mobile-api";
import { Button, Card, Chip, Text } from "@/components/ds";
import { getPayConfigCache } from "@/features/pay/config-cache";
import { useQuery } from "@/hooks/useQuery";
import { formatDateTime } from "@/lib/kigali-time";
import { space } from "@/theme/tokens";

import { rwf } from "./format";
import { SAVE_ON } from "./messages";
import {
  DEFAULT_SAVINGS_PERIOD,
  hasSavingsActivity,
  periodOf,
  SAVINGS_PERIODS,
  savedPercent,
  type SaveOnSavings,
  type SavingsPeriodKey,
} from "./savings";

const S = SAVE_ON.savings;

/**
 * What Save On has saved in transfer fees, as its own section: on the Save On screen,
 * Insights and Reports (full) and Home (compact: one tile, only once there is something to
 * say). Hidden unless the server says Save On is on, and hidden if the savings can't be read:
 * a section that can't be trusted is never shown as a made-up zero.
 */
export function SaveOnSavingsCard({ compact = false }: { compact?: boolean }) {
  // Checked before anything loads, so a screen without Save On never even asks.
  if (getPayConfigCache()?.paySplits !== true) return null;
  return <Loaded compact={compact} />;
}

function Loaded({ compact }: { compact: boolean }) {
  const load = useCallback(() => fetchSaveOnSavings(), []);
  const { data } = useQuery(load);
  if (!data || !data.ok) return null;
  return compact ? <Compact savings={data.savings} /> : <Full savings={data.savings} />;
}

function Compact({ savings }: { savings: SaveOnSavings }) {
  if (!hasSavingsActivity(savings)) return null;
  return (
    <Card style={{ gap: space[1] }} accessibilityLabel={S.title}>
      <Text variant="caption" color="accent">
        {SAVE_ON.name.toUpperCase()}
      </Text>
      <Text variant="label" color="textSecondary">
        {S.title}
      </Text>
      <Text variant="title" tabular>
        {rwf(periodOf(savings, "30d").savedMinor)}
      </Text>
      <Text variant="caption" color="textMuted">
        Last month
      </Text>
      <Button label={S.seeAll} variant="ghost" onPress={() => router.push("/save-on")} />
    </Card>
  );
}

function Full({ savings }: { savings: SaveOnSavings }) {
  const [key, setKey] = useState<SavingsPeriodKey>(DEFAULT_SAVINGS_PERIOD);
  const p = periodOf(savings, key);
  const label = SAVINGS_PERIODS.find((x) => x.key === key)?.label ?? "";
  const active = hasSavingsActivity(savings);
  return (
    <Card style={{ gap: space[2] }} accessibilityLabel={S.title}>
      <Text variant="caption" color="accent">
        {SAVE_ON.name.toUpperCase()}
      </Text>
      <Text variant="bodyStrong">{S.title}</Text>
      <Text variant="label" color="textSecondary">
        {S.intro}
      </Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[2] }}>
        {SAVINGS_PERIODS.map((x) => (
          <Chip key={x.key} label={x.label} selected={x.key === key} onPress={() => setKey(x.key)} />
        ))}
      </ScrollView>

      <View style={{ gap: space[1] }} accessibilityLiveRegion="polite">
        {p.plans === 0 ? (
          <>
            <Text variant="title">{S.none}</Text>
            <Text variant="label" color="textSecondary">
              {label}
            </Text>
          </>
        ) : (
          <>
            <Text variant="title" tabular>
              {rwf(p.savedMinor)}
            </Text>
            <Text variant="label" color="textSecondary">
              {`${label} · ${S.plans(p.plans, p.transfers)}`}
            </Text>
            <Text variant="label" color="textSecondary">
              {S.asOne(rwf(p.wouldHavePaidMinor))}
            </Text>
            <Text variant="label" color="textSecondary">
              {S.asParts(rwf(p.paidMinor))}
            </Text>
            <Text variant="bodyStrong">{S.saved(rwf(p.savedMinor), savedPercent(p))}</Text>
          </>
        )}
      </View>

      {!active ? (
        <Text variant="label" color="textSecondary">
          {S.emptyBody}
        </Text>
      ) : null}
      {savings.inProgress.plans > 0 ? (
        <Text variant="label" color="textSecondary">
          {S.inProgress(savings.inProgress.plans, rwf(savings.inProgress.expectedSavingMinor))}
        </Text>
      ) : null}
      {savings.recent.length > 0 ? (
        <View style={{ gap: space[1] }}>
          <Text variant="label" color="textMuted">
            {S.recentTitle}
          </Text>
          {savings.recent.map((r) => (
            <Text key={r.planId} variant="caption" color="textSecondary">
              {S.recentRow(formatDateTime(r.completedAt), rwf(r.totalMinor), r.transfers, rwf(r.savedMinor))}
            </Text>
          ))}
        </View>
      ) : null}
      <Text variant="caption" color="textMuted">
        {S.estimate}
      </Text>
    </Card>
  );
}
