import { Pressable, View } from "react-native";

import { Button, Card, Text } from "@/components/ds";
import { formatDateTime } from "@/lib/kigali-time";
import { MIN_TOUCH_TARGET, space } from "@/theme/tokens";

import {
  duplicateSourceLabel,
  hasDuplicateTrail,
  mergedCountSentence,
  type DuplicateContext,
} from "./duplicates";
import { useTheme } from "@/theme/ThemeProvider";

// The duplicate-resolution trail, like the web's: whether this transaction is
// flagged or was merged away, and which rows were merged into it. It shows the
// trail and links to where it is resolved (the Inbox shows both candidates side
// by side); it never merges or dismisses from here. Renders nothing for an
// ordinary transaction.
export function DuplicatesCard({
  context,
  reviewAction,
  onOpen,
}: {
  context: DuplicateContext | null;
  /**
   * Where a flagged transaction is resolved, or null when there is nowhere to
   * send them. The Inbox covers the active Space, so the screen offers it
   * only there and the web's review queue otherwise.
   */
  reviewAction: { label: string; onPress: () => void } | null;
  onOpen: (transactionId: string) => void;
}) {
  const { colors } = useTheme();
  if (!context || !hasDuplicateTrail(context)) return null;
  const { dedupeState, mergedInto, mergedDuplicates } = context;

  return (
    <Card style={{ gap: space[3] }}>
      <Text variant="caption" color="textMuted" accessibilityRole="header">
        DUPLICATES
      </Text>

      {dedupeState === "possible_duplicate" ? (
        <View style={{ gap: space[2] }}>
          <Text variant="label" color="textSecondary">
            This transaction is flagged as a possible duplicate.
          </Text>
          {reviewAction ? (
            <Button label={reviewAction.label} variant="secondary" fullWidth onPress={reviewAction.onPress} />
          ) : null}
        </View>
      ) : null}

      {dedupeState === "merged" && mergedInto ? (
        <View style={{ gap: space[2] }}>
          <Text variant="label" color="textSecondary">
            {`Merged into another transaction on ${formatDateTime(mergedInto.occurredAt)}. It is kept as a record but no longer counted.`}
          </Text>
          <Button label="Open the kept transaction" variant="secondary" fullWidth onPress={() => onOpen(mergedInto.id)} />
        </View>
      ) : null}

      {mergedDuplicates.length > 0 ? (
        <View style={{ gap: space[2] }}>
          <Text variant="label" color="textSecondary">
            {`${mergedCountSentence(mergedDuplicates.length)}. They stay on record but are left out of every total.`}
          </Text>
          {mergedDuplicates.map((dup) => (
            <Pressable
              key={dup.id}
              accessibilityRole="button"
              accessibilityLabel={`Open ${dup.counterparty ?? "transaction"}`}
              onPress={() => onOpen(dup.id)}
              style={{
                minHeight: MIN_TOUCH_TARGET,
                justifyContent: "center",
                borderTopWidth: 1,
                borderTopColor: colors.borderSubtle,
                paddingVertical: space[2],
              }}
            >
              <Text variant="label" color="accent">
                {dup.counterparty ?? "Transaction"}
              </Text>
              <Text variant="caption" color="textMuted">
                {`${duplicateSourceLabel(dup.source)} · ${formatDateTime(dup.occurredAt)}`}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </Card>
  );
}
