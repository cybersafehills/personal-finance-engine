import Feather from "@expo/vector-icons/Feather";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { ListGroup, ListRow, Text } from "@/components/ds";
import {
  actionAvailableHere,
  LAUNCHER_ACTIONS,
  LAUNCHER_LINKS,
  type LauncherAction,
} from "@/features/pay/launcher";
import type { PayConfig } from "@/features/pay/types";
import { config as appConfig } from "@/lib/config";
import { colors, CONTROL_HEIGHT, hitSlopFor, radii, space } from "@/theme/tokens";

// The Pay & Services launcher, shown in a native form sheet (see
// (app)/pay-sheet.tsx), mirroring the web's launcher
// (web/components/pay/PayLauncher.tsx). One tap never executes a payment: person
// and merchant payments are prepared here and reviewed before anything is
// dialled; the rest open the web or the in-app directory.

type FeatherName = React.ComponentProps<typeof Feather>["name"];

const TILE_ICONS: Record<LauncherAction["id"], FeatherName> = {
  pay_person: "user",
  pay_merchant: "shopping-bag",
  pay_bill: "file-text",
  buy_electricity: "zap",
  buy_airtime: "smartphone",
  government: "flag",
};

function openWeb(path: string) {
  Linking.openURL(`${appConfig.apiBaseUrl}${path}`);
}

export function PayLauncher({
  config,
  favourite = null,
  onClose,
}: {
  config: Partial<PayConfig>;
  /** The one starred USSD code shown under the actions (like the web); null when there is none. */
  favourite?: { slug: string; name: string; template: string } | null;
  /** Called before navigating, so the sheet can be dismissed first. */
  onClose: () => void;
}) {
  function pick(action: LauncherAction) {
    if (!actionAvailableHere(action, config)) return;
    onClose();
    if (action.kind === "native") router.push({ pathname: "/pay-new", params: { type: action.id } });
    else openWeb(action.path);
  }

  // The directory opens in the app where the server has it on; otherwise on the web.
  function openDirectory() {
    onClose();
    if (config.ussdDirectory) router.push("/ussd");
    else openWeb(LAUNCHER_LINKS.ussd.path);
  }

  function web(path: string) {
    onClose();
    openWeb(path);
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
          <Text variant="label" color="textMuted">
            Prepare a payment or find a verified USSD code.
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

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
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
              <Text variant="caption" color="textMuted">
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
                style={({ pressed }) => [
                  styles.tile,
                  !available && styles.tileOff,
                  pressed && { borderColor: colors.accent },
                ]}
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
                {available && action.kind === "web" ? (
                  <Feather name="external-link" size={12} color={colors.textMuted} accessibilityElementsHidden />
                ) : null}
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

        <ListGroup>
          {favourite ? (
            <ListRow
              icon="star"
              label={favourite.name}
              hint={favourite.template}
              a11yLabel={`${favourite.name}, ${favourite.template}`}
              onPress={() => {
                onClose();
                router.push({ pathname: "/ussd/[slug]", params: { slug: favourite.slug } });
              }}
            />
          ) : null}
          {config.trustedRecipients ? (
            <ListRow
              icon="users"
              label="Saved recipients"
              hint="People and merchants you pay often"
              onPress={() => {
                onClose();
                router.push("/recipients");
              }}
            />
          ) : null}
          <ListRow icon="activity" label={LAUNCHER_LINKS.activity.label} external onPress={() => web(LAUNCHER_LINKS.activity.path)} />
          <ListRow icon="copy" label={LAUNCHER_LINKS.templates.label} external onPress={() => web(LAUNCHER_LINKS.templates.path)} />
        </ListGroup>

        <Text variant="caption" color="textMuted" style={styles.note}>
          OneLedger never asks for your Mobile Money or banking PIN and can&apos;t send money for you.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
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
