import { ScrollView, View } from "react-native";

import { Chip } from "@/components/ds";
import { space } from "@/theme/tokens";

import {
  activeFilterCount,
  DIRECTION_OPTIONS,
  NO_FILTERS,
  PERIOD_OPTIONS,
  type TransactionFilters,
} from "./filters";
import { useTheme } from "@/theme/ThemeProvider";

// Direction, period and "needs review" for the ledger on ONE compact row (28pt
// chips, 12px text) that scrolls sideways if it must, instead of two tall rows.
// Chips are real buttons with a selected state, so screen readers announce the
// current choice. A "Clear" chip leads the row while any filter is active.
export function FilterChips({
  value,
  onChange,
}: {
  value: TransactionFilters;
  onChange: (next: TransactionFilters) => void;
}) {
  const { colors } = useTheme();
  const active = activeFilterCount(value);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ alignItems: "center", gap: space[1] }}
    >
      {active > 0 ? <Chip compact label="Clear" selected={false} onPress={() => onChange(NO_FILTERS)} /> : null}
      {DIRECTION_OPTIONS.map((o) => (
        <Chip
          compact
          key={o.value}
          label={o.label}
          selected={value.direction === o.value}
          onPress={() => onChange({ ...value, direction: o.value })}
        />
      ))}
      <View style={{ width: 1, height: 16, backgroundColor: colors.borderStrong, marginHorizontal: space[1] }} />
      {PERIOD_OPTIONS.map((o) => (
        <Chip
          compact
          key={o.value}
          label={o.label}
          selected={value.period === o.value}
          onPress={() => onChange({ ...value, period: o.value })}
        />
      ))}
      <View style={{ width: 1, height: 16, backgroundColor: colors.borderStrong, marginHorizontal: space[1] }} />
      <Chip
        compact
        label="To review"
        selected={value.needsReview}
        onPress={() => onChange({ ...value, needsReview: !value.needsReview })}
      />
    </ScrollView>
  );
}
