import { router } from "expo-router";
import { Button, Card, Screen, ScreenHeader, Text } from "@/components/ds";
import { usePartnerPreview } from "@/features/partners/PartnerPreviewProvider";
import { PartnerWideCard, PartnerPreviewNotice } from "@/features/partners/PartnerOfferCard";
import { PREVIEW_OFFERS } from "@/features/partners/model";

export default function PartnerPlacementPreview() {
  const preview = usePartnerPreview();
  if (!__DEV__) return <Screen><ScreenHeader title="Preview unavailable"/><Text>This design preview is available only in development.</Text></Screen>;
  return <Screen><ScreenHeader title="Partner placement preview" subtitle="Review the approved concept inside the mobile app."/>
    <Card style={{ gap: 10 }}><PartnerPreviewNotice/><Text variant="heading">A useful offer, after the essentials</Text><Text color="textSecondary">A wide banner above Recent transactions on Home, paired square cards under the Pay forms and a slim bar in Plan. Offers & partners opens from More. Payment and ledger screens stay clear.</Text><Button label="Preview on my Home screen" fullWidth onPress={() => { preview.start(); router.navigate("/"); }}/><Button label="Browse example offers" variant="secondary" fullWidth onPress={() => { preview.start(); router.push("/partner-offers"); }}/></Card>
    <PartnerWideCard offer={PREVIEW_OFFERS[0]}/>
    <Button label="Offer preferences" variant="secondary" fullWidth onPress={() => { preview.start(); router.push("/partner-preferences"); }}/>
    <Button label="Reset preview choices" variant="ghost" onPress={preview.reset}/>
    <Button label="Turn off placement preview" variant="ghost" onPress={() => { preview.stop(); router.navigate("/more"); }}/>
  </Screen>;
}
