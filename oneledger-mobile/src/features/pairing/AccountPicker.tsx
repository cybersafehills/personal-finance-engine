import { Pressable, View } from "react-native";

import { Text } from "@/components/ds";
import { MIN_TOUCH_TARGET, radii, space } from "@/theme/tokens";

import type { PairableAccount } from "./pairing";
import { useTheme } from "@/theme/ThemeProvider";

/** Single-choice list of MoMo accounts (a radio group). */
export function AccountPicker({
  accounts,
  selectedId,
  onSelect,
}: {
  accounts: PairableAccount[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="radiogroup" style={{ gap: space[2] }}>
      {accounts.map((account) => {
        const selected = account.id === selectedId;
        return (
          <Pressable
            key={account.id}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onSelect(account.id)}
            style={{
              minHeight: MIN_TOUCH_TARGET,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: space[3],
              paddingVertical: space[2],
              borderRadius: radii.control,
              borderWidth: selected ? 2 : 1,
              borderColor: selected ? colors.accent : colors.borderStrong,
            }}
          >
            <Text variant="bodyStrong">{account.name}</Text>
            <Text variant="caption" color={selected ? "accent" : "textMuted"}>
              {selected ? "Selected" : "MTN MoMo"}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
