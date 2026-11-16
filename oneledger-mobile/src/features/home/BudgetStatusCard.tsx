import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { Badge, ProgressBar, Text } from "@/components/ds";
import { totals, worstStatus } from "@/features/budgets/display";
import type { Budget } from "@/features/budgets/types";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { formatMoney, formatRwf } from "@/lib/money";
import { colors, radii, space } from "@/theme/tokens";

import { daysLeftLabel, daysRemaining, homeStatus, usedFraction } from "./display";

const money = (minor: number, currency: Budget["currency"]) =>
  currency === "RWF" ? formatRwf(minor) : formatMoney(BigInt(Math.round(minor)), currency);

/**
 * The active budget at a glance (web/components/BudgetStatusCard.tsx): a
 * status badge, how much is used, what is left and how long the period has to
 * run. Amounts respect privacy mode; the badge and day count never do. It
 * never turns red: spending is restrained text, not an alarm.
 */
export function BudgetStatusCard({ budget, nowIso }: { budget: Budget; nowIso: string }) {
  const { amountsHidden } = usePrivacy();
  const sum = totals(budget.allocations);
  const status = homeStatus(worstStatus(budget.allocations));
  const fraction = usedFraction(sum.percentUsed);
  const days = daysLeftLabel(daysRemaining(budget.periodEnd, nowIso));
  const over = sum.remainingMinor < 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Budget status, ${status.label}. Open budget`}
      onPress={() => router.push("/budgets")}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.row}>
        <Text variant="caption" color="textMuted" style={styles.kicker}>
          BUDGET STATUS
        </Text>
        <Badge variant={status.variant}>{status.label}</Badge>
      </View>

      {fraction !== null ? (
        <>
          <ProgressBar fraction={fraction} label="Budget used" />
          <Text variant="caption" color="textMuted" tabular>
            {amountsHidden
              ? "••••• of ••••• used"
              : `${money(sum.actualMinor, budget.currency)} of ${money(sum.targetMinor, budget.currency)} used`}
          </Text>
        </>
      ) : null}

      <View style={[styles.row, styles.bottom]}>
        <View>
          <Text variant="caption" color="textMuted">
            {over ? "Over by" : "Remaining"}
          </Text>
          <Text
            variant="title"
            color={amountsHidden ? "textMuted" : "textPrimary"}
            tabular
            accessibilityLabel={amountsHidden ? "Amount hidden" : undefined}
          >
            {amountsHidden ? "••••••" : money(Math.abs(sum.remainingMinor), budget.currency)}
          </Text>
        </View>
        {days ? (
          <Text variant="caption" color="textMuted">
            {days}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.borderSubtle,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: radii.card,
    padding: space[4],
    gap: space[3],
  },
  pressed: { backgroundColor: colors.background },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2] },
  bottom: { alignItems: "flex-end" },
  kicker: { letterSpacing: 0.6 },
});
