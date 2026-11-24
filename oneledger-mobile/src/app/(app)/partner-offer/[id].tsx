import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { Button, Card, EmptyState, Screen, ScreenHeader, Text } from "@/components/ds";
import { PartnerPreviewNotice } from "@/features/partners/PartnerOfferCard";
import { usePartnerPreview } from "@/features/partners/PartnerPreviewProvider";
import { eligiblePreviewOffers, sponsorLabel } from "@/features/partners/model";
import { useTheme } from "@/theme/ThemeProvider";
export default function PartnerOfferDetail() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const offerId = Array.isArray(id) ? id[0] : id;
  const { state, today, mode, catalog } = usePartnerPreview();
  const offer = eligiblePreviewOffers(state, today, catalog).find(item => item.id === offerId);
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const [destinationOpen, setDestinationOpen] = useState(false);
  if (mode === "off" || !offer) return <Screen><ScreenHeader title="Partner offer"/><EmptyState title="This offer is unavailable" description="It may have ended or no longer match your context." action={<Button label="Browse offers" variant="secondary" onPress={() => router.replace("/partner-offers")}/>}/></Screen>;
  return <Screen><ScreenHeader title="Partner offer"/><PartnerPreviewNotice/>
    <Card style={{ gap: 12 }}><Text variant="caption" color="textSecondary">{sponsorLabel(offer)} · {offer.brand}</Text><Text variant="title" accessibilityRole="header">{offer.title}</Text><Text color="textSecondary">{offer.benefit}</Text><Text variant="caption" color="textMuted">{offer.category} · Example only</Text></Card>
    <Card style={{ gap: 10 }}><Text variant="heading">Before you continue</Text><Text variant="bodyStrong">Eligibility</Text><Text variant="label" color="textSecondary">{offer.eligibility}</Text><Text variant="bodyStrong">Offer terms</Text><Text variant="label" color="textSecondary">{offer.terms}</Text><Text variant="bodyStrong">Example offer ends</Text><Text variant="label" color="textSecondary">31 December 2026</Text>{offer.financialDisclosure ? <><Text variant="bodyStrong">Financial promotion disclosure</Text><Text variant="label" color="textSecondary">{offer.financialDisclosure}</Text></> : null}</Card>
    <Card style={{ gap: 8 }}><Text variant="heading">Why this offer?</Text><Text variant="label" color="textSecondary">{state.interests.includes(offer.category) ? `You selected ${offer.category} as an interest.` : "The chosen country and language match this example."} Your balance and financial records were not used.</Text><Button label="Change preferences" variant="ghost" size="sm" onPress={() => router.push("/partner-preferences")}/></Card>
    <Text variant="label" color="textSecondary">Destination · {offer.destination}</Text>
    <Button label="Preview provider destination" fullWidth onPress={() => setDestinationOpen(true)}/>
    <Modal visible={destinationOpen} transparent animationType={reducedMotion ? "none" : "fade"} onRequestClose={() => setDestinationOpen(false)}>
      <View style={styles.modal}><Pressable accessible={false} onPress={() => setDestinationOpen(false)} style={[StyleSheet.absoluteFill, { backgroundColor: colors.guideScrim, opacity: 0.3 }]}/><Card accessibilityViewIsModal style={styles.dialog}><Text variant="heading" accessibilityRole="header">Provider destination</Text><Text selectable color="textSecondary">{offer.destination}</Text><Text variant="label" color="textSecondary">This is an example destination. No external visit, redemption, payment or data sharing takes place.</Text><Button label="Close preview" fullWidth onPress={() => setDestinationOpen(false)}/></Card></View>
    </Modal>
  </Screen>;
}
const styles = StyleSheet.create({ modal: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 }, dialog: { width: "100%", maxWidth: 360, gap: 14 } });
