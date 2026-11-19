import Feather from "@expo/vector-icons/Feather";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/ds";
import {
  actionAvailableHere,
  LAUNCHER_ACTIONS,
  LAUNCHER_LINKS,
  opensInApp,
  type LauncherAction,
} from "@/features/pay/launcher";
import type { PayConfig } from "@/features/pay/types";
import { config as appConfig } from "@/lib/config";
import { colors, CONTROL_HEIGHT, hitSlopFor, radii, space } from "@/theme/tokens";

// The Pay & Services launcher, shown in a native form sheet (see
// (app)/pay-sheet.tsx), mirroring the web's launcher. It holds only what you need
// to start a payment; everything else (activity, templates, saved recipients) lives
// in More. It is a plain View, not a ScrollView: the sheet sizes itself to this
// content, so there is no blank space below and nothing to scroll or mis-lay-out.
// One tap never executes a payment.

type FeatherName = React.ComponentProps<typeof Feather>["name"];

const TILE_ICONS: Record<LauncherAction["id"], FeatherName> = {
  pay_person: "user",
  pay_merchant: "shopping-bag",
  pay_bill: "file-text",
  buy_electricity: "zap",
  buy_airtime: "smartphone",
  government: "flag",
};

export function PayLauncher({
  config,
  onClose,
}: {
  config: Partial<PayConfig>;
  /** Called before navigating, so the sheet can be dismissed first. */
  onClose: () => void;
}) {
  function pick(action: LauncherAction) {
    if (!actionAvailableHere(action, config)) return;
    onClose();
    if (action.kind === "native") {
      router.push({ pathname: "/pay-new", params: { type: action.id } });
    } else if (opensInApp(config)) {
      router.push({ pathname: "/ussd", params: { category: action.category, title: action.label } });
    } else {
      Linking.openURL(`${appConfig.apiBaseUrl}${action.webPath}`);
    }
  }

  function openDirectory() {
    onClose();
    if (opensInApp(config)) router.push("/ussd");
    else Linking.openURL(`${appConfig.apiBaseUrl}${LAUNCHER_LINKS.ussd.path}`);
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.badge}>
          <Feather name="send" size={16} color={colors.accentForeground} />
        </View>
        <View style={styles.headerText}>
          <Text variant="heading" accessibilityRole="header">
            Pay & Services
          </Text>
          <Text variant="label" color="textMuted" numberOfLines={1}>
            Prepare a payment or find a USSD code.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          hitSlop={hitSlopFor(CONTROL_HEIGHT.sm)}
          style={({ pressed }) => [styles.close, pressed && { backgroundColor: colors.background }]}
        >
          <Feather name="x" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>

      <View style={styles.body}>
        {config.scanToPay ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Scan to pay"
            onPress={() => {
              onClose();
              router.push("/scan");
            }}
            style={({ pressed }) => [styles.scan, pressed && { backgroundColor: colors.moneyPositiveBg }]}
          >
            <View style={styles.scanIcon}>
              <Feather name="maximize" size={16} color={colors.accentForeground} />
            </View>
            <View style={styles.flex}>
              <Text variant="bodyStrong">Scan to pay</Text>
              <Text variant="caption" color="textMuted" numberOfLines={1}>
                Scan a merchant payment QR code.
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}

        <View style={styles.grid}>
          {LAUNCHER_ACTIONS.map((action) => {
            const available = actionAvailableHere(action, config);
            return (
              <Pressable
                key={action.id}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                accessibilityState={{ disabled: !available }}
                disabled={!available}
                onPress={() => pick(action)}
                style={({ pressed }) => [styles.tile, !available && styles.tileOff, pressed && { borderColor: colors.accent }]}
              >
                <Feather name={TILE_ICONS[action.id]} size={18} color={available ? colors.accent : colors.textMuted} />
                <View style={styles.flex}>
                  <Text variant="bodyStrong" numberOfLines={2}>
                    {action.label}
                  </Text>
                  {!available ? (
                    <Text variant="caption" color="textMuted">
                      Coming later
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={LAUNCHER_LINKS.ussd.label}
          onPress={openDirectory}
          style={({ pressed }) => [styles.primary, pressed && { backgroundColor: colors.accentPressed }]}
        >
          <Text variant="bodyStrong" color="accentForeground" style={styles.flex}>
            {LAUNCHER_LINKS.ussd.label}
          </Text>
          <Feather name="arrow-right" size={16} color={colors.accentForeground} />
        </Pressable>

        <Text variant="caption" color="textMuted" style={styles.note}>
          OneLedger never asks for your Mobile Money or banking PIN and can&apos;t send money for you.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.surface },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingTop: space[4],
    paddingBottom: space[3],
  },
  badge: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: { flex: 1 },
  close: {
    width: CONTROL_HEIGHT.sm,
    height: CONTROL_HEIGHT.sm,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { paddingHorizontal: space[4], paddingBottom: space[6], gap: space[3] },
  scan: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    minHeight: 52,
    paddingHorizontal: space[3],
    borderRadius: radii.control,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: colors.moneyPositive,
  },
  scanIcon: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.moneyPositive,
    alignItems: "center",
    justifyContent: "center",
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  tile: {
    flexBasis: "48%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    minHeight: 48,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radii.control,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
  },
  tileOff: { opacity: 0.55 },
  primary: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    minHeight: CONTROL_HEIGHT.md + 4,
    paddingHorizontal: space[4],
    borderRadius: radii.control,
    borderCurve: "continuous",
    backgroundColor: colors.accent,
  },
  note: { textAlign: "center" },
});
