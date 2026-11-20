import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";

import { fetchSpacesEnabled } from "@/api/mobile-api";
import { Button, Card, Screen, ScreenHeader, Text, TextField } from "@/components/ds";
import { useActiveSpace } from "@/features/spaces/ActiveSpaceProvider";
import {
  creatableKinds,
  CreateSpaceError,
  createSpace,
  KIND_COPY,
  validateSpaceName,
  type CreatableKind,
} from "@/features/spaces/create";
import { useQuery } from "@/hooks/useQuery";
import { MIN_TOUCH_TARGET, radii, space } from "@/theme/tokens";
import { useTheme } from "@/theme/ThemeProvider";

// Start a household or an organization Space, then switch to it. Households
// are offered only where the Spaces feature is on (as on the web); an
// organization always is. The creator becomes the Space's only owner.
export default function CreateSpace() {
  const { colors } = useTheme();
  const { activateCreated } = useActiveSpace();
  const load = useCallback(() => fetchSpacesEnabled(), []);
  const { data: spacesEnabled, loading } = useQuery(load);

  const kinds = creatableKinds(spacesEnabled === true);
  const [picked, setPicked] = useState<CreatableKind | null>(null);
  // If the picked kind is no longer offered (the flag resolved), use the first.
  const kind: CreatableKind = picked && kinds.includes(picked) ? picked : kinds[0];
  const copy = KIND_COPY[kind];

  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const check = validateSpaceName(name);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const id = await createSpace(kind, check.name);
      await activateCreated(id);
      router.replace("/");
    } catch (e) {
      setError(e instanceof CreateSpaceError ? e.message : "Couldn't create that Space. Try again.");
      setSaving(false);
    }
  }

  return (
    <Screen>
      <ScreenHeader title="Create a Space" subtitle="Personal stays yours alone. A shared Space is for working together." />

      {kinds.length > 1 ? (
        <View accessibilityRole="radiogroup" style={{ gap: space[2] }}>
          {kinds.map((k) => {
            const selected = k === kind;
            return (
              <Pressable
                key={k}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={KIND_COPY[k].title}
                onPress={() => setPicked(k)}
                style={{
                  minHeight: MIN_TOUCH_TARGET,
                  justifyContent: "center",
                  paddingHorizontal: space[4],
                  borderRadius: radii.control,
                  borderWidth: 1,
                  borderColor: selected ? colors.accent : colors.borderStrong,
                  backgroundColor: selected ? colors.surface : colors.background,
                }}
              >
                <Text variant="bodyStrong">{KIND_COPY[k].title}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <Card style={{ gap: space[3] }}>
        <Text variant="label" color="textSecondary">
          {copy.description}
        </Text>
        <TextField
          label={copy.nameLabel}
          value={name}
          onChangeText={(t) => {
            setName(t);
            if (error) setError(null);
          }}
          placeholder={copy.placeholder}
          autoCapitalize="words"
          returnKeyType="done"
          error={error ?? undefined}
          editable={!saving}
        />
        <Button label={copy.action} fullWidth loading={saving} disabled={loading && spacesEnabled === null} onPress={submit} />
      </Card>
    </Screen>
  );
}
