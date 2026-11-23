import type { ReactNode } from "react";
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
  const {payOn,onTabs}=useNavigationChrome();
  return (
    <SafeAreaView style={[styles.safe,payOn&&!onTabs&&{paddingBottom:64}]} edges={edges}>
      <View style={styles.body}>{children}</View>
    </SafeAreaView>
  );
}

export const listContentStyle = {
  paddingHorizontal: space[4],
  paddingBottom: space[6],
} as const;

const useStyles = makeStyles((colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, width: "100%", maxWidth: 480, alignSelf: "center" },
}));
