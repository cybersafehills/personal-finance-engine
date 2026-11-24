import { useCallback, useState } from "react";
import { View } from "react-native";

import { fetchSaveOnPrefs, saveSaveOnPrefs } from "@/api/mobile-api";
import { Button, Card, Chip, EmptyState, Screen, ScreenHeader, Text } from "@/components/ds";
import { SAVE_ON } from "@/features/save-on/messages";
import { SaveOnSavingsCard } from "@/features/save-on/SaveOnSavingsCard";
import { rwf } from "@/features/save-on/format";
import type { SaveOnLevels, SaveOnPrefs, SaveOnThreshold } from "@/features/save-on/types";
import { useQuery } from "@/hooks/useQuery";
import { space } from "@/theme/tokens";

const S = SAVE_ON.settings;
const ORDER: SaveOnThreshold[] = ["any", "balanced", "bigger"];

/** The name of a level, and the line under it (its figure is the server's, never typed here). */
function describe(value: SaveOnThreshold, levels: SaveOnLevels): { title: string; hint: string } {
  const l = S.levels[value];
  const title = "tag" in l ? `${l.name} (${l.tag})` : l.name;
  if ("hint" in l) return { title, hint: l.hint };
  const min = levels[value];
  return { title, hint: min ? S.atLeast(rwf(min), value === "bigger") : S.noFigure };
}

// Save On: how it works, and the one choice a person has (suggest cheaper MTN-to-MTN
// splits, off until they turn it on). Over-the-eKash-limit amounts do not depend on it.
export default function SaveOn() {
  const load = useCallback(() => fetchSaveOnPrefs(), []);
  const { data, loading, refresh } = useQuery(load);
  const [local, setLocal] = useState<SaveOnPrefs | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const prefs = local ?? (data?.ok ? data.preferences : null);
  const levels: SaveOnLevels = data?.ok ? data.levels : {};

  async function save(next: SaveOnPrefs) {
    const before = prefs;
    setLocal(next);
    setStatus(null);
    const res = await saveSaveOnPrefs(next);
    if (res.ok) {
      setLocal(res.preferences);
      setStatus(S.saved);
    } else {
      setLocal(before);
      setStatus(res.message);
    }
  }

  return (
    <Screen>
      <ScreenHeader title={S.title} subtitle={S.subtitle} />

      <SaveOnSavingsCard />

      <Card style={{ gap: space[2] }}>
        <Text variant="bodyStrong">{S.howTitle}</Text>
        {S.how.map((step, i) => (
          <Text key={step} variant="label" color="textSecondary">{`${i + 1}. ${step}`}</Text>
        ))}
      </Card>

      <Card style={{ gap: space[2] }}>
        <Text variant="bodyStrong">{S.kindsTitle}</Text>
        {S.kinds.map((k) => (
          <Text key={k} variant="label" color="textSecondary">
            {`• ${k}`}
          </Text>
        ))}
      </Card>

      <Text variant="label" color="textMuted">
        {S.example}
      </Text>

      {!prefs ? (
        loading ? (
          <Text variant="label" color="textMuted">
            Loading…
          </Text>
        ) : (
          <EmptyState
            title={data && !data.ok ? data.message : S.loadFailed}
            action={<Button label="Try again" variant="secondary" onPress={refresh} />}
          />
        )
      ) : (
        <Card style={{ gap: space[3] }}>
          <Text variant="bodyStrong">{S.enable}</Text>
          <View style={{ flexDirection: "row", gap: space[2] }}>
            <Chip label={S.on} selected={prefs.feeSavingEnabled} onPress={() => save({ ...prefs, feeSavingEnabled: true })} />
            <Chip label={S.off} selected={!prefs.feeSavingEnabled} onPress={() => save({ ...prefs, feeSavingEnabled: false })} />
          </View>
          {prefs.feeSavingEnabled ? (
            <View style={{ gap: space[2] }}>
              <Text variant="label" color="textSecondary">
                {S.question}
              </Text>
              {ORDER.map((value) => {
                const c = describe(value, levels);
                return (
                  <View key={value} style={{ gap: space[1] }}>
                    <Chip label={c.title} selected={prefs.threshold === value} onPress={() => save({ ...prefs, threshold: value })} />
                    <Text variant="caption" color="textMuted">
                      {c.hint}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}
          {status ? (
            <Text variant="caption" color="textSecondary" accessibilityLiveRegion="polite">
              {status}
            </Text>
          ) : null}
        </Card>
      )}
    </Screen>
  );
}
