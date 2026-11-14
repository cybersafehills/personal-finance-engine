import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import { Button, Text } from "@/components/ds";
import { useSession } from "@/features/auth/SessionProvider";
import { colors, space } from "@/theme/tokens";

import { useLock } from "./LockProvider";

/**
 * Covers the whole app while locked, and (without controls) while the app
 * is in the app switcher so balances never appear in a screenshot preview.
 */
export function LockScreen({ mode }: { mode: "locked" | "cover" }) {
  const { unlock } = useLock();
  const { signOut } = useSession();
  const [failed, setFailed] = useState(false);
  const prompted = useRef(false);

  useEffect(() => {
    if (mode !== "locked" || prompted.current) return;
    prompted.current = true;
    unlock().then((ok) => setFailed(!ok));
  }, [mode, unlock]);

  return (
    <View style={styles.cover} accessibilityViewIsModal>
      <Text variant="title" color="accentForeground">
        OneLedger
      </Text>
      {mode === "locked" ? (
        <View style={styles.actions}>
          <Text variant="label" color="accentForeground" style={styles.hint}>
            {failed
              ? "Couldn't confirm it's you. Try again."
              : "Locked to keep your money private."}
          </Text>
          <Button
            label="Unlock"
            variant="secondary"
            fullWidth
            onPress={() => unlock().then((ok) => setFailed(!ok))}
          />
          <Button label="Sign out" variant="ghost" fullWidth onPress={signOut} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.brandNavy,
    alignItems: "center",
    justifyContent: "center",
    padding: space[6],
    gap: space[6],
  },
  actions: { alignSelf: "stretch", gap: space[3], maxWidth: 360, width: "100%" },
  hint: { textAlign: "center", opacity: 0.85 },
});
