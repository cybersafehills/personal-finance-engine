import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { Badge, Text } from "@/components/ds";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

import { asOfText, balanceText, PROVIDER_LABEL, STATUS_LABEL, STATUS_VARIANT } from "./display";
import type { Wallet } from "./types";

const iconFor = (provider: string) =>
  provider === "cash" ? "dollar-sign" : provider.includes("money") || provider.includes("momo") ? "smartphone" : "credit-card";

/**
 * Every wallet with its balance, what that balance rests on, and when it was
 * true. Balances are listed, never added together: they differ in how sure we
 * are of them, and may differ in currency.
 */
export function WalletList({ wallets }: { wallets: Wallet[] }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { amountsHidden } = usePrivacy();
  return <View style={styles.list}>
    <View style={styles.group}>
      {wallets.map((w, i) => {
        const balance = amountsHidden ? "••••••" : balanceText(w);
        const kind = `${PROVIDER_LABEL[w.provider] ?? "Wallet"}${w.isPrimary ? " · Main wallet" : ""}`;
        const asOf = asOfText(w);
        return <Pressable
          key={w.id}
          accessibilityRole="button"
          accessibilityLabel={[w.name, kind, amountsHidden ? "balance hidden" : balance, STATUS_LABEL[w.balance.status], asOf].filter(Boolean).join(", ")}
          accessibilityHint="Opens this wallet"
          onPress={() => router.push({ pathname: "/wallet/[id]", params: { id: w.id } })}
          style={({ pressed }) => [styles.row, i > 0 && styles.divided, pressed && styles.pressed]}
        >
          <View style={styles.icon}><Feather name={iconFor(w.provider)} size={18} color={colors.accent} /></View>
          <View style={styles.body}>
            <Text variant="bodyStrong" numberOfLines={2}>{w.name}</Text>
            <Text variant="caption" color="textMuted">{kind}</Text>
            <Text variant="heading" tabular numberOfLines={1} adjustsFontSizeToFit>{balance}</Text>
            <View style={styles.basis}>
              <Badge variant={STATUS_VARIANT[w.balance.status]}>{STATUS_LABEL[w.balance.status]}</Badge>
              {asOf ? <Text variant="caption" color="textMuted">{asOf}</Text> : null}
            </View>
          </View>
          <Feather name="chevron-right" size={16} color={colors.textMuted} />
        </Pressable>;
      })}
    </View>
    <Text variant="caption" color="textMuted">OneLedger tracks these balances. It doesn’t hold your money.</Text>
  </View>;
}

const useStyles = makeStyles((c) => StyleSheet.create({
  list: { gap: 12 },
  group: { backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.borderSubtle, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, minHeight: 88 },
  divided: { borderTopWidth: 1, borderTopColor: c.borderSubtle },
  pressed: { backgroundColor: c.background },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: c.accentBg, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, minWidth: 0, gap: 3 },
  basis: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
}));
