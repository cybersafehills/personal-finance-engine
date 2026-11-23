import type { ReactNode } from "react";
import { useDockClearance } from "@/components/shell/dockClearance";
import { StyleSheet, View } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { useNavigationChrome } from "@/components/shell/NavigationChromeContext";
import { space } from "@/theme/tokens";
import { makeStyles } from "@/theme/ThemeProvider";

/**
 * Frame for screens whose body is a virtualised list (which must own the
 * scrolling itself): safe area, page gutter and the same max width as
 * `Screen`. Put the FlatList/SectionList inside.
 */
export function ListScreen({
  children,
  edges = ["left", "right"],
}: {
  children: ReactNode;
  /** Defaults to no "top": the native header (or the tab app header) owns that inset. */
  edges?: readonly Edge[];
}) {
  const styles = useStyles();
  const {onTabs}=useNavigationChrome();
  return (
    <SafeAreaView style={[styles.safe,!onTabs&&{paddingBottom:84}]} edges={onTabs ? edges : [...new Set([...edges, "bottom" as const])]}>
      <View style={styles.body}>{children}</View>
    </SafeAreaView>
  );
}

export const listContentStyle = {
  paddingHorizontal: space[4],
  paddingBottom: space[6],
} as const;

/** listContentStyle plus room to scroll clear of the floating dock on a tab screen. */
export function useListContentStyle() {
  const dock = useDockClearance();
  return { paddingHorizontal: space[4], paddingBottom: space[6] + dock } as const;
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, width: "100%", maxWidth: 480, alignSelf: "center" },
}));
