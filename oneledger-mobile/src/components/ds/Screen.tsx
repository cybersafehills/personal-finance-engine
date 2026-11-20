import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { space } from "@/theme/tokens";
import { makeStyles } from "@/theme/ThemeProvider";

/**
 * Standard screen frame: safe area, scrolling, keyboard avoidance, the
 * page gutter, and a readable max width on tablets / the web preview.
 */
export function Screen({
  children,
  centered = false,
  edges = ["left", "right", "bottom"],
}: {
  children: ReactNode;
  /** Vertically centre the content (sign-in style screens). */
  centered?: boolean;
  /**
   * Safe-area edges to pad. Defaults to everything but the top: pushed screens sit
   * under the native navigation header, which owns the top inset. Screens with no
   * header (sign-in, the connect modal) pass `["top", ...]`.
   */
  edges?: readonly Edge[];
}) {
  const styles = useStyles();
  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          // Drag the form down to put the keyboard away (a number pad has no Return key).
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          contentContainerStyle={[styles.content, centered && styles.centered]}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: {
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    gap: space[3],
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
  },
  centered: { flexGrow: 1, justifyContent: "center" },
}));
