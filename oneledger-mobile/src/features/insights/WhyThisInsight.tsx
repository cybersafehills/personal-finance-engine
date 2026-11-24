import { useState } from "react";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ds";
import { space } from "@/theme/tokens";

/**
 * "How is this worked out?" - every insight can show the facts it was built from
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
        accessibilityLabel="How is this worked out?"
        hitSlop={12}
        onPress={() => setOpen((value) => !value)}
      >
        <Text variant="caption" color="accent">{open ? "Hide the details" : "How is this worked out?"}</Text>
      </Pressable>
      {open ? (
        <View style={{ gap: space[1] }}>
          {basis.map((line) => <Text key={line} variant="caption" color="textMuted">{`• ${line}`}</Text>)}
          <Text variant="caption" color="textMuted">{`Time covered: ${period}`}</Text>
          <Text variant="caption" color="textMuted">{`How: ${method}`}</Text>
        </View>
      ) : null}
    </View>
  );
}
