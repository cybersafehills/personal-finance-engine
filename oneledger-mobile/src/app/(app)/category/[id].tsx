import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";

import { Button, Card, EmptyState, Screen, Text, TextField } from "@/components/ds";
import {
  filterCategoryOptions,
  newCategoryCandidate,
  normalizeCategoryName,
} from "@/features/categories/options";
import { getCategoryOptions } from "@/features/categories/queries";
import { correctCategory, ReviewActionError } from "@/features/review/actions";
import { displayName } from "@/features/transactions/display";
import { getTransactionById } from "@/features/transactions/queries";
import { useQuery } from "@/hooks/useQuery";
import { colors, MIN_TOUCH_TARGET, radii, space } from "@/theme/tokens";

const MAX_SHOWN = 40;

// Pick (or type) a category for one transaction. Mirrors the web's
// "Correct category": the choice becomes a manual decision, and optionally a
// rule so future payments to the same merchant file themselves.
export default function CategoryPicker() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const loadTransaction = useCallback(() => getTransactionById(id), [id]);
  const loadOptions = useCallback(() => getCategoryOptions(), []);
  const { data: transaction, loading, error, refresh } = useQuery(loadTransaction);
  const { data: options } = useQuery(loadOptions);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [saveAsRule, setSaveAsRule] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [ruleFailed, setRuleFailed] = useState(false);


  if (!transaction) {
    return (
      <Screen>
        {loading ? (
          <Text variant="label" color="textMuted">
            Loading…
          </Text>
        ) : (
          <EmptyState
            variant="setup"
            title={error ?? "This transaction isn't available"}
            action={error ? <Button label="Try again" variant="secondary" onPress={refresh} /> : undefined}
          />
        )}
      </Screen>
    );
  }

  const all = options ?? [];
  const shown = filterCategoryOptions(all, query).slice(0, MAX_SHOWN);
  const candidate = newCategoryCandidate(all, query);
  const counterparty = transaction.counterparty_name?.trim() || null;

  async function save() {
    if (!selected || !transaction) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Re-picking the category the row already has keeps its subcategory.
      const sameCategory =
        transaction.category !== null &&
        transaction.category.toLowerCase() === selected.toLowerCase();
      const result = await correctCategory(
        transaction.id,
        selected,
        sameCategory ? transaction.subcategory : null,
        saveAsRule && !!counterparty,
      );
      if (result.ruleSaved === false) {
        setRuleFailed(true);
      } else {
        router.back();
      }
    } catch (e) {
      setSaveError(e instanceof ReviewActionError ? e.message : "Couldn't save that. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (ruleFailed) {
    return (
      <Screen>
        <EmptyState
          title={`Category set to ${selected}`}
          description="The category is saved, but the rule for future payments couldn't be. You can add it on the web."
          action={<Button label="Done" onPress={() => router.back()} />}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ gap: space[1] }}>
        <Text variant="heading">Choose a category</Text>
        <Text variant="label" color="textMuted" numberOfLines={1}>
          {displayName(transaction)}
          {transaction.category ? ` · now ${transaction.category}` : " · uncategorized"}
        </Text>
      </View>

      <TextField
        label="Search or type a new category"
        value={query}
        onChangeText={setQuery}
        autoCapitalize="sentences"
        autoCorrect={false}
        returnKeyType="search"
      />

      <Card style={{ padding: 0, overflow: "hidden" }}>
        {candidate ? (
          <Option
            label={`Create “${candidate}”`}
            selected={selected === candidate}
            onPress={() => setSelected(candidate)}
          />
        ) : null}
        {shown.map((name) => (
          <Option
            key={name}
            label={name}
            selected={selected === name}
            onPress={() => setSelected(name)}
          />
        ))}
        {!candidate && shown.length === 0 ? (
          <Text variant="label" color="textMuted" style={{ padding: space[3] }}>
            {options ? "No matching categories." : "Loading…"}
          </Text>
        ) : null}
      </Card>

      {counterparty ? (
        <View style={styles.ruleRow}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">Remember for {counterparty}</Text>
            <Text variant="caption" color="textMuted">
              File future payments to this merchant under the same category.
            </Text>
          </View>
          <Switch
            value={saveAsRule}
            onValueChange={setSaveAsRule}
            trackColor={{ true: colors.accent }}
            accessibilityLabel={`Remember this category for ${counterparty}`}
          />
        </View>
      ) : null}

      {saveError ? (
        <Text variant="label" color="attention" accessibilityLiveRegion="polite">
          {saveError}
        </Text>
      ) : null}

      <Button
        label={selected ? `Save as ${normalizeCategoryName(selected)}` : "Choose a category"}
        fullWidth
        disabled={!selected}
        loading={saving}
        onPress={save}
      />
    </Screen>
  );
}

function Option({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.background }]}
    >
      <Text variant={selected ? "bodyStrong" : "body"} style={{ flex: 1 }}>
        {label}
      </Text>
      {selected ? (
        <Text variant="bodyStrong" color="accent" accessibilityElementsHidden>
          ✓
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  option: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  ruleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    padding: space[3],
    borderRadius: radii.card,
    backgroundColor: colors.surface,
  },
});
