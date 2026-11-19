import Feather from "@expo/vector-icons/Feather";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";

import { Button, Text } from "@/components/ds";
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
  const [aboutRequests, setAboutRequests] = useState(false);

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

        {config.paymentRequests ? (
          <View style={styles.request}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Request payment"
              onPress={() => {
                onClose();
                router.push("/request-new");
              }}
              style={({ pressed }) => [styles.requestMain, pressed && { backgroundColor: colors.background }]}
            >
              <View style={styles.requestIcon}>
                <Feather name="arrow-down-left" size={16} color={colors.accent} />
              </View>
              <View style={styles.flex}>
                <Text variant="bodyStrong">Request payment</Text>
                <Text variant="caption" color="textMuted" numberOfLines={1}>
                  Ask someone to pay you with a link.
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.textMuted} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="About requesting payment"
              onPress={() => setAboutRequests(true)}
              hitSlop={hitSlopFor(CONTROL_HEIGHT.sm)}
              style={({ pressed }) => [styles.info, pressed && { backgroundColor: colors.background }]}
            >
              <Feather name="info" size={16} color={colors.textSecondary} />
            </Pressable>
          </View>
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

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={({ pressed }) => [styles.close, pressed && { backgroundColor: colors.background }]}
        >
          <Feather name="x" size={16} color={colors.textSecondary} />
          <Text variant="bodyStrong" color="textSecondary">
            Close
          </Text>
        </Pressable>
      </View>

      <Modal visible={aboutRequests} transparent animationType="fade" onRequestClose={() => setAboutRequests(false)}>
        <View style={styles.scrim} accessibilityViewIsModal>
          <View style={styles.dialog}>
            <Text variant="heading" accessibilityRole="header">
              Why request a payment?
            </Text>
            <Text color="textSecondary">
              Use it when someone owes you money. Choose an amount and send them a link. They open it, see how to pay you, and
              pay from their own phone, so you don&apos;t have to explain your number or details again and again.
            </Text>
            <Text color="textSecondary">
              When the money arrives, it shows up in OneLedger. Nobody is charged: they choose whether to pay.
            </Text>
            <Button label="Got it" fullWidth onPress={() => setAboutRequests(false)} />
          </View>
        </View>
      </Modal>
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
  // "Close" sits below the content, centred, so it is the last thing under the thumb.
  close: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    minHeight: CONTROL_HEIGHT.md,
    paddingHorizontal: space[5],
    borderRadius: radii.pill,
  },
  request: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radii.control,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: "hidden",
  },
  requestMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 52, paddingHorizontal: space[3] },
  requestIcon: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  info: { width: 44, minHeight: 52, alignItems: "center", justifyContent: "center", borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.borderSubtle },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center", padding: space[6] },
  dialog: { width: "100%", maxWidth: 360, gap: space[3], padding: space[5], borderRadius: radii.card, borderCurve: "continuous", backgroundColor: colors.surface },
});
