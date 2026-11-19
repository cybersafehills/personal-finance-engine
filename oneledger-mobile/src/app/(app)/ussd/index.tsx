import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { Badge, Button, Card, Chip, EmptyState, Screen, ScreenHeader, Text, TextField } from "@/components/ds";
import { getFavouriteIds, getFavourites, getServiceDirectory, toggleFavourite } from "@/features/ussd/queries";
import { CATEGORY_LABELS, DIRECTORY_CATEGORIES, type DirectoryCategory, type ServiceCodeListItem } from "@/features/ussd/types";
import { useQuery } from "@/hooks/useQuery";
import { colors, MIN_TOUCH_TARGET, space } from "@/theme/tokens";

// The USSD directory, as on the web's /pay/ussd: verified codes for Mobile
// Money, banking and government services, searchable, with starred favourites.
// Nothing here dials or pays anything; a code opens its own page.
export default function UssdDirectory() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<DirectoryCategory | null>(null);
  const filtered = query.trim() !== "" || category !== null;

  const load = useCallback(async () => {
    const [codes, favourites, favouriteIds] = await Promise.all([
      getServiceDirectory({ query, category: category ?? undefined }),
      filtered ? Promise.resolve([] as ServiceCodeListItem[]) : getFavourites(),
      getFavouriteIds(),
    ]);
    return { codes, favourites, favouriteIds };
  }, [query, category, filtered]);
  const { data, loading, error, refresh } = useQuery(load);
  const [toggling, setToggling] = useState<string | null>(null);

  async function star(code: ServiceCodeListItem, isFavourite: boolean) {
    if (toggling) return;
    setToggling(code.id);
    try {
      await toggleFavourite(code.id, isFavourite);
    } catch {
      // Leave the star as it was; the reload below shows the truth.
    }
    setToggling(null);
    refresh();
  }

  const favouriteIds = data?.favouriteIds ?? new Set<string>();

  return (
    <Screen>
      <ScreenHeader title="USSD directory" subtitle="Verified USSD codes for Mobile Money, banking and government services in Rwanda." />

      <TextField label="Search" value={query} onChangeText={setQuery} placeholder="Name, service or code" autoCapitalize="none" returnKeyType="search" />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[2] }}>
        <Chip label="All" selected={category === null} onPress={() => setCategory(null)} />
        {DIRECTORY_CATEGORIES.map((c) => (
          <Chip key={c} label={CATEGORY_LABELS[c]} selected={category === c} onPress={() => setCategory(category === c ? null : c)} />
        ))}
      </ScrollView>

      {loading && !data ? (
        <Text variant="label" color="textMuted">
          Loading…
        </Text>
      ) : error && !data ? (
        <EmptyState title={error} action={<Button label="Try again" variant="secondary" onPress={refresh} />} />
      ) : data ? (
        <>
          {!filtered && data.favourites.length > 0 ? (
            <Section title="Favourites" codes={data.favourites} favouriteIds={favouriteIds} onStar={star} />
          ) : null}
          {data.codes.length === 0 ? (
            <EmptyState
              title={filtered ? "No matching services" : "The directory is empty"}
              description={filtered ? "Try a different search term, or clear the filters." : "No published services yet. Check back soon."}
            />
          ) : (
            <Section
              title={!filtered && data.favourites.length > 0 ? "All services" : null}
              codes={data.codes}
              favouriteIds={favouriteIds}
              onStar={star}
            />
          )}
        </>
      ) : null}
    </Screen>
  );
}

function Section({
  title,
  codes,
  favouriteIds,
  onStar,
}: {
  title: string | null;
  codes: ServiceCodeListItem[];
  favouriteIds: Set<string>;
  onStar: (code: ServiceCodeListItem, isFavourite: boolean) => void;
}) {
  return (
    <View style={{ gap: space[2] }}>
      {title ? (
        <Text variant="bodyStrong" accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      <Card style={{ paddingVertical: 0 }}>
        {codes.map((code, index) => {
          const isFavourite = favouriteIds.has(code.id);
          return (
            <View
              key={code.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: colors.borderSubtle,
              }}
            >
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={code.name}
                onPress={() => router.push({ pathname: "/ussd/[slug]", params: { slug: code.slug } })}
                style={{ flex: 1, minHeight: 64, justifyContent: "center", paddingVertical: space[3], gap: 2 }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
                  <Text variant="bodyStrong" style={{ flexShrink: 1 }}>
                    {code.name}
                  </Text>
                  <Badge variant={code.verified ? "positive" : "attention"}>{code.verified ? "Verified" : "Unverified"}</Badge>
                </View>
                <Text variant="caption" color="textMuted">
                  {`${code.template} · ${code.provider} · ${CATEGORY_LABELS[code.category] ?? ""}`}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isFavourite ? `Remove ${code.name} from favourites` : `Add ${code.name} to favourites`}
                accessibilityState={{ selected: isFavourite }}
                onPress={() => onStar(code, isFavourite)}
                style={{ width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: "center", justifyContent: "center" }}
              >
                <Feather name="star" size={20} color={isFavourite ? colors.accent : colors.textMuted} />
              </Pressable>
            </View>
          );
        })}
      </Card>
    </View>
  );
}
