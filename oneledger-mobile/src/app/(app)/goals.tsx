import { router } from "expo-router";
import { useCallback, type ReactNode } from "react";
import { Platform, View } from "react-native";

import { Badge, Button, Card, EmptyState, ProgressBar, Screen, ScreenHeader, Text } from "@/components/ds";
import {
  goalTypeLabel,
  isReached,
  paceNotes,
  percentComplete,
  sortGoals,
} from "@/features/goals/display";
import { useSession } from "@/features/auth/SessionProvider";
import { ArchiveGoalControl, NewGoalControl } from "@/features/goals/GoalManagement";
import { canManageGoals } from "@/features/goals/management";
import { GoalContributions } from "@/features/goals/GoalContributions";
import { useActiveSpace } from "@/features/spaces/ActiveSpaceProvider";
import { getGoals } from "@/features/goals/queries";
import type { Goal } from "@/features/goals/types";
import { useQuery } from "@/hooks/useQuery";
import { formatAmount } from "../../../../shared/financial";
import { space } from "@/theme/tokens";

// Your savings goals and how each is going. Progress and the pace lines come
// from the database's goal_progress().
export default function Goals() {
  const { active } = useActiveSpace();
  const { session } = useSession();
  const canContribute = active?.role === "owner" || active?.role === "admin" || active?.role === "member";
  const load = useCallback(async () => sortGoals(await getGoals()), []);
  const { data, loading, error, refresh } = useQuery(load);
  const workspaceId = active?.id;
  const loadPermission = useCallback(() => workspaceId ? canManageGoals(workspaceId) : Promise.resolve(false), [workspaceId]);
  const { data: canManage } = useQuery(loadPermission, "goal-management");
  const scope = workspaceId && session ? { workspaceId, userId: session.user.id } : null;

  return (
    <Screen>
      <Button label="Back" variant="ghost" onPress={() => router.back()} />
      <ScreenHeader title="Goals" subtitle="Emergency funds, investing, purchases and debt" />
      {scope && canManage ? (
        <NewGoalControl key={`${scope.userId}:${scope.workspaceId}`} scope={scope} onSaved={refresh} />
      ) : null}

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
          description={canManage ? "Create a goal to start tracking your progress." : undefined}
        />
      ) : data ? (
        data.map((goal) => (
          <GoalCard key={`${active?.id}:${goal.id}`} goal={goal}>
            {scope ? (
              <>
                <GoalContributions goal={goal} {...scope} canManage={canManage === true}
                  canContribute={Platform.OS !== "web" && canContribute && goal.status === "active"} onSaved={refresh} />
                {canManage && goal.status !== "archived" ? <ArchiveGoalControl scope={scope} goalId={goal.id} onSaved={refresh} /> : null}
              </>
            ) : null}
          </GoalCard>
        ))
      ) : null}
    </Screen>
  );
}

function GoalCard({ goal, children }: { goal: Goal; children?: ReactNode }) {
  const money = (minor: number) => Number.isSafeInteger(minor) ? formatAmount(minor, goal.currency, false) : "Amount unavailable";
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
      {children}
    </Card>
  );
}
