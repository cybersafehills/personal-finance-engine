import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { Button, Chip, EmptyState, Screen, ScreenHeader, Text, TextField } from "@/components/ds";
import { PartnerOfferBar, PartnerPreviewNotice, PartnerSquareCard, PartnerWideCard } from "@/features/partners/PartnerOfferCard";
import { usePartnerPreview } from "@/features/partners/PartnerPreviewProvider";
import { eligiblePreviewOffers, PARTNER_CATEGORIES, type PartnerCategory, type PartnerOffer } from "@/features/partners/model";
type Row = { key: string; kind: "wide" | "square" | "bar"; offers: PartnerOffer[] };
/** Lays offers out in the approved creative sizes, in a repeating rhythm: one wide banner, a pair of half-width squares, then slim bars. */
function layoutOffers(offers: PartnerOffer[]): Row[] {
  const pattern: { kind: Row["kind"]; take: number }[] = [{ kind: "wide", take: 1 }, { kind: "square", take: 2 }, { kind: "bar", take: 1 }, { kind: "bar", take: 1 }];
  const rows: Row[] = [];
  for (let i = 0, step = 0; i < offers.length; step++) {
    const { kind, take } = pattern[step % pattern.length];
    rows.push({ key: `${step}-${offers[i].id}`, kind, offers: offers.slice(i, i + take) });
    i += take;
  }
  return rows;
}
export default function PartnerOffers() {
  const { state, today, mode, catalog } = usePartnerPreview();
  const [category, setCategory] = useState<PartnerCategory | "All">("All");
  const [search, setSearch] = useState("");
  if (mode === "off") return <Screen><ScreenHeader title="Offers & partners"/><EmptyState title="No partner offers are available" description="The placement design is not enabled."/></Screen>;
  const query = search.trim().toLowerCase();
  const offers = eligiblePreviewOffers(state, today, catalog).filter(offer => (category === "All" || offer.category === category) && (!query || `${offer.brand} ${offer.title} ${offer.category}`.toLowerCase().includes(query)));
  return <Screen><ScreenHeader title="Offers & partners" subtitle="Useful benefits to explore, with sponsorship always clear." action={<Button label="Preferences" size="sm" variant="ghost" onPress={() => router.push("/partner-preferences")}/>}/><PartnerPreviewNotice/>
    <TextField compact label="Search offers" placeholder="Search a brand or benefit" value={search} onChangeText={setSearch} autoCapitalize="none"/>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{(["All", ...PARTNER_CATEGORIES] as const).map(item => <Chip key={item} label={item} selected={category === item} onPress={() => setCategory(item)}/>)}</View>
    {layoutOffers(offers).map(row => row.kind === "wide" ? <PartnerWideCard key={row.key} offer={row.offers[0]}/>
      : row.kind === "square" ? <View key={row.key} style={{ flexDirection: "row", gap: 10 }}>{row.offers.map(offer => <View key={offer.id} style={{ flex: 1 }}><PartnerSquareCard offer={offer}/></View>)}{row.offers.length === 1 ? <View style={{ flex: 1 }}/> : null}</View>
      : <PartnerOfferBar key={row.key} offer={row.offers[0]}/>)}
    {!offers.length ? <EmptyState title="No offers match" description="Try another category or search, or review your language and hidden brands." action={<Button label="Review preferences" variant="secondary" onPress={() => router.push("/partner-preferences")}/>}/> : null}
    <Text variant="caption" color="textMuted">A paid placement is not a OneLedger recommendation or a product guarantee. Your financial records are not used to select these examples.</Text>
  </Screen>;
}
