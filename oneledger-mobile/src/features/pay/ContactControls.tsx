import Feather from "@expo/vector-icons/Feather";
import { Pressable, StyleSheet } from "react-native";

import { colors } from "@/theme/tokens";

import { pickPhoneContact, type PickedContact } from "./phone-contacts";

/** The small "save as contact" switch drawn inside the Name field. */
export function SaveContactToggle({ value, onChange }: { value: boolean; onChange: (next: boolean) => void }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel="Save as contact"
      accessibilityState={{ checked: value }}
      accessibilityHint="Keeps this receiver in your OneLedger contacts, ready for next time."
      onPress={() => onChange(!value)}
      hitSlop={8}
      style={[styles.round, value && { backgroundColor: colors.accent }]}
    >
      <Feather name={value ? "user-check" : "user-plus"} size={16} color={value ? colors.accentForeground : colors.accent} />
    </Pressable>
  );
}

/**
 * "Choose from my phone's contacts": opens the phone's own picker and returns the
 * one person chosen (name and Rwandan mobile number). Nothing else is read.
 */
export function ContactPickButton({
  onPicked,
  onProblem,
  pick = pickPhoneContact,
}: {
  onPicked: (contact: PickedContact) => void;
  onProblem: (message: string) => void;
  pick?: typeof pickPhoneContact;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Choose from my phone's contacts"
      onPress={async () => {
        const result = await pick();
        if (result.ok) onPicked(result.contact);
        else if (!result.cancelled) onProblem(result.message);
      }}
      hitSlop={8}
      style={styles.round}
    >
      <Feather name="book-open" size={16} color={colors.accent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  round: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.accent,
  },
});
