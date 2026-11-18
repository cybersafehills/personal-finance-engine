import * as Linking from "expo-linking";
import { useCallback } from "react";
import { View } from "react-native";

import { Badge, Button, Card, EmptyState, ProgressBar, Screen, ScreenHeader, Text } from "@/components/ds";
import {
  goalTypeLabel,
  isReached,
  paceNotes,
  percentComplete,
  sortGoals } from "@/features/goals/display";
import { getGoals } from "@/features/goals/queries";
import type { Goal } from "@/features/goals/types";
import { useQuery } from "@/hooks/useQuery";
import { config } from "@/lib/config";
import { formatMoney } from "@/lib/money";
import { space } from "@/theme/tokens";

// Your savings goals and how each is going. Progress and the pace lines come
// from the database's goal_progress(); adding goals and contributions stays on
// the web.
export default function Goals() {
  const load = useCallback(async () => sortGoals(await getGoals()), []);
  const { data, loading, error, refresh } = useQuery(load);

  return (
    <Screen>
      <ScreenHeader title="Goals" subtitle="Emergency funds, investing, purchases and debt" />

      {loading && !data ? (
        <Text variant="label" color="textMuted">
          Loading…
        </Text>
      ) : error && !data ? (
        <EmptyState
          title="Couldn't load your goals. Check your connection and try again."
          action={<Button label="Try again" variant="secondary" onPress={refresh} />}
        />
      ) : data && data.length === 0 ? (
        <EmptyState
          variant="setup"
          title="No goals yet"
          description="Create one on the web and its progress shows here."
          action={
            config.apiBaseUrl ? (
              <Button
                label="Create a goal on the web"
                variant="secondary"
                onPress={() => Linking.openURL(`${config.apiBaseUrl}/budgets/goals/new`)}
              />
            ) : undefined
          }
        />
      ) : data ? (
        data.map((goal) => <GoalCard key={goal.id} goal={goal} />)
      ) : null}
    </Screen>
  );
}

function GoalCard({ goal }: { goal: Goal }) {
  const money = (minor: number) => formatMoney(BigInt(Math.round(minor)), goal.currency);
  const percent = percentComplete(goal);
  const reached = goal.status === "completed" || isReached(goal);
  const notes = paceNotes(goal, money);

  return (
    <Card style={{ gap: space[3] }}>
      <View style={{ gap: 2 }}>
        <Text variant="heading">{goal.name}</Text>
        <Text variant="label" color="textMuted">
          {goalTypeLabel(goal.type)}
        </Text>
      </View>
      {reached || goal.status === "archived" ? (
        <View style={{ flexDirection: "row" }}>
          {goal.status === "archived" ? (
            <Badge variant="attention">Archived</Badge>
          ) : (
            <Badge variant="positive">{goal.status === "completed" ? "Completed" : "Target reached"}</Badge>
          )}
        </View>
      ) : null}
      <Text variant="title" tabular>
        {money(goal.currentMinor)}
        <Text variant="label" color="textMuted">{` of ${money(goal.targetMinor)}`}</Text>
      </Text>
      <ProgressBar
        fraction={percent / 100}
        tone={reached ? "positive" : "accent"}
        label={`${goal.name} progress`}
      />
      <Text variant="label" color="textSecondary" tabular>
        {Math.round(percent)}% there
      </Text>
      {notes.map((note) => (
        <Text key={note} variant="caption" color="textMuted">
          {note}
        </Text>
      ))}
    </Card>
  );
}
