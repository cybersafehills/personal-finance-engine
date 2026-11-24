import { router } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { fetchSaveOnPlan, nextSaveOnPart, stopSaveOn } from "@/api/mobile-api";
import { Button, Card, Text } from "@/components/ds";
import { useQuery } from "@/hooks/useQuery";
import { space } from "@/theme/tokens";

import { rwf } from "./format";
import { SAVE_ON } from "./messages";

/**
 * The parts of a Save On plan, shown on the payment screen of any one part. Every part
 * is an ordinary payment the person sends and confirms themselves; the next part opens
 * only once the previous one is settled (the server enforces it, this only reflects it).
 * `refreshKey` changes when the payment's own state does, so the panel re-reads the plan.
 */
export function SaveOnPlanPanel({
  planId,
  currentIntentId,
  refreshKey,
}: {
  planId: string;
  currentIntentId: string;
  refreshKey: string;
}) {
  const load = useCallback(() => fetchSaveOnPlan(planId), [planId, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data, refresh } = useQuery(load);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // A plan that can't be read is simply not shown: the payment itself still works.
  if (!data || !data.ok) return null;
  const { plan } = data;
  const t = SAVE_ON.plan;
  const total = plan.plannedPartsMinor.length;
  const next = plan.next;

  async function onNext() {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const res = await nextSaveOnPart(planId);
    setBusy(false);
    if (!res.ok) {
      setProblem(res.message);
      refresh();
      return;
    }
    router.replace({ pathname: "/pay/[id]", params: { id: res.intent.id } });
  }

  async function onStop() {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const res = await stopSaveOn(planId);
    setBusy(false);
    if (!res.ok) setProblem(res.message);
    refresh();
  }

  return (
    <Card style={{ gap: space[2] }} accessibilityLabel={t.title(total)}>
      <Text variant="caption" color="accent">
        {SAVE_ON.name.toUpperCase()}
      </Text>
      <Text variant="bodyStrong">{t.title(total)}</Text>
      <Text variant="label" color="textSecondary">
        {plan.kind === "capacity" ? t.subtitleCapacity : t.subtitleSaving}
      </Text>

      <View style={{ gap: space[1] }}>
        {plan.plannedPartsMinor.map((amount, i) => {
          const prepared = plan.parts.find((p) => p.index === i + 1);
          const here = prepared?.intentId === currentIntentId;
          return (
            <Text key={i} variant={here ? "bodyStrong" : "label"} tabular>
              {SAVE_ON.partRow(i + 1, rwf(amount))}
              {here ? `  ·  ${t.thisPayment}` : ""}
            </Text>
          );
        })}
      </View>

      {plan.remainingMinor !== "0" && next.status !== "stopped" ? (
        <Text variant="caption" color="textMuted">
          {t.remaining(rwf(plan.remainingMinor))}
        </Text>
      ) : null}
      {next.status === "waiting" ? (
        <Text variant="label" color="textSecondary">
          {t.waiting(next.index - 1)}
        </Text>
      ) : null}
      {next.status === "blocked" ? (
        <Text variant="label" color="attention">
          {t.blocked}
        </Text>
      ) : null}
      {next.status === "complete" ? (
        <Text variant="label" color="textSecondary">
          {t.complete}
        </Text>
      ) : null}
      {next.status === "stopped" ? (
        <Text variant="label" color="textSecondary">
          {t.stopped}
        </Text>
      ) : null}

      {next.status === "ready" ? (
        <Button label={t.prepareNext(next.index)} fullWidth loading={busy} onPress={onNext} />
      ) : null}
      {next.status !== "stopped" && next.status !== "complete" ? (
        <Button label={t.stop} variant="secondary" fullWidth disabled={busy} onPress={onStop} />
      ) : null}
      {problem ? (
        <Text variant="caption" color="attention" accessibilityRole="alert">
          {problem}
        </Text>
      ) : null}
      <Text variant="caption" color="textMuted">
        {t.feesNote}
      </Text>
    </Card>
  );
}
