import { Pressable, ScrollView, View } from "react-native";

import { Button, Text } from "@/components/ds";
import { colors, MIN_TOUCH_TARGET, radii, space } from "@/theme/tokens";

import {
  activeFilterCount,
  DIRECTION_OPTIONS,
  NO_FILTERS,
  PERIOD_OPTIONS,
  type TransactionFilters,
} from "./filters";

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        minHeight: MIN_TOUCH_TARGET,
        justifyContent: "center",
        paddingHorizontal: space[3],
        borderRadius: radii.pill,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.borderStrong,
        backgroundColor: selected ? colors.accent : colors.surface,
      }}
    >
      <Text variant="label" color={selected ? "accentForeground" : "textSecondary"}>
        {label}
      </Text>
    </Pressable>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: "row", gap: space[2] }}>{children}</View>
    </ScrollView>
  );
}

// Direction, period and "needs review" for the ledger. Chips are real buttons
// with a selected state, so screen readers announce the current choice.
export function FilterChips({
  value,
  onChange,
}: {
  value: TransactionFilters;
  onChange: (next: TransactionFilters) => void;
}) {
  const active = activeFilterCount(value);
  return (
    <View style={{ gap: space[2] }}>
      <Row>
        {DIRECTION_OPTIONS.map((o) => (
          <Chip
            key={o.value}
            label={o.label}
            selected={value.direction === o.value}
            onPress={() => onChange({ ...value, direction: o.value })}
          />
        ))}
      </Row>
      <Row>
        {PERIOD_OPTIONS.map((o) => (
          <Chip
            key={o.value}
            label={o.label}
            selected={value.period === o.value}
            onPress={() => onChange({ ...value, period: o.value })}
          />
        ))}
        <Chip
          label="Needs review"
          selected={value.needsReview}
          onPress={() => onChange({ ...value, needsReview: !value.needsReview })}
        />
      </Row>
      {active > 0 ? (
        <Button
          label={`Clear ${active === 1 ? "filter" : `${active} filters`}`}
          variant="ghost"
          onPress={() => onChange(NO_FILTERS)}
        />
      ) : null}
    </View>
  );
}
