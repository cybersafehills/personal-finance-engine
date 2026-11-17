import Feather from "@expo/vector-icons/Feather";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Text } from "@/components/ds";
import {
  actionAvailableHere,
  LAUNCHER_ACTIONS,
  LAUNCHER_LINKS,
  type LauncherAction,
} from "@/features/pay/launcher";
import type { PayConfig } from "@/features/pay/types";
import { config as appConfig } from "@/lib/config";
import { colors, MIN_TOUCH_TARGET, radii, space } from "@/theme/tokens";

// The Pay & Services launcher, as on the web's centre Pay button: a bottom
// sheet of ways to start a payment plus the USSD directory. One tap never
// executes a payment; person and merchant payments are prepared here and
// reviewed before anything is dialled.

function openWeb(path: string) {
  Linking.openURL(`${appConfig.apiBaseUrl}${path}`);
}

export function PaySheet({
  open,
  onClose,
  config,
  favourite = null,
}: {
  open: boolean;
  onClose: () => void;
  config: Partial<PayConfig>;
  /** The one starred USSD code shown under the actions (like the web); null when there is none. */
  favourite?: { slug: string; name: string; template: string } | null;
}) {
  const insets = useSafeAreaInsets();

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

  function link(path: string) {
    onClose();
    openWeb(path);
  }

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close Pay" style={styles.scrim} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space[3] }]}>
        <View style={styles.header}>
          <View style={styles.chip}>
            <Feather name="send" size={18} color={colors.accentForeground} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="heading" accessibilityRole="header">
              Pay & Services
            </Text>
            <Text variant="caption" color="textMuted">
              Prepare a payment or find a verified USSD code.
            </Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ gap: space[3] }}>
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
                  style={[styles.cell, !available && { opacity: 0.55 }]}
                >
                  <Text variant="bodyStrong">{action.label}</Text>
                  <Text variant="caption" color="textMuted">
                    {!available ? "Coming later" : action.kind === "web" ? "Opens on the web" : "Prepare here"}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={LAUNCHER_LINKS.ussd.label}
            onPress={openDirectory}
            style={styles.primary}
          >
            <Text variant="bodyStrong" style={{ color: colors.accentForeground }}>
              {LAUNCHER_LINKS.ussd.label} →
            </Text>
          </Pressable>

          {config.trustedRecipients ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Saved recipients"
              onPress={() => {
                onClose();
                router.push("/recipients");
              }}
              style={styles.cell}
            >
              <Text variant="bodyStrong">Saved recipients</Text>
              <Text variant="caption" color="textMuted">
                People and merchants you pay often
              </Text>
            </Pressable>
          ) : null}

          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={LAUNCHER_LINKS.activity.label}
              onPress={() => link(LAUNCHER_LINKS.activity.path)}
              style={[styles.cell, styles.rowCell]}
            >
              <Text variant="label">{LAUNCHER_LINKS.activity.label}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={LAUNCHER_LINKS.templates.label}
              onPress={() => link(LAUNCHER_LINKS.templates.path)}
              style={[styles.cell, styles.rowCell]}
            >
              <Text variant="label">{LAUNCHER_LINKS.templates.label}</Text>
            </Pressable>
          </View>

          {favourite ? (
            <View style={{ gap: space[1] }}>
              <Text variant="caption" color="textMuted" accessibilityRole="header">
                Favourite
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${favourite.name}, ${favourite.template}`}
                onPress={() => {
                  onClose();
                  router.push({ pathname: "/ussd/[slug]", params: { slug: favourite.slug } });
                }}
                style={styles.cell}
              >
                <Text variant="bodyStrong">{favourite.name}</Text>
                <Text variant="caption" color="textMuted" tabular>
                  {favourite.template}
                </Text>
              </Pressable>
            </View>
          ) : null}

          <Text variant="caption" color="textMuted">
            OneLedger never asks for your Mobile Money or banking PIN and can&apos;t send money for you.
          </Text>
        </ScrollView>

        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close}>
          <Feather name="x" size={16} color={colors.textSecondary} />
          <Text variant="bodyStrong" color="textSecondary">
            Close
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    maxHeight: "85%",
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    padding: space[4],
    gap: space[3],
  },
  header: { flexDirection: "row", alignItems: "center", gap: space[3] },
  chip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  cell: {
    flexGrow: 1,
    flexBasis: "47%",
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: "center",
    gap: 2,
    padding: space[3],
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
  },
  primary: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: "center",
    padding: space[3],
    borderRadius: radii.control,
    backgroundColor: colors.accent,
  },
  row: { flexDirection: "row", gap: space[2] },
  rowCell: { flexBasis: "45%", alignItems: "center" },
  close: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: "row",
    alignSelf: "center",
    alignItems: "center",
    gap: space[1],
    paddingHorizontal: space[5],
  },
});
