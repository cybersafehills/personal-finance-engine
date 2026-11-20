import { useRef, useState } from "react";
import { Pressable, View } from "react-native";

import { Button, Card, Text, TextField } from "@/components/ds";
import { MIN_TOUCH_TARGET, radii, space } from "@/theme/tokens";

import { addTag, MAX_TAG_LENGTH, removeTag, TagError, unusedSuggestions } from "./tags";
import { useTheme } from "@/theme/ThemeProvider";

// Free-form labels on a transaction: add, remove, and one-tap suggestions from
// tags already used in the Space. Writes go straight to the database under the
// user's RLS (see tags.ts). `workspaceId` is null when the transaction's Space
// couldn't be read, in which case tags are shown but not editable.
export function TransactionTags({
  transactionId,
  workspaceId,
  initialTags,
  suggestions,
}: {
  transactionId: string;
  workspaceId: string | null;
  initialTags: string[];
  suggestions: string[];
}) {
  const { colors } = useTheme();
  // Local list once the user changes something; until then, what was loaded.
  const [override, setOverride] = useState<string[] | null>(null);
  const tags = override ?? initialTags;
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function run(work: () => Promise<void>) {
    if (inFlight.current) return; // one change at a time
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof TagError ? e.message : "Something went wrong. Try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const add = (raw: string) =>
    run(async () => {
      if (!workspaceId) return;
      const tag = await addTag(transactionId, workspaceId, raw);
      setOverride((current) => {
        const base = current ?? initialTags;
        return base.includes(tag) ? base : [...base, tag].sort();
      });
      setInput("");
    });

  const remove = (tag: string) =>
    run(async () => {
      await removeTag(transactionId, tag);
      setOverride((current) => (current ?? initialTags).filter((t) => t !== tag));
    });

  const unused = unusedSuggestions(suggestions, tags);

  return (
    <Card style={{ gap: space[2] }}>
      <Text variant="caption" color="textMuted" accessibilityRole="header">
        TAGS
      </Text>
      <Text variant="caption" color="textMuted">
        Free-form labels for your own filtering. Tagging a transaction never changes an already-generated statement.
      </Text>

      {tags.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          {tags.map((tag) => (
            <View
              key={tag}
              style={{
                flexDirection: "row",
                alignItems: "center",
                borderRadius: radii.pill,
                backgroundColor: colors.background,
                borderWidth: 1,
                borderColor: colors.borderStrong,
                paddingLeft: space[3],
              }}
            >
              <Text variant="label">{tag}</Text>
              {workspaceId ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove tag ${tag}`}
                  disabled={busy}
                  onPress={() => remove(tag)}
                  hitSlop={8}
                  style={{ minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET, alignItems: "center", justifyContent: "center" }}
                >
                  <Text variant="label" color="textMuted">
                    ✕
                  </Text>
                </Pressable>
              ) : (
                <View style={{ width: space[3] }} />
              )}
            </View>
          ))}
        </View>
      ) : (
        <Text variant="label" color="textSecondary">
          No tags yet.
        </Text>
      )}

      {workspaceId ? (
        <>
          <TextField
            label="Add a tag"
            value={input}
            onChangeText={setInput}
            placeholder="e.g. reimbursable"
            maxLength={MAX_TAG_LENGTH}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => input.trim() && add(input)}
            editable={!busy}
            error={error ?? undefined}
          />
          <Button label="Add tag" variant="secondary" fullWidth loading={busy} disabled={!input.trim()} onPress={() => add(input)} />
          {unused.length > 0 ? (
            <View style={{ gap: space[2] }}>
              <Text variant="caption" color="textMuted">
                Used elsewhere
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
                {unused.map((suggestion) => (
                  <Pressable
                    key={suggestion}
                    accessibilityRole="button"
                    accessibilityLabel={`Add suggested tag ${suggestion}`}
                    disabled={busy}
                    onPress={() => add(suggestion)}
                    style={{
                      minHeight: MIN_TOUCH_TARGET,
                      justifyContent: "center",
                      paddingHorizontal: space[3],
                      borderRadius: radii.pill,
                      borderWidth: 1,
                      borderColor: colors.accent,
                    }}
                  >
                    <Text variant="label" color="accent">{`+ ${suggestion}`}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </>
      ) : error ? (
        <Text variant="label" color="attention">
          {error}
        </Text>
      ) : null}
    </Card>
  );
}
