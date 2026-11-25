import Feather from "@expo/vector-icons/Feather";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { PressableScale, Text } from "@/components/ds";
import type { PayConfig } from "@/features/pay/types";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * The Pay sheet's two highlighted shortcuts, one tap closer: same icons, same
 * colours. Each appears only when the server says it is on, so Home never
 * offers a button that does nothing. Neither one sends money.
 * ("Add transaction" is already on the balance card.)
 */
export function QuickActions({ config }: { config: Partial<PayConfig> | null }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const actions: { label: string; fill: string; icon: ReactNode; open(): void }[] = [];
  if (config?.paymentRequests) actions.push({ label: "Request payment", fill: colors.moneyRequestSolid, icon: <MaterialCommunityIcons name="hand-coin" size={18} color={colors.onSolid} />, open: () => router.push("/request-new") });
  if (config?.scanToPay) actions.push({ label: "Scan to pay", fill: colors.moneyPositiveSolid, icon: <Feather name="maximize" size={16} color={colors.onSolid} />, open: () => router.push("/scan") });
  if (!actions.length) return null;
  return <View style={styles.row}>
    {actions.map((a) => <View key={a.label} style={styles.slot}>
      <PressableScale accessibilityRole="button" accessibilityLabel={a.label} onPress={a.open} style={styles.button}>
        <View style={[styles.icon, { backgroundColor: a.fill }]}>{a.icon}</View>
        <Text variant="label" style={styles.label}>{a.label}</Text>
      </PressableScale>
    </View>)}
  </View>;
}

const useStyles = makeStyles((c) => StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  slot: { flexGrow: 1, flexBasis: 140 },
  button: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, borderWidth: 1, borderColor: c.borderSubtle, backgroundColor: c.surface },
  icon: { width: 32, height: 32, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  label: { flexShrink: 1 },
}));
