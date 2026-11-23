import { formatAmount, type CurrencyFlow } from "../../../../web/shared/financial";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { PrivatePressable as Pressable } from "@/features/privacy/PrivatePressable";

import { Text } from "@/components/ds";
import { formatRwf } from "@/lib/money";
import { hitSlopFor, radii, space } from "@/theme/tokens";

import { lifetimeInfo, type LifetimeFlow } from "./lifetime";
import { makeStyles } from "@/theme/ThemeProvider";

type Kind = "sent" | "received";

/**
 * Two small yellow chips under the Transactions header: the running total sent
 * and received through OneLedger, with no time period (web
 * LifetimeFlowBadge). Each has an "i"; tapping it shows a one-line
 * explanation. A neutral "your history with us" stat, hence its own
 * black-on-yellow pair rather than the attention colours. Never masked: this
 * screen is a deliberate destination.
 */
export function LifetimeChips({
  totals,
  accountCreatedIso,
}: {
  totals: LifetimeFlow & { byCurrency?: CurrencyFlow[] };
  accountCreatedIso: string | null;
}) {
  const styles = useStyles();
  const [open, setOpen] = useState<Kind | null>(null);
  if (totals.count === 0) return null;

  const chip = (kind: Kind, amountRwf: number, currency = "RWF") => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Total ${kind} through OneLedger: ${(currency === "RWF" ? formatRwf(amountRwf) : formatAmount(amountRwf, currency, false))}. More information`}
      accessibilityState={{ expanded: open === kind }}
      onPress={() => setOpen(open === kind ? null : kind)}
      hitSlop={hitSlopFor(22)}
      style={styles.hit}
    >
      <View style={styles.chip}>
        <Text variant="caption" color="lifetimeBadgeText" tabular style={styles.amount}>
          {(currency === "RWF" ? formatRwf(amountRwf) : formatAmount(amountRwf, currency, false))}
        </Text>
        <View style={styles.i}>
          <Text variant="caption" color="lifetimeBadgeText" style={styles.iText}>
            i
          </Text>
        </View>
      </View>
    </Pressable>
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {(totals.byCurrency ?? [{ currency: "RWF", sentMinor: totals.sentRwf, receivedMinor: totals.receivedRwf }]).map((f) => <View key={f.currency} style={styles.row}>{chip("sent", f.sentMinor, f.currency)}{chip("received", f.receivedMinor, f.currency)}</View>)}
      </View>
      {open ? (
        <View style={styles.info} accessibilityLiveRegion="polite">
          <Text variant="caption" color="textSecondary">
            {lifetimeInfo(open, accountCreatedIso)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  wrap: { gap: space[2] },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[1] },
  // Small visual chip; hitSlop brings the tap area up to 44pt.
  hit: { justifyContent: "center" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    paddingHorizontal: space[2],
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.lifetimeBadgeBg,
  },
  amount: { fontWeight: "600" },
  i: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.lifetimeBadgeText,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.6,
  },
  iText: { fontSize: 9, lineHeight: 11, fontWeight: "700" },
  info: {
    padding: space[3],
    borderRadius: radii.control,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: colors.borderSubtle,
  },
}));
