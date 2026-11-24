import { router } from "expo-router";
import { View } from "react-native";
import { Button, Card, Chip, Screen, ScreenHeader, Text } from "@/components/ds";
import { MenuGroup, MenuRow } from "@/features/settings/MenuUI";
import { usePartnerPreview } from "@/features/partners/PartnerPreviewProvider";
import { PARTNER_CATEGORIES } from "@/features/partners/model";
import { PartnerPreviewNotice } from "@/features/partners/PartnerOfferCard";
export default function PartnerPreferences() {
  const { state, update, unhideBrand, mode, catalog } = usePartnerPreview();
  if (mode === "off") return <Screen><ScreenHeader title="Offer preferences"/><Text>No sponsored offers are available right now.</Text></Screen>;
  return <Screen><ScreenHeader title="Offer preferences" subtitle="Choose what is useful to you."/><PartnerPreviewNotice/>
    <MenuGroup><MenuRow label="Home promotions" hint="Turn off Home cards while keeping the offers hub." icon="home" toggle={state.homeEnabled} onToggle={next => update({ homeEnabled: next })}/></MenuGroup>
    <Card style={{ gap: 10 }}><Text variant="heading">Your chosen interests</Text><Text variant="label" color="textSecondary">Optional. With none selected, examples use the chosen country and language only.</Text><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{PARTNER_CATEGORIES.map(item => <Chip key={item} label={item} selected={state.interests.includes(item)} onPress={() => update({ interests: state.interests.includes(item) ? state.interests.filter(category => category !== item) : [...state.interests, item] })}/>)}</View></Card>
    <Card style={{ gap: 10 }}><Text variant="heading">Country & language</Text><Text variant="label" color="textSecondary">Rwanda · chosen pilot context, not inferred from your transactions.</Text><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{(["English", "Kinyarwanda"] as const).map(language => <Chip key={language} label={language} selected={state.language === language} onPress={() => update({ language })}/>)}</View></Card>
    <Card style={{ gap: 10 }}><Text variant="heading">Hidden brands</Text>{!state.hiddenBrands.length ? <Text variant="label" color="textSecondary">You haven’t hidden any brands.</Text> : state.hiddenBrands.map(id => <View key={id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}><Text variant="label" style={{ flex: 1 }}>{catalog.find(offer => offer.brandId === id)?.brand ?? "Partner brand"}</Text><Button label="Unhide" accessibilityLabel={`Unhide ${catalog.find(offer => offer.brandId === id)?.brand ?? "brand"}`} size="sm" variant="ghost" onPress={() => unhideBrand(id)}/></View>)}</Card>
    <Text variant="caption" color="textMuted">Balances, transaction history, income, debt and financial distress are not advertising criteria. These preview preferences stay in this app session.</Text>
    <Button label="View offers" variant="secondary" fullWidth onPress={() => router.navigate("/partner-offers")}/>
  </Screen>;
}
