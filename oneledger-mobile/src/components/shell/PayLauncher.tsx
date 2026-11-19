import Feather from "@expo/vector-icons/Feather";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { Easing, FadeOut, Keyframe, ReduceMotion } from "react-native-reanimated";

import { Button, PressableScale, Text } from "@/components/ds";
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
// to start a payment; everything else lives in More. It is a plain View, not a
// ScrollView: the sheet sizes itself to this content, so there is no blank space
// below and nothing to scroll or mis-lay-out. One tap never executes a payment.
//
// Motion: the sheet's own slide and drag-to-dismiss are the platform's native sheet.
// Inside it, the rows rise and fade in with a short stagger, buttons scale slightly
// under the finger, and the info dialogs fade and settle in. Everything honours
// the system "reduce motion" setting.

type FeatherName = React.ComponentProps<typeof Feather>["name"];

const TILE_ICONS: Record<LauncherAction["id"], FeatherName> = {
  pay_person: "user",
  pay_merchant: "shopping-bag",
  pay_bill: "file-text",
  buy_electricity: "zap",
  buy_airtime: "smartphone",
  government: "flag",
};

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/** A short rise-and-fade for one block of the sheet; `index` staggers them by 35ms. */
function rise(index: number) {
  return new Keyframe({
    0: { opacity: 0, transform: [{ translateY: 8 }] },
    100: { opacity: 1, transform: [{ translateY: 0 }], easing: EASE_OUT },
  })
    .duration(220)
    .delay(index * 35)
    .reduceMotion(ReduceMotion.System);
}

const dialogIn = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.95 }] },
  100: { opacity: 1, transform: [{ scale: 1 }], easing: EASE_OUT },
})
  .duration(180)
  .reduceMotion(ReduceMotion.System);

type Info = "scan" | "request";

const INFO: Record<Info, { title: string; paragraphs: string[] }> = {
  scan: {
    title: "When to use Scan to pay",
    paragraphs: [
      "Use it at a shop or business that shows a QR code. Point your camera at the code and OneLedger shows you who you are paying and how much, before anything happens.",
      "OneLedger never pays for you. You finish the payment with your provider, on your own phone. The camera only reads the code: no photo is taken or saved.",
    ],
  },
  request: {
    title: "Why request a payment?",
    paragraphs: [
      "Use it when someone owes you money. Choose an amount and send them a link. They open it, see how to pay you, and pay from their own phone, so you don't have to explain your number or details again and again.",
      "When the money arrives, it shows up in OneLedger. Nobody is charged: they choose whether to pay.",
    ],
  },
};

export function PayLauncher({
  config,
  onClose,
}: {
  config: Partial<PayConfig>;
  /** Called before navigating, so the sheet can be dismissed first. */
  onClose: () => void;
}) {
  const [info, setInfo] = useState<Info | null>(null);

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

  // Blocks enter in order, so the sheet fills top to bottom.
  let step = 0;

  return (
    <View style={styles.root}>
      <Animated.View entering={rise(step++)} style={styles.header}>
        <View style={styles.headerText}>
          <Text variant="heading" accessibilityRole="header">
            Pay & Services
          </Text>
          <Text variant="label" color="textMuted" numberOfLines={1}>
            Prepare a payment or find a USSD code.
          </Text>
        </View>
      </Animated.View>

      <View style={styles.body}>
        {config.scanToPay ? (
          <Animated.View entering={rise(step++)}>
            <FeatureRow
              tone="scan"
              label="Scan to pay"
              caption="Scan a merchant payment QR code."
              icon={<Feather name="maximize" size={16} color={colors.accentForeground} />}
              infoLabel="About scan to pay"
              onInfo={() => setInfo("scan")}
              onPress={() => {
                onClose();
                router.push("/scan");
              }}
            />
          </Animated.View>
        ) : null}

        {config.paymentRequests ? (
          <Animated.View entering={rise(step++)}>
            <FeatureRow
              tone="request"
              label="Request payment"
              caption="Ask someone to pay you with a link."
              icon={<MaterialCommunityIcons name="hand-coin" size={18} color={colors.accentForeground} />}
              infoLabel="About requesting payment"
              onInfo={() => setInfo("request")}
              onPress={() => {
                onClose();
                router.push("/request-new");
              }}
            />
          </Animated.View>
        ) : null}

        <Animated.View entering={rise(step++)} style={styles.grid}>
          {LAUNCHER_ACTIONS.map((action) => {
            const available = actionAvailableHere(action, config);
            return (
              <PressableScale
                key={action.id}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                accessibilityState={{ disabled: !available }}
                disabled={!available}
                onPress={() => pick(action)}
                style={(pressed) => [styles.tile, !available && styles.tileOff, pressed && { borderColor: colors.accent }]}
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
              </PressableScale>
            );
          })}
        </Animated.View>

        <Animated.View entering={rise(step++)}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={LAUNCHER_LINKS.ussd.label}
            onPress={openDirectory}
            style={(pressed) => [styles.primary, pressed && { backgroundColor: colors.accentPressed }]}
          >
            <Text variant="bodyStrong" color="accentForeground" style={styles.flex}>
              {LAUNCHER_LINKS.ussd.label}
            </Text>
            <Feather name="arrow-right" size={16} color={colors.accentForeground} />
          </PressableScale>
        </Animated.View>

        <Animated.View entering={rise(step++)} style={styles.footer}>
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
        </Animated.View>
      </View>

      {info ? (
        // A dialog over the sheet (not a Modal), so it can animate out as well as in.
        <Animated.View
          style={styles.scrim}
          accessibilityViewIsModal
          entering={rise(0)}
          exiting={FadeOut.duration(120).reduceMotion(ReduceMotion.System)}
        >
          <Animated.View entering={dialogIn} style={styles.dialog}>
            <Text variant="heading" accessibilityRole="header">
              {INFO[info].title}
            </Text>
            {INFO[info].paragraphs.map((text) => (
              <Text key={text} color="textSecondary">
                {text}
              </Text>
            ))}
            <Button label="Got it" fullWidth onPress={() => setInfo(null)} />
          </Animated.View>
        </Animated.View>
      ) : null}
    </View>
  );
}

/**
 * The two highlighted shortcuts at the top: Scan to pay (green) and Request
 * payment (orange). The main area opens the feature; the small (i) at the right
 * explains it. No arrow: the colour and the icon already say "this is a feature".
 */
function FeatureRow({
  tone,
  label,
  caption,
  icon,
  infoLabel,
  onInfo,
  onPress,
}: {
  tone: "scan" | "request";
  label: string;
  caption: string;
  icon: ReactNode;
  infoLabel: string;
  onInfo: () => void;
  onPress: () => void;
}) {
  const accent = tone === "scan" ? colors.moneyPositive : colors.moneyRequest;
  const highlight = tone === "scan" ? colors.moneyPositiveBg : colors.moneyRequestBg;
  return (
    <View style={[styles.feature, { borderColor: accent }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }) => [styles.featureMain, pressed && { backgroundColor: highlight }]}
      >
        <View style={[styles.featureIcon, { backgroundColor: accent }]}>{icon}</View>
        <View style={styles.flex}>
          <Text variant="bodyStrong">{label}</Text>
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            {caption}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={infoLabel}
        onPress={onInfo}
        hitSlop={hitSlopFor(CONTROL_HEIGHT.sm)}
        style={({ pressed }) => [styles.info, { borderLeftColor: accent }, pressed && { backgroundColor: highlight }]}
      >
        <Feather name="info" size={16} color={colors.textSecondary} />
      </Pressable>
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
  headerText: { flex: 1 },
  body: { paddingHorizontal: space[4], paddingBottom: space[6], gap: space[3] },
  feature: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radii.control,
    borderCurve: "continuous",
    borderWidth: 1,
    overflow: "hidden",
  },
  featureMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 52, paddingHorizontal: space[3] },
  featureIcon: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  info: {
    width: 44,
    alignSelf: "stretch",
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderLeftWidth: StyleSheet.hairlineWidth,
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
  footer: { gap: space[2] },
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
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: space[6],
  },
  dialog: {
    width: "100%",
    maxWidth: 360,
    gap: space[3],
    padding: space[5],
    borderRadius: radii.card,
    borderCurve: "continuous",
    backgroundColor: colors.surface,
  },
});
