import { router } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";

import { fetchRules, setRuleActive } from "@/api/mobile-api";
import { Badge, Button, Card, EmptyState, Screen, ScreenHeader, Text } from "@/components/ds";
import type { Rule } from "@/features/rules/types";
import { useActiveSpace } from "@/features/spaces/ActiveSpaceProvider";
import { useQuery } from "@/hooks/useQuery";
import { space } from "@/theme/tokens";

// The rules that automatically categorize transactions in this Space, in the
// order they are checked. Each rule's sentence comes from the server (the web's
// own wording). You can pause or resume a rule here; creating, editing,
// reordering and applying to history stay on the web.
export default function CategorizationRules() {
  const { active } = useActiveSpace();
  const load = useCallback(() => fetchRules(), []);
  const { data, loading, refresh } = useQuery(load);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A ref, not state, so a double tap cannot start two writes before a render.
  const inFlight = useRef(false);

  async function toggle(rule: Rule) {
    if (inFlight.current || !active) return;
    inFlight.current = true;
    setBusyId(rule.id);
    setError(null);
    try {
      const result = await setRuleActive(active.id, rule.id, !rule.active);
      if (!result.ok) setError(result.message);
      refresh(); // the server is the truth either way
    } finally {
      inFlight.current = false;
      setBusyId(null);
    }
  }

  return (
    <Screen>
      <Button label="Back" variant="ghost" onPress={() => router.back()} />
      <ScreenHeader title="Rules" subtitle="Automatic categorization, checked top to bottom" />

      {error ? (
        <Card>
          <Text variant="label" color="attention" accessibilityRole="alert">
            {error}
          </Text>
        </Card>
      ) : null}

      {loading && !data ? (
        <Text variant="label" color="textMuted">
          Loading…
        </Text>
      ) : data && !data.ok ? (
        <EmptyState
          title={data.message}
          action={
            data.reason === "unavailable" ? undefined : (
              <Button label="Try again" variant="secondary" onPress={refresh} />
            )
          }
        />
      ) : data && data.rules.length === 0 ? (
        <EmptyState
          variant="setup"
          title="No rules yet"
          description="Create a rule on the web to categorize matching transactions as they come in."
        />
      ) : data ? (
        data.rules.map((rule) => (
          <Card key={rule.id} style={{ gap: space[2] }}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space[2] }}>
              <View style={{ flexShrink: 1, gap: space[1] }}>
                <Text variant="bodyStrong">{rule.title}</Text>
                <Text variant="label" color="textSecondary">
                  {rule.categoryLabel}
                </Text>
              </View>
              {!rule.active ? <Badge variant="attention">Paused</Badge> : null}
            </View>
            <Text variant="caption" color="textMuted">
              {rule.summary}
            </Text>
            <Text variant="caption" color="textMuted">
              {[rule.originLabel, rule.scopeLabel, rule.matchedLabel].filter(Boolean).join(" · ")}
            </Text>
            <Button
              label={rule.active ? "Pause" : "Resume"}
              variant="secondary"
              loading={busyId === rule.id}
              disabled={busyId !== null || !active}
              onPress={() => toggle(rule)}
              accessibilityLabel={`${rule.active ? "Pause" : "Resume"} rule ${rule.title}`}
            />
          </Card>
        ))
      ) : null}
    </Screen>
  );
}
