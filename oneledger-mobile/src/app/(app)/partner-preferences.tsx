import { router } from "expo-router";
import { View } from "react-native";
import { Button, Card, Chip, Screen, ScreenHeader, Text } from "@/components/ds";
import { usePartnerPreview } from "@/features/partners/PartnerPreviewProvider";
import { PARTNER_CATEGORIES } from "@/features/partners/model";
import { PartnerPreviewNotice } from "@/features/partners/PartnerOfferCard";
export default function PartnerPreferences() {
  const { state, update, mode } = usePartnerPreview();
  if (mode === "off") return <Screen><ScreenHeader title="Offer preferences"/><Text>No sponsored offers are available right now.</Text></Screen>;
  return <Screen><ScreenHeader title="Offer preferences" subtitle="Choose what is useful to you."/><PartnerPreviewNotice/>
    <Card style={{ gap: 10 }}><Text variant="heading">Your chosen interests</Text><Text variant="label" color="textSecondary">Optional. With none selected, examples use the chosen country and language only.</Text><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{PARTNER_CATEGORIES.map(item => <Chip key={item} label={item} selected={state.interests.includes(item)} onPress={() => update({ interests: state.interests.includes(item) ? state.interests.filter(category => category !== item) : [...state.interests, item] })}/>)}</View></Card>
    <Card style={{ gap: 10 }}><Text variant="heading">Country & language</Text><Text variant="label" color="textSecondary">Rwanda · chosen pilot context, not inferred from your transactions.</Text><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{(["English", "Kinyarwanda"] as const).map(language => <Chip key={language} label={language} selected={state.language === language} onPress={() => update({ language })}/>)}</View></Card>
    <Text variant="caption" color="textMuted">Balances, transaction history, income, debt and financial distress are not advertising criteria. Sponsored offers are part of OneLedger and cannot be switched off. These preferences stay in this app session.</Text>
    <Button label="View offers" variant="secondary" fullWidth onPress={() => router.navigate("/partner-offers")}/>
  </Screen>;
}
