import { iconInk } from "@/components/ds/BrandIcon";
import Feather from "@expo/vector-icons/Feather";
import { StyleSheet, View } from "react-native";
import { Text } from "@/components/ds/Text";
import { PressableScale } from "@/components/ds/PressableScale";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/** Count is anchored to a fixed bell target, never a separate flex-row item. */
export function NotificationButton({ unread, onPress }: { unread: number; onPress(): void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return <PressableScale
    accessibilityRole="link"
    accessibilityLabel={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
    onPress={onPress}
    style={pressed => [styles.button, pressed && { backgroundColor: colors.accentBg }]}
  >
    <Feather name="bell" size={23} color={iconInk("bell", colors)} />
    {unread > 0 ? <View pointerEvents="none" accessible={false} style={styles.badge}>
      <Text color="onSolid" style={styles.count}>{unread > 99 ? "99+" : String(unread)}</Text>
    </View> : null}
  </PressableScale>;
}
const useStyles = makeStyles(colors => StyleSheet.create({
  button: { position: "relative", width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: 1, right: 0, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: colors.notificationBadge, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: colors.background },
  count: { fontSize: 10, lineHeight: 13, textAlign: "center" },
}));
