import Feather from "@expo/vector-icons/Feather";
import { Stack } from "expo-router";
import { useState, type ComponentProps, type ReactNode } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";

import { Button, ListGroup, ListRow, Screen, Text } from "@/components/ds";
import { useSession } from "@/features/auth/SessionProvider";
import { useActiveSpace } from "@/features/spaces/ActiveSpaceProvider";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

export const MenuGroup = (props: ComponentProps<typeof ListGroup>) => <ListGroup {...props} variant="menu" />;
export const MenuRow = (props: ComponentProps<typeof ListRow>) => <ListRow {...props} variant="menu" />;

/** Native back navigation above a readable title; More owns its top safe area. */
export function MenuScreen({ title, subtitle, root = false, action, children }: {
  title: string; subtitle?: string; root?: boolean; action?: ReactNode; children: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <Screen edges={root ? ["top", "left", "right"] : ["left", "right", "bottom"]} contentStyle={layout.content}>
      {root ? null : <Stack.Screen options={{ title, headerTitle: "", headerStyle: { backgroundColor: colors.background } }} />}
      <View style={layout.heading}>
        <Text variant="display" accessibilityRole="header" style={layout.headingText}>{title}</Text>
        {action}
      </View>
      {subtitle ? <Text color="textMuted" style={layout.subtitle}>{subtitle}</Text> : null}
      {children}
    </Screen>
  );
}

export function ProfileSummary({ onPress, external = false }: { onPress(): void; external?: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { session } = useSession();
  const { active } = useActiveSpace();
  const meta = session?.user.user_metadata;
  const named = meta?.full_name ?? meta?.display_name ?? meta?.name;
  const name = typeof named === "string" && named.trim() ? named.trim() : session?.user.email ?? "Your account";
  const initials = name.includes("@") ? name.slice(0, 2).toUpperCase() : name.split(/\s+/).slice(0, 2).map((s) => s[0]).join("").toUpperCase();
  return (
    <Pressable accessibilityRole="link" accessibilityLabel="Your profile" accessibilityHint={external ? "Opens profile and region in your browser" : "Open Settings"} onPress={onPress} style={({ pressed }) => [styles.profile, pressed && styles.pressed]}>
      <View style={styles.avatar}><Text variant="heading" color="accent">{initials}</Text></View>
      <View style={layout.grow}>
        <Text variant="heading" numberOfLines={1} ellipsizeMode="middle">{name}</Text>
        <Text variant="label" color="textMuted" numberOfLines={1}>{active?.name ?? "Personal Space"}</Text>
      </View>
      <Feather name={external ? "external-link" : "chevron-right"} size={16} color={colors.textMuted} />
    </Pressable>
  );
}

/** The same confirmation works on native and in the web preview. */
export function SignOutRow() {
  const { signOut } = useSession();
  const styles = useStyles();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await signOut(); setVisible(false); }
    catch { setError("Couldn't sign out. Please try again."); }
    finally { setBusy(false); }
  }
  return <>
    <MenuGroup><MenuRow icon="log-out" label="Sign out" destructive onPress={() => { setError(null); setVisible(true); }} /></MenuGroup>
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => { if (!busy) setVisible(false); }}>
      <View style={styles.scrim}>
        <View accessibilityViewIsModal style={styles.dialog}>
          <Text variant="title" accessibilityRole="header">Sign out?</Text>
          <Text color="textSecondary">You’ll need to sign in again to access your account.</Text>
          {error ? <Text color="attention" accessibilityRole="alert">{error}</Text> : null}
          <Button label="Sign out of OneLedger" fullWidth loading={busy} onPress={() => void confirm()} />
          <Button label="Cancel" variant="secondary" fullWidth disabled={busy} onPress={() => setVisible(false)} />
        </View>
      </View>
    </Modal>
  </>;
}

const layout = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28, gap: 20 },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 44 },
  headingText: { flex: 1 },
  grow: { flex: 1, gap: 3 },
  subtitle: { fontSize: 15, lineHeight: 22 },
});
const useStyles = makeStyles((c) => StyleSheet.create({
  profile: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 16, backgroundColor: c.surface, minHeight: 76 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: c.accentBg },
  pressed: { backgroundColor: c.accentBg },
  scrim: { flex: 1, justifyContent: "center", backgroundColor: "rgba(0,0,0,0.4)", padding: 24 },
  dialog: { width: "100%", maxWidth: 420, alignSelf: "center", padding: 24, borderRadius: 20, backgroundColor: c.surface, gap: 16 },
}));
