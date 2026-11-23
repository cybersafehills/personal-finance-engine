import { useState } from "react";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ds";
import { space } from "@/theme/tokens";

/**
 * "Why am I seeing this?" - every insight can show the facts it was built from
 * (ADR 0014: deterministic, explainable, nothing invented). Collapsed by
 * default; the expanded state is announced to assistive tech.
 */
export function WhyThisInsight({ basis, period, method }: { basis: readonly string[]; period: string; method: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: space[1] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="Why am I seeing this?"
        hitSlop={12}
        onPress={() => setOpen((value) => !value)}
      >
        <Text variant="caption" color="accent">{open ? "Hide the reasons" : "Why am I seeing this?"}</Text>
      </Pressable>
      {open ? (
        <View style={{ gap: space[1] }}>
          {basis.map((line) => <Text key={line} variant="caption" color="textMuted">{`• ${line}`}</Text>)}
          <Text variant="caption" color="textMuted">{`Period: ${period}`}</Text>
          <Text variant="caption" color="textMuted">{`Method: ${method}`}</Text>
        </View>
      ) : null}
    </View>
  );
}
