import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { colors, space } from "@/theme/tokens";

/**
 * Standard screen frame: safe area, scrolling, keyboard avoidance, the
 * page gutter, and a readable max width on tablets / the web preview.
 */
export function Screen({
  children,
  centered = false,
  edges,
}: {
  children: ReactNode;
  /** Vertically centre the content (sign-in style screens). */
  centered?: boolean;
  /** Safe-area edges to pad; drop "top" under the app header. */
  edges?: readonly Edge[];
}) {
  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.content, centered && styles.centered]}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: {
    padding: space[4],
    gap: space[4],
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
  },
  centered: { flexGrow: 1, justifyContent: "center" },
});
