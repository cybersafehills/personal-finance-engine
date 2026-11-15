import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, space } from "@/theme/tokens";

/**
 * Frame for screens whose body is a virtualised list (which must own the
 * scrolling itself): safe area, page gutter and the same max width as
 * `Screen`. Put the FlatList/SectionList inside.
 */
export function ListScreen({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.body}>{children}</View>
    </SafeAreaView>
  );
}

export const listContentStyle = {
  paddingHorizontal: space[4],
  paddingBottom: space[6],
} as const;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, width: "100%", maxWidth: 480, alignSelf: "center" },
});
